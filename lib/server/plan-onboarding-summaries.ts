import "server-only";

import { listParticipants } from "@/lib/server/participants";
import { getLatestPendingMappingForPlan } from "@/lib/server/payroll-mappings";
import { listPayrollRunsForPlan } from "@/lib/server/payroll-runs";
import { listPlans } from "@/lib/server/plans";
import { listIssuesForPlan } from "@/lib/server/reconciliation-issues";

export type PlanOnboardingSummary = {
  id: string;
  employer_name: string;
  plan_name: string | null;
  plan_year: number | null;
  status: string;
  extraction_status: string;
  created_at: string;
  participant_count: number;
  payroll_run_count: number;
  runs_mapped: number;
  runs_reconciled: number;
  open_issues: number;
  has_pending_mapping: boolean;
};

export async function listPlanOnboardingSummaries(
  limit = 50,
): Promise<PlanOnboardingSummary[]> {
  const plans = await listPlans(limit);

  return Promise.all(
    plans.map(async (plan) => {
      const [participants, runs, issues, pendingMapping] = await Promise.all([
        listParticipants({ plan_id: plan.id, limit: 200 }),
        listPayrollRunsForPlan(plan.id),
        listIssuesForPlan(plan.id),
        getLatestPendingMappingForPlan(plan.id),
      ]);

      return {
        id: plan.id,
        employer_name: plan.employer_name,
        plan_name: plan.plan_name,
        plan_year: plan.plan_year,
        status: plan.status,
        extraction_status: plan.extraction_status,
        created_at: plan.created_at,
        participant_count: participants.length,
        payroll_run_count: runs.length,
        runs_mapped: runs.filter((r) =>
          ["mapped", "reconciled"].includes(r.status),
        ).length,
        runs_reconciled: runs.filter((r) => r.status === "reconciled").length,
        open_issues: issues.filter((i) => i.status === "open").length,
        has_pending_mapping: pendingMapping != null,
      };
    }),
  );
}
