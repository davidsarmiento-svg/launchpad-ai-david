import "server-only";

import { z } from "zod";

import { DataLayerError } from "@/lib/server/errors";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Data access for the normalized participant roster.
 *
 * Note on numeric types: Postgres `numeric` columns are returned by
 * supabase-js as `string` to preserve full precision (a numeric(12,2)
 * dollar amount survives a roundtrip exactly only as a string). The
 * row types below reflect that reality so callers that need math
 * coerce explicitly (`Number(row.current_deferral_rate)`) instead of
 * being silently mis-typed. CSV parsing (e.g. `"5%"` -> 0.05) lives in
 * the participant-import code path, not here -- this layer accepts
 * already-normalized values.
 */

const eligibilityStatusValues = [
  "Eligible",
  "Ineligible - Terminated",
  "Pending - In Service Period",
  "Ineligible - Other",
] as const;

const employmentStatusValues = [
  "Active",
  "Terminated",
  "On Leave",
  "Unknown",
] as const;

export type EligibilityStatus = (typeof eligibilityStatusValues)[number];
export type EmploymentStatus = (typeof employmentStatusValues)[number];

export type ParticipantRow = {
  id: string;
  plan_id: string;
  source_file_id: string | null;
  participant_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  date_of_birth: string | null;
  hire_date: string | null;
  eligibility_status: EligibilityStatus | null;
  /** numeric(5,4), e.g. "0.0500" for 5%. */
  current_deferral_rate: string;
  /** numeric(5,4), e.g. "0.0300" for 3%. */
  roth_deferral_rate: string;
  /** numeric(12,2), e.g. "12345.67". */
  account_balance: string;
  /** numeric(12,2), e.g. "0.00". */
  loan_balance: string;
  employment_status: EmploymentStatus | null;
  beneficiary_on_file: boolean;
  imported_at: string;
  updated_at: string;
};

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

/**
 * A rate as a decimal between 0 and 1 (e.g. 0.05 = 5%). Anything
 * higher is almost certainly a units mistake (someone passed 5 instead
 * of 0.05) and is rejected at the boundary rather than silently
 * over-contributing in downstream calculations.
 */
const rate = z.number().min(0).max(1);
const money = z.number().min(-1_000_000_000).max(1_000_000_000);

export const participantInputSchema = z.object({
  participant_id: z.string().min(1),
  employee_id: z.string().min(1),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  date_of_birth: isoDate.optional().nullable(),
  hire_date: isoDate.optional().nullable(),
  eligibility_status: z.enum(eligibilityStatusValues).optional().nullable(),
  current_deferral_rate: rate.default(0),
  roth_deferral_rate: rate.default(0),
  account_balance: money.default(0),
  loan_balance: money.default(0),
  employment_status: z.enum(employmentStatusValues).optional().nullable(),
  beneficiary_on_file: z.boolean().default(false),
});

export type ParticipantInput = z.infer<typeof participantInputSchema>;

export const importParticipantsInputSchema = z.object({
  plan_id: uuid,
  source_file_id: uuid.optional(),
  participants: z.array(participantInputSchema).min(1).max(10_000),
});

export type ImportParticipantsInput = z.input<
  typeof importParticipantsInputSchema
>;

export type ImportParticipantsResult = {
  rows: ParticipantRow[];
  count: number;
};

/**
 * Bulk-import (upsert) participants from a parsed census. Uses the
 * `(plan_id, employee_id)` unique index as the conflict target so
 * re-running the same import is idempotent and a partial re-upload
 * (one corrected row) just updates that row instead of erroring.
 *
 * Callers should write an `audit_logs` row that records the file id,
 * row count, and actor; this function intentionally does not, so the
 * audit context (who, why, which file) is set at the boundary that
 * knows it.
 */
export async function importParticipants(
  input: ImportParticipantsInput,
): Promise<ImportParticipantsResult> {
  const parsed = importParticipantsInputSchema.parse(input);

  const rows = parsed.participants.map((p) => ({
    plan_id: parsed.plan_id,
    source_file_id: parsed.source_file_id ?? null,
    ...p,
  }));

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("participants")
    .upsert(rows, { onConflict: "plan_id,employee_id" })
    .select("*");

  if (error) {
    throw new DataLayerError({
      module: "participants",
      operation: "importParticipants",
      message: error.message,
      cause: error,
    });
  }

  const out = (data ?? []) as ParticipantRow[];
  return { rows: out, count: out.length };
}

export const listParticipantsQuerySchema = z.object({
  plan_id: uuid,
  employment_status: z.enum(employmentStatusValues).optional(),
  search: z.string().min(1).optional(),
  limit: z.number().int().positive().max(1000).default(200),
  offset: z.number().int().nonnegative().default(0),
});

export type ListParticipantsQuery = z.input<
  typeof listParticipantsQuerySchema
>;

/**
 * Paginated participant lookup for the Participant Data screen.
 * `search` does a case-insensitive prefix match across employee_id,
 * participant_id, last_name, first_name.
 */
export async function listParticipants(
  query: ListParticipantsQuery,
): Promise<ParticipantRow[]> {
  const parsed = listParticipantsQuerySchema.parse(query);

  const supabase = getSupabaseServiceRoleClient();
  let q = supabase
    .from("participants")
    .select("*")
    .eq("plan_id", parsed.plan_id)
    .order("last_name", { ascending: true })
    .range(parsed.offset, parsed.offset + parsed.limit - 1);

  if (parsed.employment_status) {
    q = q.eq("employment_status", parsed.employment_status);
  }

  if (parsed.search) {
    const term = parsed.search.replace(/[%_]/g, "\\$&");
    const pattern = `%${term}%`;
    q = q.or(
      [
        `employee_id.ilike.${pattern}`,
        `participant_id.ilike.${pattern}`,
        `last_name.ilike.${pattern}`,
        `first_name.ilike.${pattern}`,
      ].join(","),
    );
  }

  const { data, error } = await q;
  if (error) {
    throw new DataLayerError({
      module: "participants",
      operation: "listParticipants",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as ParticipantRow[];
}

export const getParticipantByEmployeeIdInputSchema = z.object({
  plan_id: uuid,
  employee_id: z.string().min(1),
});

export type GetParticipantByEmployeeIdInput = z.infer<
  typeof getParticipantByEmployeeIdInputSchema
>;

/**
 * Look up a single participant by the natural key
 * `(plan_id, employee_id)`. Used by the reconciliation agent to match
 * a payroll row against the census. Returns `null` when no match.
 */
export async function getParticipantByEmployeeId(
  input: GetParticipantByEmployeeIdInput,
): Promise<ParticipantRow | null> {
  const parsed = getParticipantByEmployeeIdInputSchema.parse(input);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("plan_id", parsed.plan_id)
    .eq("employee_id", parsed.employee_id)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "participants",
      operation: "getParticipantByEmployeeId",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as ParticipantRow | null;
}
