import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { readJsonBody, toErrorResponse } from "@/lib/server/http";
import { rejectExtractedFields } from "@/lib/server/plans";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

const rejectBodySchema = z.object({
  approver_name: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
});

/**
 * POST /api/plans/[id]/extracted-fields/reject
 *
 * Reject the agent's extraction. `reason` is mandatory -- this is a
 * rejection ledger entry, so an empty reason is a feature gap, not an
 * accidental click. Flips `extraction_status` to 'failed' and writes
 * a `PLAN_DETAILS_REJECTED` audit row whose `before_value` snapshots
 * what the agent had produced.
 *
 * Status flow mirrors the approve route:
 *   - 200: row reaches extraction_status='failed'
 *   - 400: validation error (bad uuid, missing reason)
 *   - 404: no plan with that id
 *   - 409: plan exists but extraction_status != 'in_review'
 *   - 500: data layer or other internal error
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = await readJsonBody(request, rejectBodySchema);

    const { plan, before } = await rejectExtractedFields(id, {
      approver_name: body.approver_name,
      reason: body.reason,
    });

    const audit = await writeAuditLog({
      actor_type: "user",
      actor_name: body.approver_name,
      action: "PLAN_DETAILS_REJECTED",
      entity_type: "plan",
      entity_id: id,
      before_value: before,
      reason: body.reason,
      status: "failed",
    });

    return Response.json({ plan, audit_log_id: audit.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
