import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { readJsonBody, toErrorResponse } from "@/lib/server/http";
import { extractedPlanFieldsSchema } from "@/lib/server/plan-extraction";
import { approveExtractedFields } from "@/lib/server/plans";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

const approveBodySchema = z.object({
  extracted_fields: extractedPlanFieldsSchema,
  approver_name: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000).optional(),
});

/**
 * PATCH /api/plans/[id]/extracted-fields
 *
 * Approve the agent's extraction (with optional human edits). The body
 * carries the full extracted_fields object -- the form re-submits the
 * agent's values for any field the human didn't touch, so any field
 * that differs is by definition a human edit. The audit row's
 * before/after pair captures the full diff.
 *
 * Status flow:
 *   - 200: row reaches extraction_status='approved', plans.status='active'
 *   - 400: validation error (bad uuid, malformed fields, e.g. EIN regex)
 *   - 404: no plan with that id
 *   - 409: plan exists but extraction_status != 'in_review' (already
 *          approved/rejected, or extraction never ran)
 *   - 500: data layer or other internal error
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = await readJsonBody(request, approveBodySchema);

    const { plan, before, after } = await approveExtractedFields(id, {
      extracted_fields: body.extracted_fields,
      approver_name: body.approver_name,
      reason: body.reason,
    });

    const audit = await writeAuditLog({
      actor_type: "user",
      actor_name: body.approver_name,
      action: "PLAN_DETAILS_APPROVED",
      entity_type: "plan",
      entity_id: id,
      before_value: before,
      after_value: after,
      reason: body.reason ?? "Plan details approved",
      status: "approved",
    });

    return Response.json({ plan, audit_log_id: audit.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
