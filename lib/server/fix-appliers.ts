import "server-only";

import {
  ConflictError,
  DataLayerError,
  NotFoundError,
} from "@/lib/server/errors";
import type { PayrollRecordRow } from "@/lib/server/payroll-runs";
import type { ProposedChanges } from "@/lib/server/reconciliation";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Typed dispatcher for applying an approved `ProposedChanges`
 * payload. Not strictly a DAL -- this module is the side-effecting
 * orchestrator that mutates `payroll_records` or `participants`
 * based on a discriminated union of mutation kinds.
 *
 * Called by the approve-fix route AFTER `approveSuggestedFix`
 * succeeds. The route then calls `markSuggestedFixApplied` (on
 * success) or `markSuggestedFixFailed` (on the `ConflictError`
 * / `DataLayerError` thrown here). The dispatcher itself does NOT
 * touch the suggested_fixes row -- that separation keeps the
 * "approve, then apply, then transition" sequence legible at the
 * route layer.
 *
 * Two invariants kept by every applier:
 *
 *   1. Optimistic concurrency on every `from` value. If any field
 *      the agent observed has drifted in the DB between proposal
 *      and apply, the applier throws
 *      `ConflictError('optimistic_concurrency_conflict')` with the
 *      diverging field name. The fix lands as 'failed', not as a
 *      silent overwrite of fresher data.
 *
 *   2. Single UPDATE per applier. We read the row first to enforce
 *      OCC and capture the `before` snapshot, then issue ONE update
 *      with all `to` values. The atomic UPDATE is filtered on the
 *      row's natural key only -- the OCC check is JS-side because
 *      mixed numeric/string columns under PostgREST don't always
 *      stringify identically through `.eq()`.
 *
 * No Zod re-validation here: the dispatcher trusts that
 * `proposedChangesSchema` has already validated the payload upstream
 * (in the tool handler at write time and in the approve route at
 * apply time). Adding a re-parse here would just delay the inevitable
 * compile-time exhaustiveness check below.
 */

// ============================================================================
// Public types
// ============================================================================

/**
 * Audit-friendly result returned by every applier. `before` / `after`
 * are intentionally typed as `Record<string, unknown>` so the route
 * can stringify them into the audit log without further shaping. For
 * applies that don't have a "before" (create_from_payroll), the
 * `before` map is `{}`.
 */
