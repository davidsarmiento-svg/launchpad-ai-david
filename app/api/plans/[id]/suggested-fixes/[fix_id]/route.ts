import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { readJsonBody, toErrorResponse } from "@/lib/server/http";
import { applyProposedChanges } from "@/lib/server/fix-appliers";
import { proposedChangesSchema } from "@/lib/server/reconciliation";
import { setIssueStatusResolvedByApplier } from "@/lib/server/reconciliation-issues";
import {
  approveSuggestedFix,
  markSuggestedFixApplied,
  markSuggestedFixFailed,
  type SuggestedFixRow,
} from "@/lib/server/suggested-fixes";

import type { ApplyResult } from "@/lib/server/fix-appliers";
import type { ProposedChanges } from "@/lib/server/reconciliation";

export const dynamic = "force-dynamic";

/**
 * Apply can hit two tables (payroll_records / participants) with an
 * OCC read+write and write up to three audit rows. 60 s mirrors the
 * mapping approve route and stays well inside Vercel Pro's
 * function-timeout ceiling.
 */
export const maxDuration = 60;

const paramsSchema = z.object({
  id: z.string().uuid(),
  fix_id: z.string().uuid(),
});

const approveBodySchema = z.object({
  approver_name: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000).optional(),
});

const APPLIER_NAME = "fix-applier";

/**
 * PATCH /api/plans/[id]/suggested-fixes/[fix_id]
 *
 * Approve a pending `suggested_fixes` row AND immediately apply it.
 * Mirrors the mapping approve route's "approve + ingest in same
 * call" pattern: the approve itself never rolls back, but the apply
 * is best-effort and never demotes the response below 200 once the
 * approve has landed.
 *
 * Two paths after approve:
 *
 *   1. Apply succeeds. Audit `FIX_APPLIED` (system / fix-applier),
 *      flip the suggested_fix to 'applied', resolve the parent
 *      reconciliation_issue. 200 with `applied: true`.
 *
 *   2. Apply fails (OCC conflict, missing row, schema drift). Audit
 *      `FIX_APPLY_FAILED` (system / fix-applier), flip the
 *      suggested_fix to 'failed' with the truncated error in
 *      `apply_error`. 200 with `applied: false` -- the user already
 *      saw "approval landed", so a non-2xx here would be misleading.
 *
 * Status flow:
 *   - 200: approve landed (apply may have succeeded OR failed).
 *   - 400: bad uuid / malformed body / missing approver_name.
 *   - 404: no suggested_fixes row with that id.
 *   - 409: fix exists but isn't 'pending' (already approved,
 *          rejected, applied, or failed).
 *   - 500: data-layer error during the approve step itself, OR a
 *          well-known DataLayerError surfaces unexpectedly.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; fix_id: string }> },
) {
  try {
    const { id, fix_id } = paramsSchema.parse(await ctx.params);
    const body = await readJsonBody(request, approveBodySchema);

    // ---- Step 1: approve (atomic pending -> approved) -------------------
    // ConflictError / NotFoundError flow through toErrorResponse to
    // 409 / 404. After this point, NO non-2xx escapes from the
    // happy path -- the approval has landed in the DB and the
    // ledger row is non-cancellable.
    const { fix: approved } = await approveSuggestedFix(fix_id, {
      decided_by: body.approver_name,
      reason: body.reason,
    });

    const approveAudit = await writeAuditLog({
      actor_type: "user",
      actor_name: body.approver_name,
      action: "FIX_APPROVED",
      entity_type: "suggested_fix",
      entity_id: fix_id,
      before_value: { status: "pending" },
      after_value: { status: "approved" },
      reason: body.reason ?? "Fix approved",
      status: "approved",
    });

    // ---- Step 2: apply (best-effort, never demotes the response) --------
    // Re-validate proposed_changes through Zod here so a stored-
    // shape drift (theoretically impossible -- the tool handler
    // validates at write time -- but defense in depth) surfaces as
    // an apply error, not as a wild throw. Plan_id is also
    // available for downstream auditing.
    void id;
    let parsedChanges: ProposedChanges;
    try {
      parsedChanges = proposedChangesSchema.parse(approved.proposed_changes);
    } catch (parseErr) {
      const parseMsg =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      return await handleApplyFailure({
        fix_id,
        approveAuditId: approveAudit.id,
        message: `proposed_changes_invalid: ${parseMsg}`,
      });
    }

    let applyResult: ApplyResult;
    try {
      applyResult = await applyProposedChanges(parsedChanges);
    } catch (applyErr) {
      const applyMsg =
        applyErr instanceof Error ? applyErr.message : String(applyErr);
      return await handleApplyFailure({
        fix_id,
        approveAuditId: approveAudit.id,
        message: applyMsg,
      });
    }

    // ---- Step 3: success bookkeeping ------------------------------------
    const nowIso = new Date().toISOString();
    let appliedFix: SuggestedFixRow;
    try {
      appliedFix = await markSuggestedFixApplied(fix_id, {
        applied_at: nowIso,
      });
    } catch (markErr) {
      // The mutation already landed; flagging the fix as failed
      // would be a lie. Log loudly and return the approved row so
      // the UI knows the apply itself succeeded.
      console.error(
        "[suggested-fixes] apply succeeded but markSuggestedFixApplied threw",
        markErr,
      );
      appliedFix = approved;
    }

    // Resolve the parent issue. If a concurrent path already marked
    // it resolved, the DAL throws ConflictError('issue_not_open');
    // we swallow that because the apply already accomplished the
    // user-visible goal (the issue's root cause is fixed).
    try {
      await setIssueStatusResolvedByApplier(approved.issue_id, nowIso);
    } catch (resolveErr) {
      console.warn(
        "[suggested-fixes] could not auto-resolve parent issue",
        resolveErr,
      );
    }

    const appliedAudit = await writeAuditLog({
      actor_type: "system",
      actor_name: APPLIER_NAME,
      action: "FIX_APPLIED",
      entity_type: "suggested_fix",
      entity_id: fix_id,
      ...(derivePayrollRunId(parsedChanges)
        ? { payroll_run_id: derivePayrollRunId(parsedChanges) as string }
        : {}),
      ...(deriveEmployeeId(parsedChanges, applyResult)
        ? { employee_id: deriveEmployeeId(parsedChanges, applyResult) as string }
        : {}),
      before_value: applyResult.before,
      after_value: applyResult.after,
      reason: `${parsedChanges.kind} applied successfully`,
      status: "applied",
    });

    return Response.json({
      fix: appliedFix,
      audit_log_id: appliedAudit.id,
      audit_log_id_approve: approveAudit.id,
      applied: true,
      applier_result: {
        kind: applyResult.kind,
        before: applyResult.before,
        after: applyResult.after,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Apply-side failure path. Truncates the error to 500 chars (the
 * `apply_error` column max), writes the FIX_APPLY_FAILED audit, and
 * returns 200 -- the approve already landed and the ledger now has
 * both audit entries explaining what happened.
 *
 * Best-effort throughout: a failure to flip the row to 'failed' or
 * write the audit is logged but never raised, because raising would
 * turn a partially-successful apply into a 500 and lose the
 * approver's signal.
 */
