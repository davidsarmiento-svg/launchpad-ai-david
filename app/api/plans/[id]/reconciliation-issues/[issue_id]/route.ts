import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { readJsonBody, toErrorResponse } from "@/lib/server/http";
import {
  updateIssueStatus,
  updateIssueStatusInputSchema,
} from "@/lib/server/reconciliation-issues";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
});

/**
 * PATCH /api/plans/[id]/reconciliation-issues/[issue_id]
 *
 * Manual triage for an open reconciliation_issue that has no
 * suggested fix (or whose suggested fix the reviewer doesn't want
 * to act on). Flips status to 'resolved' or 'ignored' and writes
 * the appropriate audit row.
 *
 * Reuses `updateIssueStatusInputSchema` from the DAL so the route's
 * body shape stays in lockstep with the persistence contract.
 *
 * Status flow:
 *   - 200: issue reaches status='resolved' or status='ignored'.
 *   - 400: bad uuid / missing resolved_by / missing reason / bad status.
 *   - 404: no reconciliation_issues row with that id.
 *   - 409: issue exists but isn't 'open' (already resolved/ignored).
 *   - 500: data-layer error.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; issue_id: string }> },
) {
  try {
    const { id, issue_id } = paramsSchema.parse(await ctx.params);
    // id is currently unused in the route body -- the DAL operates
    // on (issue_id). We parse it for URL-shape validation so a
    // wrong-shaped plan slug fails fast as 400.
    void id;

    const body = await readJsonBody(request, updateIssueStatusInputSchema);

    const { issue, before } = await updateIssueStatus(issue_id, body);

    const action = body.status === "resolved" ? "ISSUE_RESOLVED" : "ISSUE_IGNORED";

    const audit = await writeAuditLog({
      actor_type: "user",
      actor_name: body.resolved_by,
      action,
      entity_type: "reconciliation_issue",
      entity_id: issue_id,
      ...(before.payroll_run_id
        ? { payroll_run_id: before.payroll_run_id }
        : {}),
      before_value: { status: "open" },
      after_value: { status: body.status },
      reason: body.reason,
      status: body.status,
    });

    return Response.json({ issue, audit_log_id: audit.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