export type ApplyResult = {
  kind: ProposedChanges["kind"];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

// ============================================================================
// Top-level dispatcher
// ============================================================================

/**
 * Apply one validated `ProposedChanges` payload. Switches on `kind`
 * and delegates to a typed applier. The exhaustive switch is the
 * type-system's safety net: adding a new variant to
 * `proposedChangesSchema` without adding a handler here will fail
 * `tsc --noEmit`.
 *
 * Errors:
 *   - `NotFoundError` if the target row no longer exists.
 *   - `ConflictError('optimistic_concurrency_conflict')` if any
 *     `from` value has drifted.
 *   - `ConflictError('participant_already_exists')` if a
 *     create_from_payroll target already has a participants row.
 *   - `ConflictError('payroll_record_missing_employee_id')` if a
 *     create_from_payroll source has no employee_id.
 *   - `DataLayerError` on any other Supabase failure.
 */
export async function applyProposedChanges(
  changes: ProposedChanges,
): Promise<ApplyResult> {
  switch (changes.kind) {
    case "payroll_record.update":
      return applyPayrollRecordUpdate(changes);
    case "participant.create_from_payroll":
      return applyParticipantCreateFromPayroll(changes);
    case "participant.update":
      return applyParticipantUpdate(changes);
    default: {
      const _exhaustive: never = changes;
      void _exhaustive;
      throw new DataLayerError({
        module: "fix-appliers",
        operation: "applyProposedChanges",
        message: `unknown proposed_changes.kind`,
      });
    }
  }
}

// ============================================================================
// payroll_record.update
// ============================================================================

type PayrollRecordUpdateChanges = Extract<
  ProposedChanges,
  { kind: "payroll_record.update" }
>;

/**
 * Apply field-level edits to one payroll_records row. Anchors the
 * row by `(payroll_run_id, row_number)` (the table's unique key).
 *
 * Sequence:
 *   1. Load the current row. Missing -> NotFoundError.
 *   2. For each `(field, { from })` pair, assert the current DB
 *      value matches `from`. Any mismatch ->
 *      ConflictError('optimistic_concurrency_conflict').
 *   3. Single `.update({ ...all_to_values })` filtered on the
 *      natural key.
 *   4. Return `{ kind, before, after }` for the audit log.
 */
export async function applyPayrollRecordUpdate(
  changes: PayrollRecordUpdateChanges,
): Promise<ApplyResult> {
  const supabase = getSupabaseServiceRoleClient();

  const { data: current, error: readError } = await supabase
    .from("payroll_records")
    .select("*")
    .eq("payroll_run_id", changes.run_id)
    .eq("row_number", changes.row_number)
    .maybeSingle();

  if (readError) {
    throw new DataLayerError({
      module: "fix-appliers",
      operation: "applyPayrollRecordUpdate",
      message: readError.message,
      cause: readError,
    });
  }
  if (!current) {
    throw new NotFoundError({
      module: "fix-appliers",
      operation: "applyPayrollRecordUpdate",
      message: `no payroll_records row at (run_id=${changes.run_id}, row_number=${changes.row_number})`,
    });
  }

  const currentRow = current as PayrollRecordRow;
  const toValues: Record<string, unknown> = {};
  const beforeValues: Record<string, unknown> = {};
  const afterValues: Record<string, unknown> = {};

  for (const [field, change] of Object.entries(changes.changes)) {
    if (!change) continue;
    const currentValue = (currentRow as unknown as Record<string, unknown>)[
      field
    ];
    if (!valuesEqual(currentValue, change.from)) {
      throw new ConflictError({
        module: "fix-appliers",
        operation: "applyPayrollRecordUpdate",
        message: `optimistic_concurrency_conflict: field=${field} expected=${stringifyForError(change.from)} actual=${stringifyForError(currentValue)}`,
      });
    }
    toValues[field] = change.to;
    beforeValues[field] = currentValue;
    afterValues[field] = change.to;
  }

  const { error: updateError } = await supabase
    .from("payroll_records")
    .update(toValues)
    .eq("payroll_run_id", changes.run_id)
    .eq("row_number", changes.row_number);

  if (updateError) {
    throw new DataLayerError({
      module: "fix-appliers",
      operation: "applyPayrollRecordUpdate",
      message: updateError.message,
      cause: updateError,
    });
  }

  return {
    kind: "payroll_record.update",
    before: beforeValues,
    after: afterValues,
  };
}

// ============================================================================
// participant.create_from_payroll
// ============================================================================

type ParticipantCreateFromPayrollChanges = Extract<
  ProposedChanges,
  { kind: "participant.create_from_payroll" }
>;

/**
 * Insert a new `participants` row sourced from one payroll record.
 * Used for `EMPLOYEE_NOT_IN_CENSUS` issues where the payroll names
 * an employee the census doesn't know about.
 *
 * Defaults applied to the new participant:
 *   - `source_file_id = null` -- the row originated in a payroll,
 *     not a census import. The audit log captures the originating
 *     run_id and row_number.
 *   - `participant_id = 'AUTO-' + employee_id` -- a sentinel so the
 *     `(plan_id, participant_id)` unique constraint passes. The
 *     real participant_id surfaces when the next census import
 *     overwrites this row via the `(plan_id, employee_id)` upsert.
 *   - `first_name` / `last_name` fall back to 'Unknown' if missing;
 *     better to insert with a placeholder than to fail the apply.
 *   - `employment_status = 'Active'` -- the only honest default for
 *     someone who just got paid.
 *   - `eligibility_status = 'Pending - In Service Period'` -- the
 *     conservative default; a reviewer can update once the real
 *     hire date is confirmed.
 *   - Rates and balances default to 0 / false.
 *
 * Errors:
 *   - NotFoundError if the source payroll record is missing.
 *   - ConflictError('payroll_record_missing_employee_id') if the
 *     payroll record has no employee_id (can't seed a participant
 *     without one).
 *   - ConflictError('participant_already_exists') on unique
 *     violation of `(plan_id, employee_id)`.
 */
export async function applyParticipantCreateFromPayroll(
  changes: ParticipantCreateFromPayrollChanges,
): Promise<ApplyResult> {
  const supabase = getSupabaseServiceRoleClient();

  const { data: sourceRow, error: readError } = await supabase
    .from("payroll_records")
    .select("*")
    .eq("payroll_run_id", changes.run_id)
    .eq("row_number", changes.row_number)
    .maybeSingle();

  if (readError) {
    throw new DataLayerError({
      module: "fix-appliers",
      operation: "applyParticipantCreateFromPayroll",
      message: readError.message,
      cause: readError,
    });
  }
  if (!sourceRow) {
    throw new NotFoundError({
      module: "fix-appliers",
      operation: "applyParticipantCreateFromPayroll",
      message: `no payroll_records row at (run_id=${changes.run_id}, row_number=${changes.row_number})`,
    });
  }

  const record = sourceRow as PayrollRecordRow;

  if (!record.employee_id) {
    throw new ConflictError({
      module: "fix-appliers",
      operation: "applyParticipantCreateFromPayroll",
      message: "payroll_record_missing_employee_id",
    });
  }

  const insertRow = {
    plan_id: changes.plan_id,
    source_file_id: null,
    participant_id: `AUTO-${record.employee_id}`,
    employee_id: record.employee_id,
    first_name: record.first_name || "Unknown",
    last_name: record.last_name || "Unknown",
    email: record.email,
    employment_status: "Active",
    eligibility_status: "Pending - In Service Period",
    current_deferral_rate: 0,
    roth_deferral_rate: 0,
    account_balance: 0,
    loan_balance: 0,
    beneficiary_on_file: false,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("participants")
    .insert(insertRow)
    .select("*")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      throw new ConflictError({
        module: "fix-appliers",
        operation: "applyParticipantCreateFromPayroll",
        message: "participant_already_exists",
        cause: insertError,
      });
    }
    throw new DataLayerError({
      module: "fix-appliers",
      operation: "applyParticipantCreateFromPayroll",
      message: insertError.message,
      cause: insertError,
    });
  }
  if (!inserted) {
    throw new DataLayerError({
      module: "fix-appliers",
      operation: "applyParticipantCreateFromPayroll",
      message: "insert returned no row",
    });
  }

  const insertedRow = inserted as Record<string, unknown>;

  return {
    kind: "participant.create_from_payroll",
    before: {},
    after: {
      id: insertedRow.id,
      plan_id: insertedRow.plan_id,
      participant_id: insertedRow.participant_id,
      employee_id: insertedRow.employee_id,
      first_name: insertedRow.first_name,
      last_name: insertedRow.last_name,
      email: insertedRow.email,
      employment_status: insertedRow.employment_status,
      eligibility_status: insertedRow.eligibility_status,
    },
  };
}

