import "server-only";

import { z } from "zod";

import {
  ConflictError,
  DataLayerError,
  NotFoundError,
} from "@/lib/server/errors";
import {
  suggestedFixInputSchema,
  type ProposedChanges,
} from "@/lib/server/reconciliation";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Data access for `suggested_fixes`. One row per agent-proposed
 * mechanical mutation tied to a `reconciliation_issues` row.
 *
 * Lifecycle: pending -> approved | rejected -> applied | failed.
 *
 * Two DB-level guard rails on this table that the helpers below
 * preserve:
 *
 *   1. `suggested_fixes_decided_when_terminal` -- every transition
 *      out of 'pending' MUST set decided_by and decided_at. The
 *      approve/reject helpers do this; the apply-side mark helpers
 *      run only AFTER approve has landed, so decided_by is already
 *      set by the time they fire.
 *   2. `suggested_fixes_applied_at_present` -- 'applied' rows MUST
 *      have applied_at non-null. `markSuggestedFixApplied` sets it.
 *
 * All status transitions are atomic UPDATEs filtered on the prior
 * status so a concurrent transition raises ConflictError instead of
 * silently overwriting state.
 *
 * Audit-log writes live at the route boundary, not here -- this
 * module returns `{ fix, before }` on transitions so the route can
 * record who decided/applied/failed which fix and why.
 */

export type SuggestedFixStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "failed";

export type SuggestedFixRow = {
  id: string;
  issue_id: string;
  description: string;
  /** jsonb -- a parsed ProposedChanges discriminated union value. */
  proposed_changes: ProposedChanges;
  /** numeric(3,2) returned by supabase-js as string. */
  confidence: string;
  agent_reasoning: string | null;
  status: SuggestedFixStatus;
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  applied_at: string | null;
  apply_error: string | null;
};

const uuid = z.string().uuid();

/**
 * Input for `createSuggestedFix`. Extends the agent-facing shape
 * from the shared module with the FK anchor (`issue_id`) the DAL
 * needs.
 */
export const createSuggestedFixInputSchema = suggestedFixInputSchema.extend({
  issue_id: uuid,
});

export type CreateSuggestedFixInput = z.infer<
  typeof createSuggestedFixInputSchema
>;

/**
 * Insert one suggested_fixes row tied to a reconciliation issue.
 * Status defaults to 'pending'; the decided/applied metadata is
 * left null and the DB CHECK is satisfied because we're in the
 * pending state.
 *
 * `proposed_changes` is stored verbatim as jsonb -- the fix applier
 * re-parses it through `proposedChangesSchema` at apply time, so
 * stored-shape drift fails loudly at the apply boundary, not
 * silently here.
 */
