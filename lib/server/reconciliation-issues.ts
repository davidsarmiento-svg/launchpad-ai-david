import "server-only";

import { z } from "zod";

import {
  ConflictError,
  DataLayerError,
  NotFoundError,
} from "@/lib/server/errors";
import {
  reconciliationIssueInputSchema,
  type ReconciliationCategory,
} from "@/lib/server/reconciliation";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Data access for `reconciliation_issues`. One row per problem the
 * Payroll Reconciliation Agent finds in a payroll run (or, post-9.1
 * migration, in a plan-scoped context like a cross-run regression
 * with no single owning run).
 *
 * Lifecycle: open -> resolved | ignored.
 *
 * The `open -> resolved` transition fires from two places:
 *   1. Route layer when a human marks the issue resolved/ignored
 *      manually (see `updateIssueStatus`).
 *   2. The suggested-fixes apply path when a fix lands successfully
 *      and the parent issue should auto-resolve (see
 *      `setIssueStatusResolvedByApplier`).
 *
 * Both transitions are filtered on `status = 'open'` so a concurrent
 * resolution can't be silently overwritten -- if the row state
 * changed since pre-read, the UPDATE returns zero rows and we raise
 * ConflictError.
 *
 * Note on agent-facing vs persisted fields: the shared
 * `reconciliationIssueInputSchema` carries a few fields the agent
 * uses for reasoning that don't have direct columns on this table
 * (`employee_id`, `row_number`). Those are resolved upstream by the
 * tool handler into the FK anchors we DO persist --
 * `payroll_record_id` captures (run_id, row_number) and
 * `participant_id` (set elsewhere) captures (plan_id, employee_id).
 * The `listPriorIssuesForPlan` projection joins through
 * payroll_records to recover `employee_id` for the runner.
 * `related_issue_id` IS persisted directly (FK to
 * reconciliation_issues.id, ON DELETE SET NULL) so the regression-
 * link UI and audits can resolve the prior issue.
 *
 * Audit-log writes live at the route boundary, not here -- this
 * module exposes a `{ before }` snapshot on status transitions so
 * the route can record who resolved what and why.
 */

export type ReconciliationIssueStatus = "open" | "resolved" | "ignored";
export type ReconciliationIssueSeverity = "low" | "medium" | "high";