// ============================================================================
// participant.update
// ============================================================================

type ParticipantUpdateChanges = Extract<
  ProposedChanges,
  { kind: "participant.update" }
>;

/**
 * Apply field-level edits to one participants row. Mirrors
 * `applyPayrollRecordUpdate` but anchors on
 * `(plan_id, employee_id)` (the table's unique natural key).
 *
 * Sequence:
 *   1. Load the current row. Missing -> NotFoundError.
 *   2. For each `(field, { from })` pair, assert the current DB
 *      value matches `from`. Any mismatch ->
 *      ConflictError('optimistic_concurrency_conflict').
 *   3. Single `.update({ ...all_to_values })` filtered on the
 *      natural key.
 *   4. Return `{ kind, before, after }` for the audit log.
 */
export async function applyParticipantUpdate(
  changes: ParticipantUpdateChanges,
): Promise<ApplyResult> {
  const supabase = getSupabaseServiceRoleClient();

  const { data: current, error: readError } = await supabase
    .from("participants")
    .select("*")
    .eq("plan_id", changes.plan_id)
    .eq("employee_id", changes.employee_id)
    .maybeSingle();

  if (readError) {
    throw new DataLayerError({
      module: "fix-appliers",
      operation: "applyParticipantUpdate",
      message: readError.message,
      cause: readError,
    });
  }
  if (!current) {
    throw new NotFoundError({
      module: "fix-appliers",
      operation: "applyParticipantUpdate",
      message: `no participants row at (plan_id=${changes.plan_id}, employee_id=${changes.employee_id})`,
    });
  }

  const currentRow = current as Record<string, unknown>;
  const toValues: Record<string, unknown> = {};
  const beforeValues: Record<string, unknown> = {};
  const afterValues: Record<string, unknown> = {};

  for (const [field, change] of Object.entries(changes.changes)) {
    if (!change) continue;
    const currentValue = currentRow[field];
    if (!valuesEqual(currentValue, change.from)) {
      throw new ConflictError({
        module: "fix-appliers",
        operation: "applyParticipantUpdate",
        message: `optimistic_concurrency_conflict: field=${field} expected=${stringifyForError(change.from)} actual=${stringifyForError(currentValue)}`,
      });
    }
    toValues[field] = change.to;
    beforeValues[field] = currentValue;
    afterValues[field] = change.to;
  }

  const { error: updateError } = await supabase
    .from("participants")
    .update(toValues)
    .eq("plan_id", changes.plan_id)
    .eq("employee_id", changes.employee_id);

  if (updateError) {
    throw new DataLayerError({
      module: "fix-appliers",
      operation: "applyParticipantUpdate",
      message: updateError.message,
      cause: updateError,
    });
  }

  return {
    kind: "participant.update",
    before: beforeValues,
    after: afterValues,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Equality check tuned for OCC across mixed JS/JSON/Postgres types.
 *
 *   - Strict `===` first for the easy hits (string == string,
 *     number == number, null == null).
 *   - `numeric` columns round-trip through supabase-js as `string`
 *     ("1234.56") but the agent often re-emits them as `number`
 *     (1234.56). When both sides parse as a finite Number AND their
 *     string forms differ, compare as Number. This is how
 *     "0" === 0 and "1234.56" === 1234.56 land as equal.
 *   - Objects (jsonb) fall through to a JSON-stringify deep equal.
 *
 * The function is deliberately strict on type confusion (rate as
 * 0.05 vs the string "5%") -- that's the kind of OCC mismatch we
 * WANT to catch, because the underlying data shape changed.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  if (typeof a !== "object" && typeof b !== "object") {
    const sa = String(a);
    const sb = String(b);
    if (sa === sb) return true;

    if (typeof a === "boolean" || typeof b === "boolean") return false;

    const na = Number(sa);
    const nb = Number(sb);
    if (
      Number.isFinite(na) &&
      Number.isFinite(nb) &&
      sa.trim() !== "" &&
      sb.trim() !== ""
    ) {
      return na === nb;
    }
    return false;
  }

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Render a value for an error message without throwing on circular
 * structures. Output is intentionally short -- the audit log gets
 * the full before/after maps; this just lets the human see "expected
 * 1234.56, actual 1240.00" at a glance.
 */
function stringifyForError(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Best-effort detection of a Postgres unique-constraint violation
 * coming back through supabase-js. PostgREST surfaces these as
 * code "23505". We also fall back to a substring check on the
 * message so a non-standard build still gets the right error
 * class.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  if (typeof e.message === "string" && /duplicate key value/i.test(e.message)) {
    return true;
  }
  return false;
}
