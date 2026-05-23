import { z, ZodError } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import {
  ConflictError,
  DataLayerError,
  NotFoundError,
} from "@/lib/server/errors";
import { toErrorResponse } from "@/lib/server/http";
import { runReconciliation } from "@/lib/server/reconciliation-runner";

export const dynamic = "force-dynamic";

/**
 * Reconciliation is a heavier agent loop than mapping: up to 16
 * iterations and 16k tokens, plus a wide context fetch (plan,
 * census, current records, prior-run YTDs). 120 s keeps us inside
 * Vercel Pro's function-timeout ceiling while leaving headroom for
 * the model's slower paths.
 */
export const maxDuration = 120;

const paramsSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
});

const AGENT_NAME = "payroll-reconciliation-agent";

/**
 * POST /api/plans/[id]/payroll-runs/[run_id]/reconcile
 *
 * Run the Payroll Reconciliation Agent against a `mapped` payroll
 * run. The runner gathers plan + census + current records + prior-
 * run YTDs + prior issues, hands them to Claude, and on a clean
 * `end_turn` flips the run to `reconciled` with an
 * `issue_count`. Otherwise the run stays `mapped` (re-runnable)
 * and the runner itself writes a `RECONCILIATION_FAILED` audit row.
 *
 * Body: empty `{}` accepted; any extra keys are ignored.
 *
 * Status flow:
 *   - 200: agent ran (regardless of whether it ended with 0 or N
 *          issues). Body carries `final_status` so the caller can
 *          distinguish 'reconciled' from 'mapped'.
 *   - 400: bad uuid (params), or plan/run mismatch.
 *   - 404: payroll_runs row missing.
 *   - 409: run.status != 'mapped' (already reconciled, never
 *          mapped, etc.).
 *   - 500: unexpected failure outside the runner (e.g. supabase
 *          connection error before the runner could write its own
 *          RECONCILIATION_FAILED audit). The route writes a
 *          RECONCILIATION_FAILED audit in this branch so the ledger
 *          is never empty for a failed reconcile attempt.
 *
 * The runner is responsible for the non-end_turn audit; the route
 * only writes RECONCILIATION_FAILED for "wild" errors that bypass
 * the runner entirely.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; run_id: string }> },
) {
  let id: string | undefined;
  let run_id: string | undefined;

  try {
    const params = paramsSchema.parse(await ctx.params);
    id = params.id;
    run_id = params.run_id;

    // Body is ignored -- reconcile takes no parameters. We consume
    // whatever the client sends so a JSON-content-type request with
    // `{}` (or anything else) doesn't trip the runtime.
    await request.json().catch(() => ({}));

    const result = await runReconciliation({
      plan_id: id,
      payroll_run_id: run_id,
    });

    return Response.json({
      run_id: result.run_id,
      plan_id: result.plan_id,
      stop_reason: result.stop_reason,
      iterations: result.iterations,
      tool_calls: result.tool_calls,
      issue_count: result.issue_count,
      final_status: result.final_status,
    });
  } catch (err) {
    // Well-known runner errors: surface verbatim, no extra audit.
    // The runner has its own RECONCILIATION_FAILED write for the
    // "agent didn't end_turn" path; these branches fire BEFORE the
    // agent ever runs (validation failures), so no audit is owed.
    if (err instanceof ZodError) {
      return toErrorResponse(err);
    }
    if (err instanceof NotFoundError) {
      return toErrorResponse(err);
    }
    if (err instanceof ConflictError) {
      return toErrorResponse(err);
    }
    if (
      err instanceof DataLayerError &&
      err.message.includes("plan_run_mismatch")
    ) {
      return Response.json(
        {
          error: "plan_run_mismatch",
          message: err.message,
        },
        { status: 400 },
      );
    }
    if (err instanceof DataLayerError) {
      // Generic DataLayerError thrown by the runner (e.g. the atomic
      // status flip lost a race). The runner has already done what
      // it can; surface as 500 without doubling up audits.
      return toErrorResponse(err);
    }

    // Catch-all: this is a "wild" error that bypassed the runner's
    // own failure path (e.g. supabase connection blew up before the
    // agent could file its audit). Write a RECONCILIATION_FAILED
    // entry here so the ledger always has a record of the attempt.
    const message = err instanceof Error ? err.message : String(err);
    if (run_id) {
      try {
        await writeAuditLog({
          actor_type: "agent",
          actor_name: AGENT_NAME,
          action: "RECONCILIATION_FAILED",
          entity_type: "payroll_run",
          entity_id: run_id,
          payroll_run_id: run_id,
          reason: message.slice(0, 2000),
          status: "failed",
        });
      } catch (auditErr) {
        // Audit failure during a failure -- log and move on. The
        // response still tells the user the reconcile failed.
        console.error(
          "[reconcile] failed to write RECONCILIATION_FAILED audit",
          auditErr,
        );
      }
    }
    return Response.json(
      { error: "reconciliation_failed", message },
      { status: 500 },
    );
  }
}
