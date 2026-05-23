import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { readJsonBody, toErrorResponse } from "@/lib/server/http";
import { rejectMapping } from "@/lib/server/payroll-mappings";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
  mapping_id: z.string().uuid(),
});

const rejectBodySchema = z.object({
  reviewer_name: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
});

/**
 * POST /api/plans/[id]/payroll-mappings/[mapping_id]/reject
 *
 * Reject a pending mapping. `reason` is mandatory -- a rejection is
 * a ledger entry and we want the reviewer's note on every one. The
 * mapping row flips status to 'rejected' and the
 * PAYROLL_MAPPING_REJECTED audit row carries the before-snapshot of
 * the mapping payload so the audit trail can show exactly what was
 * thrown away.
 *
 * Status flow mirrors the approve route:
 *   - 200: mapping reaches status='rejected'.
 *   - 400: bad uuid / missing reviewer_name / missing reason.
 *   - 404: no mapping with that id.
 *   - 409: mapping exists but isn't 'pending'.
 *   - 500: data-layer error.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; mapping_id: string }> },
) {
  try {
    const { id, mapping_id } = paramsSchema.parse(await ctx.params);
    const body = await readJsonBody(request, rejectBodySchema);

    const { mapping, before } = await rejectMapping(mapping_id, body);

    const audit = await writeAuditLog({
      actor_type: "user",
      actor_name: body.reviewer_name,
      action: "PAYROLL_MAPPING_REJECTED",
      entity_type: "plan",
      entity_id: id,
      before_value: { mapping: before, mapping_id: mapping.id },
      reason: body.reason,
      status: "failed",
    });

    return Response.json({ mapping, audit_log_id: audit.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