export async function createSuggestedFix(
  input: CreateSuggestedFixInput,
): Promise<SuggestedFixRow> {
  const parsed = createSuggestedFixInputSchema.parse(input);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("suggested_fixes")
    .insert({
      issue_id: parsed.issue_id,
      description: parsed.description,
      proposed_changes: parsed.proposed_changes,
      confidence: parsed.confidence,
      agent_reasoning: parsed.agent_reasoning,
      status: "pending",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new DataLayerError({
      module: "suggested-fixes",
      operation: "createSuggestedFix",
      message: error?.message ?? "insert returned no row",
      cause: error,
    });
  }

  return data as SuggestedFixRow;
}

/**
 * Look up a single fix by id. Returns null when the id is well
 * formed but no row matches.
 */
export async function getSuggestedFix(
  id: string,
): Promise<SuggestedFixRow | null> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("suggested_fixes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "suggested-fixes",
      operation: "getSuggestedFix",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as SuggestedFixRow | null;
}

/**
 * All fixes attached to one issue, most-recently-proposed first.
 * Used by the UI to render fix history under each issue card; a
 * single issue may have multiple historical fixes (rejected ones
 * stay around for audit) and a single pending one awaiting review.
 */
export async function listSuggestedFixesForIssue(
  issue_id: string,
): Promise<SuggestedFixRow[]> {
  uuid.parse(issue_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("suggested_fixes")
    .select("*")
    .eq("issue_id", issue_id)
    .order("proposed_at", { ascending: false });

  if (error) {
    throw new DataLayerError({
      module: "suggested-fixes",
      operation: "listSuggestedFixesForIssue",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as SuggestedFixRow[];
}

/**
 * Every pending fix attached to issues belonging to one payroll
 * run. Joins through `reconciliation_issues` using a Postgres-side
 * inner join (`reconciliation_issues!inner(...)`) so PostgREST
 * filters the fix rows by the joined-issue's payroll_run_id. Used
 * by the UI to surface "N pending approvals" badges on a run.
 */
export async function listPendingSuggestedFixesForRun(
  payroll_run_id: string,
): Promise<SuggestedFixRow[]> {
  uuid.parse(payroll_run_id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("suggested_fixes")
    .select("*, reconciliation_issues!inner(payroll_run_id)")
    .eq("status", "pending")
    .eq("reconciliation_issues.payroll_run_id", payroll_run_id)
    .order("proposed_at", { ascending: false });

  if (error) {
    throw new DataLayerError({
      module: "suggested-fixes",
      operation: "listPendingSuggestedFixesForRun",
      message: error.message,
      cause: error,
    });
  }

  type Joined = SuggestedFixRow & {
    reconciliation_issues: { payroll_run_id: string | null } | null;
  };

  return ((data ?? []) as Joined[]).map((row) => {
    const { reconciliation_issues: _join, ...fix } = row;
    void _join;
    return fix as SuggestedFixRow;
  });
}

/**
 * Approval input. `reason` is optional on approve because the act
 * of clicking "approve" is its own affirmation; the inline
 * description + agent_reasoning on the row already explains the
 * "why" of the fix. When `reason` is provided, the route layer
 * passes it to the audit log.
 */
export const approveSuggestedFixInputSchema = z.object({
  decided_by: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000).optional(),
});

export type ApproveSuggestedFixInput = z.infer<
  typeof approveSuggestedFixInputSchema
>;

export type ApproveSuggestedFixResult = {
  fix: SuggestedFixRow;
  before: SuggestedFixRow;
};

/**
 * Approve a pending fix. Atomic UPDATE filtered on
 * `status = 'pending'`; sets status='approved', decided_by,
 * decided_at = now(). Does NOT trigger the apply -- the route
 * layer composes approve + apply in sequence so audit entries
 * (FIX_APPROVED, then FIX_APPLIED or FIX_APPLY_FAILED) bracket
 * each step.
 *
 *   - Missing id -> NotFoundError('suggested_fix', id).
 *   - Wrong status -> ConflictError('fix_not_pending').
 *
 * Returns the post-update row plus a pre-update snapshot for the
 * audit-log entry.
 */
export async function approveSuggestedFix(
  id: string,
  input: ApproveSuggestedFixInput,
): Promise<ApproveSuggestedFixResult> {
  uuid.parse(id);
  const parsed = approveSuggestedFixInputSchema.parse(input);

  const prev = await getSuggestedFix(id);
  if (!prev) {
    throw new NotFoundError({
      module: "suggested-fixes",
      operation: "approveSuggestedFix",
      message: `no suggested_fixes row with id ${id}`,
    });
  }
  if (prev.status !== "pending") {
    throw new ConflictError({
      module: "suggested-fixes",
      operation: "approveSuggestedFix",
      message: "fix_not_pending",
    });
  }

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("suggested_fixes")
    .update({
      status: "approved",
      decided_by: parsed.decided_by,
      decided_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "suggested-fixes",
      operation: "approveSuggestedFix",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "suggested-fixes",
      operation: "approveSuggestedFix",
      message: "fix_not_pending",
    });
  }

  return { fix: data as SuggestedFixRow, before: prev };
}

/**
 * Rejection input. `reason` is REQUIRED on reject -- "no" without a
 * reason is the most demoralizing signal an agent can receive, and
 * the human needs to commit to a rationale before nuking a fix.
 */
export const rejectSuggestedFixInputSchema = z.object({
  decided_by: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
});

export type RejectSuggestedFixInput = z.infer<
  typeof rejectSuggestedFixInputSchema
>;

export type RejectSuggestedFixResult = {
  fix: SuggestedFixRow;
  before: SuggestedFixRow;
};

/**
 * Reject a pending fix. Atomic UPDATE filtered on
 * `status = 'pending'`; sets status='rejected', decided_by,
 * decided_at = now(), apply_error = null (a rejection clears any
 * stale apply error from a prior failed attempt, though in
 * practice failed rows aren't reachable from the reject path).
 *
 *   - Missing id -> NotFoundError('suggested_fix', id).
 *   - Wrong status -> ConflictError('fix_not_pending').
 */
export async function rejectSuggestedFix(
  id: string,
  input: RejectSuggestedFixInput,
): Promise<RejectSuggestedFixResult> {
  uuid.parse(id);
  const parsed = rejectSuggestedFixInputSchema.parse(input);

  const prev = await getSuggestedFix(id);
  if (!prev) {
    throw new NotFoundError({
      module: "suggested-fixes",
      operation: "rejectSuggestedFix",
      message: `no suggested_fixes row with id ${id}`,
    });
  }
  if (prev.status !== "pending") {
    throw new ConflictError({
      module: "suggested-fixes",
      operation: "rejectSuggestedFix",
      message: "fix_not_pending",
    });
  }

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("suggested_fixes")
    .update({
      status: "rejected",
      decided_by: parsed.decided_by,
      decided_at: nowIso,
      apply_error: null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "suggested-fixes",
      operation: "rejectSuggestedFix",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "suggested-fixes",
      operation: "rejectSuggestedFix",
      message: "fix_not_pending",
    });
  }

  return { fix: data as SuggestedFixRow, before: prev };
}

/**
 * Mark an approved fix as 'applied' AFTER the applier dispatch ran
 * successfully. Atomic UPDATE filtered on `status = 'approved'`;
 * sets applied_at. ConflictError('fix_not_approved') on zero rows
 * updated (e.g. concurrent retry already landed).
 *
 * The route layer calls this AFTER `applyProposedChanges` returns
 * cleanly. Both checks together guarantee the applied_at column
 * is non-null on every 'applied' row (matches the CHECK constraint
 * `suggested_fixes_applied_at_present`).
 */
export async function markSuggestedFixApplied(
  id: string,
  opts: { applied_at: string },
): Promise<SuggestedFixRow> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("suggested_fixes")
    .update({
      status: "applied",
      applied_at: opts.applied_at,
      apply_error: null,
    })
    .eq("id", id)
    .eq("status", "approved")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "suggested-fixes",
      operation: "markSuggestedFixApplied",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "suggested-fixes",
      operation: "markSuggestedFixApplied",
      message: "fix_not_approved",
    });
  }

  return data as SuggestedFixRow;
}

/**
 * Mark an approved fix as 'failed' AFTER the applier dispatch
 * threw. Atomic UPDATE filtered on `status = 'approved'`; stores
 * the error message in `apply_error` for the audit-log entry and
 * the UI's "fix could not be applied" surface.
 *
 * ConflictError('fix_not_approved') on zero rows updated.
 *
 * Note: this is best-effort. If a concurrent caller already marked
 * the row 'applied', the apply must have actually succeeded once
 * and we don't want to overwrite that with 'failed'. The atomic
 * filter prevents that overwrite.
 */
export async function markSuggestedFixFailed(
  id: string,
  opts: { apply_error: string },
): Promise<SuggestedFixRow> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("suggested_fixes")
    .update({
      status: "failed",
      apply_error: opts.apply_error,
    })
    .eq("id", id)
    .eq("status", "approved")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "suggested-fixes",
      operation: "markSuggestedFixFailed",
      message: error.message,
      cause: error,
    });
  }
  if (!data) {
    throw new ConflictError({
      module: "suggested-fixes",
      operation: "markSuggestedFixFailed",
      message: "fix_not_approved",
    });
  }

  return data as SuggestedFixRow;
}
