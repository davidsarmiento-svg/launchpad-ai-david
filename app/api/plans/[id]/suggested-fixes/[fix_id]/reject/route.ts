import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { readJsonBody, toErrorResponse } from "@/lib/server/http";
import { rejectSuggestedFix } from "@/lib/server/suggested-fixes";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
  fix_id: z.string().uuid(),
});

const rejectBodySchema = z.object({
  reviewer_name: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
});

/**
 * POST /api/plans/[id]/suggested-fixes/[fix_id]/reject
 *
 * Reject a pending `suggested_fixes` row. `reason` is mandatory --
 * rejecting an agent proposal without committing to a rationale
 * silently degrades the feedback signal we send back into future
 * runs. The fix flips status to 'rejected' and the FIX_REJECTED
 * audit row carries the before-snapshot.
 *
 * Note: rejecting a fix does NOT resolve the parent issue. A
 * reviewer who rejects "the agent's suggested fix is wrong" might
 * still want to address the underlying issue manually (mark
 * resolved / ignored via the issue route) or wait for a re-run
 * with better context.
 *
 * Status flow mirrors the mapping reject route:
 *   - 200: fix reaches status='rejected'.
 *   - 400: bad uuid / missing reviewer_name / missing reason.
 *   - 404: no suggested_fixes row with that id.
 *   - 409: fix exists but isn't 'pending'.
 *   - 500: data-layer error.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; fix_id: string }> },
) {
  try {
    const { id, fix_id } = paramsSchema.parse(await ctx.params);
    // id is currently unused in the route body -- the DAL operates
    // on (fix_id) and the audit anchors on the fix entity. We still
    // parse it for URL-shape validation so a wrong-shaped plan slug
    // fails fast as 400 instead of leaking through to the DAL.
    void id;

    const body = await readJsonBody(request, rejectBodySchema);

    const { fix, before } = await rejectSuggestedFix(fix_id, {
      decided_by: body.reviewer_name,
      reason: body.reason,
    });

    const audit = await writeAuditLog({
      actor_type: "user",
      actor_name: body.reviewer_name,
      action: "FIX_REJECTED",
      entity_type: "suggested_fix",
      entity_id: fix_id,
      before_value: { status: "pending", fix: before },
      after_value: { status: "rejected" },
      reason: body.reason,
      status: "rejected",
    });

    return Response.json({ fix, audit_log_id: audit.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
