import "server-only";

import { z } from "zod";

import {
  ConflictError,
  DataLayerError,
  NotFoundError,
} from "@/lib/server/errors";
import {
  extractedPlanFieldsSchema,
  type ExtractedPlanFields,
} from "@/lib/server/plan-extraction";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Data access for `plans`. Plans are NOT seeded by a migration --- the
 * Plan Extraction Agent (or a developer running through the demo) is
 * responsible for inserting the row when the first plan PDF is
 * uploaded. This mirrors the real-world onboarding flow.
 */

const planStatusValues = ["draft", "in_review", "active", "archived"] as const;
const extractionStatusValues = [
  "pending",
  "in_review",
  "approved",
  "failed",
] as const;

export type PlanStatus = (typeof planStatusValues)[number];
export type ExtractionStatus = (typeof extractionStatusValues)[number];

export type PlanRow = {
  id: string;
  employer_name: string;
  plan_name: string | null;
  plan_year: number | null;
  extracted_fields: Record<string, unknown>;
  extraction_status: ExtractionStatus;
  extracted_at: string | null;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
};

const uuid = z.string().uuid();

export const createPlanInputSchema = z.object({
  employer_name: z.string().min(1, "employer_name is required"),
  plan_name: z.string().min(1).optional(),
  plan_year: z.number().int().min(1900).max(9999).optional(),
  status: z.enum(planStatusValues).optional(),
});

export type CreatePlanInput = z.infer<typeof createPlanInputSchema>;

/**
 * Insert a new plan row. The DB applies defaults for
 * `extracted_fields`, `extraction_status`, `status`, `created_at`, and
 * `updated_at`; callers only need to provide identity info.
 */
export async function createPlan(input: CreatePlanInput): Promise<PlanRow> {
  const parsed = createPlanInputSchema.parse(input);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("plans")
    .insert(parsed)
    .select("*")
    .single();

  if (error || !data) {
    throw new DataLayerError({
      module: "plans",
      operation: "createPlan",
      message: error?.message ?? "insert returned no row",
      cause: error,
    });
  }

  return data as PlanRow;
}

/**
 * Look up a single plan by id. Returns `null` when the id is well
 * formed but no row matches; throws on any other failure.
 */
export async function getPlan(id: string): Promise<PlanRow | null> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "plans",
      operation: "getPlan",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as PlanRow | null;
}

/**
 * List plans, most recently created first. Used by the onboarding home
 * page. Capped at `limit` (default 50, max 200) for safety.
 */
