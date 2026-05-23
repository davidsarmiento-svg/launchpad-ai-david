import "server-only";

import { z } from "zod";

import {
  ConflictError,
  DataLayerError,
  NotFoundError,
} from "@/lib/server/errors";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Data access for `payroll_runs` and `payroll_records`. One
 * `payroll_runs` row per uploaded CSV; one `payroll_records` row per
 * line in that CSV.
 *
 * Lifecycle: uploaded -> mapped -> validated -> reconciled (or
 * 'failed' on any unrecoverable error). `createPayrollRun` is
 * idempotent on `source_file_id` so retrying the upload step doesn't
 * create duplicate runs.
 *
 * Note on numeric types: Postgres `numeric(12,2)` round-trips through
 * supabase-js as `string` to preserve precision. We accept `number`
 * on the input side (the mapping ingest parses "1234.56" into a JS
 * number) and let the driver serialize on the way out; reads of
 * `PayrollRecordRow.gross_wages` etc. are typed as `string | null`
 * to reflect what comes back.
 */

export type PayrollRunStatus =
  | "uploaded"
  | "mapped"
  | "validated"
  | "reconciled"
  | "failed";

export type PayrollRunRow = {
  id: string;
  plan_id: string;
  source_file_id: string | null;
  mapping_id: string | null;
  label: string | null;
  pay_date: string | null;
  status: PayrollRunStatus;
  row_count: number;
  accepted_count: number;
  rejected_count: number;
  issue_count: number;
  uploaded_at: string;
  mapped_at: string | null;
  validated_at: string | null;
  reconciled_at: string | null;
};

export type PayrollRecordValidationStatus =
  | "pending"
  | "valid"
  | "has_warnings"
  | "has_errors"
  | "rejected";

export type PayrollRecordRow = {
  id: string;
  payroll_run_id: string;
  row_number: number;
  raw_data: Record<string, string>;
  employee_id: string | null;
  matched_participant_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  pay_date: string | null;
  /** numeric(12,2) returned as string. */
  gross_wages: string | null;
  pretax_deferral_amount: string | null;
  roth_amount: string | null;
  employer_match: string | null;
  loan_repayment: string | null;
  employment_status_in_run: string | null;
  validation_status: PayrollRecordValidationStatus;
  validation_errors: unknown[];
  created_at: string;
};

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

export const createPayrollRunInputSchema = z.object({
  plan_id: uuid,
  source_file_id: uuid,
  label: z.string().max(255).optional(),
  pay_date: isoDate.optional(),
});

export type CreatePayrollRunInput = z.infer<typeof createPayrollRunInputSchema>;

export type CreatePayrollRunResult = {
  run: PayrollRunRow;
  created: boolean;
};

/**
 * Insert a new `payroll_runs` row, or return the existing one if a
 * run already references the same `source_file_id`. The boolean
 * `created` flag lets callers skip downstream work on a retry.
 *
 * Idempotency keyed on `source_file_id` rather than `(plan_id,
 * file)` because a file already carries its plan via the `files`
 * row; pinning idempotency to the file uuid avoids the case where a
 * misconfigured client posts the same file under two plan ids.
 */