export type ReconciliationIssueRow = {
  id: string;
  payroll_run_id: string | null;
  payroll_record_id: string | null;
  participant_id: string | null;
  plan_id: string | null;
  related_issue_id: string | null;
  category: ReconciliationCategory;
  severity: ReconciliationIssueSeverity;
  code: string;
  description: string;
  field_name: string | null;
  /** jsonb -- any JSON value the agent compared against. */
  expected_value: unknown;
  /** jsonb -- any JSON value the agent observed. */
  actual_value: unknown;
  agent_explanation: string | null;
  status: ReconciliationIssueStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

const uuid = z.string().uuid();

/**
 * Input for `createReconciliationIssue`. Extends the agent-facing
 * shape from the shared module with the persistence anchors the DAL
 * needs (plan_id required; payroll_run_id / payroll_record_id
 * optional). The `.refine` is documentation as much as enforcement:
 * the underlying CHECK constraint requires (payroll_run_id IS NOT
 * NULL OR plan_id IS NOT NULL), and since plan_id is required here
 * the predicate is trivially satisfied -- but the refine fails fast
 * with a readable error if a future caller relaxes plan_id without
 * updating the DB CHECK.
 */
export const createReconciliationIssueInputSchema =
  reconciliationIssueInputSchema
    .extend({
      plan_id: uuid,
      payroll_run_id: uuid.nullable(),
      payroll_record_id: uuid.nullable(),
    })
    .refine(
      (v) => v.plan_id != null || v.payroll_run_id != null,
      {
        message:
          "at least one of plan_id or payroll_run_id must be provided",
      },
    );

export type CreateReconciliationIssueInput = z.infer<
  typeof createReconciliationIssueInputSchema
>;

/**
 * Insert one reconciliation_issues row. Maps the agent-facing input
 * to the DB columns:
 *
 *   - `category` / `severity` / `code` / `description` /
 *     `field_name` / `expected_value` / `actual_value` /
 *     `agent_explanation` -> direct columns.
 *   - `plan_id` / `payroll_run_id` / `payroll_record_id` ->
 *     persistence anchors. The CHECK constraint enforces at least
 *     one of (payroll_run_id, plan_id) is non-null.
 *   - `related_issue_id` -> direct column (FK to
 *     reconciliation_issues.id, ON DELETE SET NULL). Used by the
 *     agent for DUPLICATE_PAY_PERIOD references and
 *     REGRESSION_OF_PRIOR_ISSUE links.
 *   - `employee_id` / `row_number` -> agent reasoning only; not
 *     persisted directly. The upstream tool handler is expected to
 *     resolve row_number into payroll_record_id via the
 *     payroll_records table before calling this function.
 *
 * Status defaults to 'open'. Returns the inserted row.
 */
export async function createReconciliationIssue(
  input: CreateReconciliationIssueInput,
): Promise<ReconciliationIssueRow> {
  const parsed = createReconciliationIssueInputSchema.parse(input);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .insert({
      plan_id: parsed.plan_id,
      payroll_run_id: parsed.payroll_run_id,
      payroll_record_id: parsed.payroll_record_id,
      related_issue_id: parsed.related_issue_id ?? null,
      category: parsed.category,
      severity: parsed.severity,
      code: parsed.code,
      description: parsed.description,
      field_name: parsed.field_name ?? null,
      expected_value: parsed.expected_value ?? null,
      actual_value: parsed.actual_value ?? null,
      agent_explanation: parsed.agent_explanation,
      status: "open",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new DataLayerError({
      module: "reconciliation-issues",
      operation: "createReconciliationIssue",
      message: error?.message ?? "insert returned no row",
      cause: error,
    });
  }

  return data as ReconciliationIssueRow;
}

/**
 * Look up a single issue by id. Returns null when the id is well
 * formed but no row matches.
 */
export async function getReconciliationIssue(
  id: string,
): Promise<ReconciliationIssueRow | null> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "reconciliation-issues",
      operation: "getReconciliationIssue",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as ReconciliationIssueRow | null;
}

/**
 * All issues attached to one payroll run, oldest first. Used by the
 * UI per-run section and by the runner when re-rendering after a
 * fix lands.
 */
export async function listIssuesForRun(
  payroll_run_id: string,
): Promise<ReconciliationIssueRow[]> {
  uuid.parse(payroll_run_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .select("*")
    .eq("payroll_run_id", payroll_run_id)
    .order("created_at", { ascending: true });

  if (error) {
    throw new DataLayerError({
      module: "reconciliation-issues",
      operation: "listIssuesForRun",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as ReconciliationIssueRow[];
}

/**
 * Every issue for a plan, run-scoped and plan-scoped, most recent
 * first. Capped at 200 to keep the plan-detail page snappy on long-
 * running plans. Used by the plan-detail UI and by exports.
 */
export async function listIssuesForPlan(
  plan_id: string,
): Promise<ReconciliationIssueRow[]> {
  uuid.parse(plan_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .select("*")
    .eq("plan_id", plan_id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new DataLayerError({
      module: "reconciliation-issues",
      operation: "listIssuesForPlan",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as ReconciliationIssueRow[];
}

/**
 * Minimal projection of a prior issue used by the reconciliation
 * runner to populate the agent's `prior_issues` context array. The
 * runner feeds these into the agent so it can flag
 * REGRESSION_OF_PRIOR_ISSUE codes against earlier runs without
 * re-reading the entire issue body.
 *
 * `employee_id` is recovered via a LEFT JOIN through payroll_records
 * (the FK anchor we DO persist captures the row, and the row carries
 * the employee_id). It is null for plan-scoped issues with no row
 * anchor (e.g., DUPLICATE_PAY_PERIOD at the run level).
 */
export type PriorIssueProjection = {
  id: string;
  payroll_run_id: string | null;
  employee_id: string | null;
  code: string;
  severity: ReconciliationIssueSeverity;
  description: string;
  created_at: string;
};

/**
 * Issues attached to this plan EXCLUDING those tied to the run
 * currently being reconciled. Used to build the agent's prior_issues
 * context for cross-run regression detection.
 *
 * Filter: `plan_id = $1 AND (payroll_run_id IS NULL OR
 * payroll_run_id != $2)`. Newest first, cap 200.
 */
export async function listPriorIssuesForPlan(
  plan_id: string,
  exclude_run_id: string,
): Promise<PriorIssueProjection[]> {
  uuid.parse(plan_id);
  uuid.parse(exclude_run_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .select(
      "id, payroll_run_id, code, severity, description, created_at, payroll_records(employee_id)",
    )
    .eq("plan_id", plan_id)
    .or(`payroll_run_id.is.null,payroll_run_id.neq.${exclude_run_id}`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new DataLayerError({
      module: "reconciliation-issues",
      operation: "listPriorIssuesForPlan",
      message: error.message,
      cause: error,
    });
  }

  // supabase-js returns FK embeds without generated DB types as
  // `any` / array-shaped, so we go through `unknown` and pick the
  // first joined record. The (issue -> payroll_record) relationship
  // is many-to-one on the FK side; PostgREST returns at most one.
  type Joined = {
    id: string;
    payroll_run_id: string | null;
    code: string;
    severity: ReconciliationIssueSeverity;
    description: string;
    created_at: string;
    payroll_records:
      | { employee_id: string | null }
      | Array<{ employee_id: string | null }>
      | null;
  };

  return ((data ?? []) as unknown as Joined[]).map((row) => {
    const joined = row.payroll_records;
    const employee_id = Array.isArray(joined)
      ? (joined[0]?.employee_id ?? null)
      : (joined?.employee_id ?? null);
    return {
      id: row.id,
      payroll_run_id: row.payroll_run_id,
      employee_id,
      code: row.code,
      severity: row.severity,
      description: row.description,
      created_at: row.created_at,
    };
  });
}

/**
 * Manual status transition for an open issue (resolved by a human or
 * ignored as out-of-scope). The `reason` field is validated here so
 * the route layer can rely on it for the audit log, but it's not
 * stored on this row -- reasons live in the audit log next to who
 * resolved and when.
 */
export const updateIssueStatusInputSchema = z.object({
  status: z.enum(["resolved", "ignored"]),
  resolved_by: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
});

export type UpdateIssueStatusInput = z.infer<
  typeof updateIssueStatusInputSchema
>;

export type UpdateIssueStatusResult = {
  issue: ReconciliationIssueRow;
  before: ReconciliationIssueRow;
};

/**
 * Flip an open issue to 'resolved' or 'ignored'. Atomic UPDATE
 * filtered on `status = 'open'`; a concurrent transition raises
 * ConflictError('issue_not_open'). Missing id raises
 * NotFoundError('reconciliation_issue', id).
 *
 * Returns the post-update row plus a pre-update snapshot so the
 * route can write a before/after audit-log entry.
 */
export async function updateIssueStatus(
  id: string,
  input: UpdateIssueStatusInput,
): Promise<UpdateIssueStatusResult> {
  uuid.parse(id);
  const parsed = updateIssueStatusInputSchema.parse(input);

  const prev = await getReconciliationIssue(id);
  if (!prev) {
    throw new NotFoundError({
      module: "reconciliation-issues",
      operation: "updateIssueStatus",
      message: `no reconciliation_issues row with id ${id}`,
    });
  }
  if (prev.status !== "open") {
    throw new ConflictError({
      module: "reconciliation-issues",
      operation: "updateIssueStatus",
      message: "issue_not_open",
    });
  }

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .update({
      status: parsed.status,
      resolved_at: nowIso,
      resolved_by: parsed.resolved_by,
    })
    .eq("id", id)
    .eq("status", "open")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "reconciliation-issues",
      operation: "updateIssueStatus",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "reconciliation-issues",
      operation: "updateIssueStatus",
      message: "issue_not_open",
    });
  }

  return { issue: data as ReconciliationIssueRow, before: prev };
}

/**
 * Auto-resolution path used by the suggested-fixes applier after a
 * fix lands successfully. Same atomic-update contract as
 * `updateIssueStatus`, but no audit / no reason -- the parent fix's
 * `FIX_APPLIED` audit entry already carries the "why". `resolved_by`
 * is pinned to the sentinel `'fix_applier'` so audit consumers can
 * tell auto-resolutions apart from human ones.
 *
 * Throws ConflictError('issue_not_open') if the issue is already
 * resolved / ignored when the applier reaches here -- the apply path
 * decides whether to swallow this (idempotent retry) or surface it.
 */
export async function setIssueStatusResolvedByApplier(
  id: string,
  applied_at: string,
): Promise<ReconciliationIssueRow> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .update({
      status: "resolved",
      resolved_at: applied_at,
      resolved_by: "fix_applier",
    })
    .eq("id", id)
    .eq("status", "open")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "reconciliation-issues",
      operation: "setIssueStatusResolvedByApplier",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "reconciliation-issues",
      operation: "setIssueStatusResolvedByApplier",
      message: "issue_not_open",
    });
  }

  return data as ReconciliationIssueRow;
}