async function handleApplyFailure(args: {
  fix_id: string;
  approveAuditId: string;
  message: string;
}): Promise<Response> {
  const { fix_id, approveAuditId, message } = args;
  const truncated = message.slice(0, 500);

  let failedFix: SuggestedFixRow | null = null;
  try {
    failedFix = await markSuggestedFixFailed(fix_id, {
      apply_error: truncated,
    });
  } catch (markErr) {
    console.error(
      "[suggested-fixes] apply failed AND markSuggestedFixFailed threw",
      markErr,
    );
  }

  let failedAuditId: string | undefined;
  try {
    const failedAudit = await writeAuditLog({
      actor_type: "system",
      actor_name: APPLIER_NAME,
      action: "FIX_APPLY_FAILED",
      entity_type: "suggested_fix",
      entity_id: fix_id,
      reason: truncated,
      status: "failed",
    });
    failedAuditId = failedAudit.id;
  } catch (auditErr) {
    console.error(
      "[suggested-fixes] failed to write FIX_APPLY_FAILED audit",
      auditErr,
    );
  }

  return Response.json({
    fix: failedFix,
    audit_log_id_approve: approveAuditId,
    ...(failedAuditId ? { audit_log_id_failed: failedAuditId } : {}),
    applied: false,
    error: message,
  });
}

/**
 * Derive a `payroll_run_id` for the FIX_APPLIED audit when the
 * mutation kind anchors to a run. Only `payroll_record.update`
 * gives us one; the spec is deliberately narrow here so we don't
 * mislabel participant-side audits with a run id that just happened
 * to be in the changeset.
 */
function derivePayrollRunId(changes: ProposedChanges): string | undefined {
  if (changes.kind === "payroll_record.update") return changes.run_id;
  return undefined;
}

/**
 * Derive an `employee_id` for the FIX_APPLIED audit. Pulled from
 * the applier's before/after snapshot where possible:
 *
 *   - `participant.update` -- natural key on the changeset.
 *   - `participant.create_from_payroll` -- the after-snapshot
 *     carries the freshly-inserted employee_id.
 *   - `payroll_record.update` -- only present if employee_id was
 *     itself one of the edited fields; otherwise undefined.
 */
function deriveEmployeeId(
  changes: ProposedChanges,
  result: ApplyResult,
): string | undefined {
  if (changes.kind === "participant.update") return changes.employee_id;
  if (changes.kind === "participant.create_from_payroll") {
    const eid = result.after.employee_id;
    return typeof eid === "string" ? eid : undefined;
  }
  const before = result.before.employee_id;
  if (typeof before === "string") return before;
  const after = result.after.employee_id;
  if (typeof after === "string") return after;
  return undefined;
}