export async function createPayrollRun(
  input: CreatePayrollRunInput,
): Promise<CreatePayrollRunResult> {
  const parsed = createPayrollRunInputSchema.parse(input);

  const existing = await getPayrollRunByFileId(parsed.source_file_id);
  if (existing) {
    return { run: existing, created: false };
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_runs")
    .insert({
      plan_id: parsed.plan_id,
      source_file_id: parsed.source_file_id,
      label: parsed.label ?? null,
      pay_date: parsed.pay_date ?? null,
      status: "uploaded",
      row_count: 0,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new DataLayerError({
      module: "payroll-runs",
      operation: "createPayrollRun",
      message: error?.message ?? "insert returned no row",
      cause: error,
    });
  }

  return { run: data as PayrollRunRow, created: true };
}

/**
 * Look up a single payroll run by id. Returns null when the id is
 * well formed but no row matches.
 */
export async function getPayrollRun(
  id: string,
): Promise<PayrollRunRow | null> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "payroll-runs",
      operation: "getPayrollRun",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as PayrollRunRow | null;
}

/**
 * Look up a payroll run by its source file id. Used by
 * `createPayrollRun` to provide idempotency, and by retry / status
 * UIs to find the run associated with an upload.
 */
export async function getPayrollRunByFileId(
  source_file_id: string,
): Promise<PayrollRunRow | null> {
  uuid.parse(source_file_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("source_file_id", source_file_id)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "payroll-runs",
      operation: "getPayrollRunByFileId",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as PayrollRunRow | null;
}

/**
 * List up to 100 payroll runs for a plan, most recently uploaded
 * first. Used by the Payroll dashboard on the plan detail screen.
 */
export async function listPayrollRunsForPlan(
  plan_id: string,
): Promise<PayrollRunRow[]> {
  uuid.parse(plan_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("plan_id", plan_id)
    .order("uploaded_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new DataLayerError({
      module: "payroll-runs",
      operation: "listPayrollRunsForPlan",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as PayrollRunRow[];
}

/**
 * One mapped record from a payroll CSV. `row_number` is the original
 * 0-based line index after the header, `raw_data` is the verbatim
 * row, and the typed fields are populated by applying the approved
 * mapping. Numeric fields are accepted as JS numbers and serialized
 * to `numeric(12,2)` by supabase-js.
 *
 * Mapping/ingest is responsible for coercion (e.g. "$1,234.56" ->
 * 1234.56); this schema is the boundary between the ingest function
 * and the DB write.
 */
export const payrollRecordInputSchema = z.object({
  row_number: z.number().int().nonnegative(),
  raw_data: z.record(z.string(), z.string()),
  employee_id: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  pay_date: isoDate.nullable().optional(),
  gross_wages: z.number().nullable().optional(),
  pretax_deferral_amount: z.number().nullable().optional(),
  roth_amount: z.number().nullable().optional(),
  employer_match: z.number().nullable().optional(),
  loan_repayment: z.number().nullable().optional(),
  employment_status_in_run: z.string().nullable().optional(),
});

export type PayrollRecordInput = z.infer<typeof payrollRecordInputSchema>;

export const applyMappingToRunInputSchema = z.object({
  run_id: uuid,
  mapping_id: uuid,
  records: z.array(payrollRecordInputSchema).min(1).max(50_000),
});

export type ApplyMappingToRunInput = z.infer<
  typeof applyMappingToRunInputSchema
>;

export type ApplyMappingToRunResult = {
  run: PayrollRunRow;
  record_count: number;
};

/**
 * Apply an approved mapping to a freshly-uploaded run.
 *
 * Upserts `payroll_records` rows on `(payroll_run_id, row_number)`
 * so re-running ingest with corrected mapping just overwrites the
 * previously-imported rows in place. Then flips the run from
 * 'uploaded' to 'mapped' atomically (filtered UPDATE on the prior
 * status) so a concurrent state change is detected, not silently
 * overwritten.
 *
 * `validation_status` defaults to 'pending' on every record and
 * `validation_errors` to `[]` -- the Validation Agent fills both in
 * a subsequent step. Doing the import in one shot keeps the
 * upload/mapping path simple; downstream agents can take their time.
 */
export async function applyMappingToRun(
  input: ApplyMappingToRunInput,
): Promise<ApplyMappingToRunResult> {
  const parsed = applyMappingToRunInputSchema.parse(input);

  const prev = await getPayrollRun(parsed.run_id);
  if (!prev) {
    throw new NotFoundError({
      module: "payroll-runs",
      operation: "applyMappingToRun",
      message: `no payroll_runs row with id ${parsed.run_id}`,
    });
  }
  if (prev.status !== "uploaded") {
    throw new ConflictError({
      module: "payroll-runs",
      operation: "applyMappingToRun",
      message: `run ${parsed.run_id} is not uploaded (got ${prev.status})`,
    });
  }

  const rows = parsed.records.map((r) => ({
    payroll_run_id: parsed.run_id,
    row_number: r.row_number,
    raw_data: r.raw_data,
    employee_id: r.employee_id ?? null,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    email: r.email ?? null,
    pay_date: r.pay_date ?? null,
    gross_wages: r.gross_wages ?? null,
    pretax_deferral_amount: r.pretax_deferral_amount ?? null,
    roth_amount: r.roth_amount ?? null,
    employer_match: r.employer_match ?? null,
    loan_repayment: r.loan_repayment ?? null,
    employment_status_in_run: r.employment_status_in_run ?? null,
    validation_status: "pending" as const,
    validation_errors: [] as unknown[],
  }));

  const supabase = getSupabaseServiceRoleClient();
  const { error: upsertError } = await supabase
    .from("payroll_records")
    .upsert(rows, { onConflict: "payroll_run_id,row_number" })
    .select("id");

  if (upsertError) {
    throw new DataLayerError({
      module: "payroll-runs",
      operation: "applyMappingToRun",
      message: upsertError.message,
      cause: upsertError,
    });
  }

  const { data, error } = await supabase
    .from("payroll_runs")
    .update({
      status: "mapped",
      mapping_id: parsed.mapping_id,
      row_count: rows.length,
      mapped_at: new Date().toISOString(),
    })
    .eq("id", parsed.run_id)
    .eq("status", "uploaded")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "payroll-runs",
      operation: "applyMappingToRun",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "payroll-runs",
      operation: "applyMappingToRun",
      message: `run ${parsed.run_id} status changed before mapping could land (no longer uploaded)`,
    });
  }

  return { run: data as PayrollRunRow, record_count: rows.length };
}
