import { writeAuditLog } from "@/lib/server/audit-log";
import { readJsonBody, toErrorResponse } from "@/lib/server/http";
import {
  createPlan,
  createPlanInputSchema,
  listPlans,
} from "@/lib/server/plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/plans
 *
 * List recent plans for pickers (e.g. the Upload card). Capped at 50.
 */
export async function GET() {
  try {
    const rows = await listPlans(50);
    return Response.json({ plans: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/plans
 *
 * Create a draft plan. In the eventual product, plans are bootstrapped
 * by the Plan Extraction Agent during a plan-PDF upload. Until that
 * agent exists (Phase 7), this endpoint lets us seed a plan manually
 * so the upload + reconciliation slices have something to attach to.
 *
 * Body: { employer_name, plan_name?, plan_year?, status? }
 */
export async function POST(request: Request) {
  try {
    const input = await readJsonBody(request, createPlanInputSchema);
    const plan = await createPlan(input);

    await writeAuditLog({
      actor_type: "user",
      actor_name: "system_demo_user",
      action: "PLAN_CREATED",
      entity_type: "plan",
      entity_id: plan.id,
      after_value: {
        employer_name: plan.employer_name,
        plan_name: plan.plan_name,
        plan_year: plan.plan_year,
        status: plan.status,
      },
      reason: "Draft plan created via POST /api/plans",
    });

    return Response.json({ plan }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
