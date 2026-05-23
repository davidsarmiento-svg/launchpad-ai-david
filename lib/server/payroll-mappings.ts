import "server-only";

import { z } from "zod";

import {
  ConflictError,
  DataLayerError,
  NotFoundError,
} from "@/lib/server/errors";
import {
  fromStorageMapping,
  payrollMappingProposalSchema,
  toStorageMapping,
  type PayrollStorageMapping,
} from "@/lib/server/payroll-mapping";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Data access for `payroll_mappings`. Mappings are agent-proposed and
 * human-approved; once approved they are immutable. A new approval
 * for the same plan inserts a fresh row and supersedes the prior
 * approved row (status flipped from 'approved' to 'superseded').
 *
 * Approval is a two-step UPDATE today (supersede prior, then promote
 * new) and is therefore not transactional across both writes. This
 * is acceptable for the demo where a single operator is approving
 * mappings; if real concurrency becomes a concern, fold the two
 * UPDATEs into a Postgres function called via `.rpc()`.
 *
 * Audit-log writes live at the route boundary, not here -- this
 * module exposes a `{ before, after }` diff so the route can record
 * who approved what and why.
 */

export type PayrollMappingStatus =
  | "pending"
  | "approved"
  | "superseded"
  | "rejected";

export type PayrollMappingRow = {
  id: string;
  plan_id: string;
  name: string;
  mapping: PayrollStorageMapping;
  suggested_by: string | null;
  suggested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  status: PayrollMappingStatus;
};

const uuid = z.string().uuid();

export const proposeMappingInputSchema = z.object({
  plan_id: uuid,
  name: z.string().min(1).max(255),
  proposal: payrollMappingProposalSchema,
  suggested_by: z.string().min(1).max(255),
});

export type ProposeMappingInput = z.infer<typeof proposeMappingInputSchema>;

/**
 * Insert a new pending mapping. The agent calls this with its
 * proposed mapping; the row stays in 'pending' until a human
 * approves or rejects it.
 *
 * The proposal is converted to storage shape on the way in so the
 * DB always holds the CSV-keyed form regardless of which surface
 * created the row.
 */
export async function proposeMapping(
  input: ProposeMappingInput,
): Promise<PayrollMappingRow> {
  const parsed = proposeMappingInputSchema.parse(input);
  const storage = toStorageMapping(parsed.proposal);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_mappings")
    .insert({
      plan_id: parsed.plan_id,
      name: parsed.name,
      mapping: storage,
      suggested_by: parsed.suggested_by,
      status: "pending",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new DataLayerError({
      module: "payroll-mappings",
      operation: "proposeMapping",
      message: error?.message ?? "insert returned no row",
      cause: error,
    });
  }

  return data as PayrollMappingRow;
}

/**
 * Look up a single mapping by id. Returns null when the id is well
 * formed but no row matches.
 */
export async function getMapping(
  id: string,
): Promise<PayrollMappingRow | null> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_mappings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "payroll-mappings",
      operation: "getMapping",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as PayrollMappingRow | null;
}

/**
 * Most-recently-approved mapping for a plan. Returned null when the
 * plan has no approved mapping yet (typical on first payroll upload
 * for a brand-new employer).
 */