export async function listPlans(limit = 50): Promise<PlanRow[]> {
  const parsed = z.number().int().positive().max(200).parse(limit);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(parsed);

  if (error) {
    throw new DataLayerError({
      module: "plans",
      operation: "listPlans",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as PlanRow[];
}

export const updateExtractedFieldsInputSchema = z.object({
  extracted_fields: z.record(z.string(), z.unknown()),
  extraction_status: z.enum(extractionStatusValues),
  /**
   * Optional structured metadata mirrored back into top-level columns
   * when the extraction agent surfaces them. Kept optional so an early
   * "pending" write doesn't have to know employer_name / plan_year yet.
   */
  employer_name: z.string().min(1).optional(),
  plan_name: z.string().min(1).optional(),
  plan_year: z.number().int().min(1900).max(9999).optional(),
});

export type UpdateExtractedFieldsInput = z.infer<
  typeof updateExtractedFieldsInputSchema
>;

/**
 * Write Plan Extraction Agent output back to the plan row. Sets
 * `extracted_at = now()` automatically so callers don't have to clock
 * it themselves. The `updated_at` trigger handles the rest.
 *
 * This function intentionally does NOT write the audit log. Callers
 * are expected to wrap the call with `writeAuditLog({...})` so the
 * actor (agent name + reason + before/after snapshot) is recorded at
 * the boundary that knows that context.
 */
export async function updateExtractedFields(
  id: string,
  input: UpdateExtractedFieldsInput,
): Promise<PlanRow> {
  uuid.parse(id);
  const parsed = updateExtractedFieldsInputSchema.parse(input);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("plans")
    .update({
      ...parsed,
      extracted_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    throw new DataLayerError({
      module: "plans",
      operation: "updateExtractedFields",
      message: error?.message ?? "update returned no row",
      cause: error,
    });
  }

  return data as PlanRow;
}

/**
 * Approve the agent's extracted fields, optionally with human edits.
 *
 * The human approver's edits go through `extractedPlanFieldsSchema` so
 * a manually-fixed EIN that still doesn't match `NN-NNNNNNN` is
 * rejected here instead of slipping through. `approver_name` and
 * `reason` are validated but not stored on the plan -- the route
 * handler writes them into the `PLAN_DETAILS_APPROVED` audit row.
 *
 * Status transition is atomic: the UPDATE is filtered on
 * `extraction_status='in_review'`, so two simultaneous approves can't
 * both succeed (the second one returns no row and we raise). Also
 * flips `plans.status` to 'active' since this is the only onboarding
 * gate today; revisit once Payroll Reconciliation adds more.
 */
export const approveExtractedFieldsInputSchema = z.object({
  extracted_fields: extractedPlanFieldsSchema,
  approver_name: z.string().min(1),
  reason: z.string().min(1).max(2000).optional(),
});

export type ApproveExtractedFieldsInput = z.infer<
  typeof approveExtractedFieldsInputSchema
>;

export type ApproveExtractedFieldsResult = {
  plan: PlanRow;
  before: Record<string, unknown>;
  after: ExtractedPlanFields;
};

export async function approveExtractedFields(
  id: string,
  input: ApproveExtractedFieldsInput,
): Promise<ApproveExtractedFieldsResult> {
  uuid.parse(id);
  const parsed = approveExtractedFieldsInputSchema.parse(input);

  const prev = await getPlan(id);
  if (!prev) {
    throw new NotFoundError({
      module: "plans",
      operation: "approveExtractedFields",
      message: `no plans row with id ${id}`,
    });
  }
  if (prev.extraction_status !== "in_review") {
    throw new ConflictError({
      module: "plans",
      operation: "approveExtractedFields",
      message: `plan ${id} is not in_review (got ${prev.extraction_status})`,
    });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("plans")
    .update({
      extracted_fields: parsed.extracted_fields,
      extraction_status: "approved",
      status: "active",
    })
    .eq("id", id)
    .eq("extraction_status", "in_review")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "plans",
      operation: "approveExtractedFields",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "plans",
      operation: "approveExtractedFields",
      message: `plan ${id} status changed before approval could land (no longer in_review)`,
    });
  }

  return {
    plan: data as PlanRow,
    before: prev.extracted_fields,
    after: parsed.extracted_fields,
  };
}

/**
 * Reject the agent's extracted fields. Flips `extraction_status` to
 * 'failed'. `plans.status` is left unchanged -- the operator can
 * re-run extraction on a different file or fix the document; we don't
 * archive the plan automatically.
 *
 * Same atomic-update contract as `approveExtractedFields`.
 */
export const rejectExtractedFieldsInputSchema = z.object({
  approver_name: z.string().min(1),
  reason: z.string().min(1).max(2000),
});

export type RejectExtractedFieldsInput = z.infer<
  typeof rejectExtractedFieldsInputSchema
>;

export type RejectExtractedFieldsResult = {
  plan: PlanRow;
  before: Record<string, unknown>;
};

export async function rejectExtractedFields(
  id: string,
  input: RejectExtractedFieldsInput,
): Promise<RejectExtractedFieldsResult> {
  uuid.parse(id);
  rejectExtractedFieldsInputSchema.parse(input);

  const prev = await getPlan(id);
  if (!prev) {
    throw new NotFoundError({
      module: "plans",
      operation: "rejectExtractedFields",
      message: `no plans row with id ${id}`,
    });
  }
  if (prev.extraction_status !== "in_review") {
    throw new ConflictError({
      module: "plans",
      operation: "rejectExtractedFields",
      message: `plan ${id} is not in_review (got ${prev.extraction_status})`,
    });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("plans")
    .update({ extraction_status: "failed" })
    .eq("id", id)
    .eq("extraction_status", "in_review")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "plans",
      operation: "rejectExtractedFields",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "plans",
      operation: "rejectExtractedFields",
      message: `plan ${id} status changed before rejection could land (no longer in_review)`,
    });
  }

  return {
    plan: data as PlanRow,
    before: prev.extracted_fields,
  };
}