export async function getLatestApprovedMapping(
  plan_id: string,
): Promise<PayrollMappingRow | null> {
  uuid.parse(plan_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_mappings")
    .select("*")
    .eq("plan_id", plan_id)
    .eq("status", "approved")
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "payroll-mappings",
      operation: "getLatestApprovedMapping",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as PayrollMappingRow | null;
}

/**
 * Most-recently-suggested pending mapping for a plan. Used by the
 * UI to surface "agent has a proposal awaiting your review".
 */
export async function getLatestPendingMappingForPlan(
  plan_id: string,
): Promise<PayrollMappingRow | null> {
  uuid.parse(plan_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_mappings")
    .select("*")
    .eq("plan_id", plan_id)
    .eq("status", "pending")
    .order("suggested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "payroll-mappings",
      operation: "getLatestPendingMappingForPlan",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as PayrollMappingRow | null;
}

/**
 * List up to 50 mappings for a plan, most recent first. Used by the
 * audit / history view on the plan detail screen.
 */
export async function listMappingsForPlan(
  plan_id: string,
): Promise<PayrollMappingRow[]> {
  uuid.parse(plan_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_mappings")
    .select("*")
    .eq("plan_id", plan_id)
    .order("suggested_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new DataLayerError({
      module: "payroll-mappings",
      operation: "listMappingsForPlan",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as PayrollMappingRow[];
}

export const approveMappingInputSchema = z.object({
  /**
   * Optional human-edited proposal. When provided, replaces the
   * agent's stored mapping at approval time. When omitted, the
   * existing pending mapping is approved as-is.
   */
  proposal: payrollMappingProposalSchema.optional(),
  approver_name: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000).optional(),
});

export type ApproveMappingInput = z.infer<typeof approveMappingInputSchema>;

export type ApproveMappingResult = {
  mapping: PayrollMappingRow;
  before: PayrollStorageMapping;
  after: PayrollStorageMapping;
  superseded_id: string | null;
};

/**
 * Approve a pending mapping, optionally with human edits.
 *
 * Flow:
 *   1. Read the pending row. Missing -> NotFoundError; not pending ->
 *      ConflictError.
 *   2. Determine the post-approval storage mapping (human edits if
 *      `proposal` is provided, else round-trip the existing one
 *      through Zod to fail fast on stored-shape drift).
 *   3. If another approved mapping exists for the same plan, flip
 *      it to 'superseded' first. Best-effort; see module comment for
 *      the race-window caveat.
 *   4. Atomic UPDATE filtered on status='pending' -> 'approved'. If
 *      the row state changed since the pre-read, the UPDATE returns
 *      zero rows and we raise ConflictError.
 *
 * Returns the new approved row plus a before/after diff for the
 * audit log.
 */
export async function approveMapping(
  id: string,
  input: ApproveMappingInput,
): Promise<ApproveMappingResult> {
  uuid.parse(id);
  const parsed = approveMappingInputSchema.parse(input);

  const prev = await getMapping(id);
  if (!prev) {
    throw new NotFoundError({
      module: "payroll-mappings",
      operation: "approveMapping",
      message: `no payroll_mappings row with id ${id}`,
    });
  }
  if (prev.status !== "pending") {
    throw new ConflictError({
      module: "payroll-mappings",
      operation: "approveMapping",
      message: `mapping ${id} is not pending (got ${prev.status})`,
    });
  }

  const afterStorage: PayrollStorageMapping = parsed.proposal
    ? toStorageMapping(parsed.proposal)
    : toStorageMapping(fromStorageMapping(prev.mapping));

  const priorApproved = await getLatestApprovedMapping(prev.plan_id);
  let supersededId: string | null = null;
  if (priorApproved && priorApproved.id !== id) {
    const supabase = getSupabaseServiceRoleClient();
    const { error: supersedeError } = await supabase
      .from("payroll_mappings")
      .update({ status: "superseded" })
      .eq("id", priorApproved.id)
      .eq("status", "approved");

    if (supersedeError) {
      throw new DataLayerError({
        module: "payroll-mappings",
        operation: "approveMapping",
        message: supersedeError.message,
        cause: supersedeError,
      });
    }
    supersededId = priorApproved.id;
  }

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_mappings")
    .update({
      status: "approved",
      mapping: afterStorage,
      approved_by: parsed.approver_name,
      approved_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "payroll-mappings",
      operation: "approveMapping",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "payroll-mappings",
      operation: "approveMapping",
      message: `mapping ${id} status changed before approval could land (no longer pending)`,
    });
  }

  return {
    mapping: data as PayrollMappingRow,
    before: prev.mapping,
    after: afterStorage,
    superseded_id: supersededId,
  };
}

export const rejectMappingInputSchema = z.object({
  reviewer_name: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
});

export type RejectMappingInput = z.infer<typeof rejectMappingInputSchema>;

export type RejectMappingResult = {
  mapping: PayrollMappingRow;
  before: PayrollStorageMapping;
};

/**
 * Reject a pending mapping. Flips status to 'rejected'. Same atomic-
 * update contract as `approveMapping`: the UPDATE is filtered on
 * status='pending' so a concurrent approval can't be silently
 * overwritten.
 *
 * Reviewer name + reason are validated here but stored at the route
 * boundary in the audit log; the mapping row only carries who/when
 * for approval, not rejection.
 */
export async function rejectMapping(
  id: string,
  input: RejectMappingInput,
): Promise<RejectMappingResult> {
  uuid.parse(id);
  rejectMappingInputSchema.parse(input);

  const prev = await getMapping(id);
  if (!prev) {
    throw new NotFoundError({
      module: "payroll-mappings",
      operation: "rejectMapping",
      message: `no payroll_mappings row with id ${id}`,
    });
  }
  if (prev.status !== "pending") {
    throw new ConflictError({
      module: "payroll-mappings",
      operation: "rejectMapping",
      message: `mapping ${id} is not pending (got ${prev.status})`,
    });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("payroll_mappings")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "payroll-mappings",
      operation: "rejectMapping",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "payroll-mappings",
      operation: "rejectMapping",
      message: `mapping ${id} status changed before rejection could land (no longer pending)`,
    });
  }

  return {
    mapping: data as PayrollMappingRow,
    before: prev.mapping,
  };
}
