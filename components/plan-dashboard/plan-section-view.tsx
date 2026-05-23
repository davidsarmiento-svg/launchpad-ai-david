"use client";

import { PlanDetailClient } from "@/components/plan-detail-client";
import { usePlanDashboard } from "@/components/plan-dashboard/plan-dashboard-context";
import type { PlanDashboardSection } from "@/lib/plan-dashboard-sections";
import { getPlanDashboardSection } from "@/lib/plan-dashboard-sections";

export function PlanSectionView({ section }: { section: PlanDashboardSection }) {
  const data = usePlanDashboard();
  const meta = getPlanDashboardSection(section);

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-xl border bg-background px-5 py-4 shadow-sm">
        <h2 className="text-lg font-semibold">{meta.label}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
      </header>

      <PlanDetailClient
        section={section}
        plan={data.plan}
        files={data.files}
        participants={data.participants}
        payrollRuns={data.payrollRuns}
        pendingMapping={data.pendingMapping}
        approvedMapping={data.approvedMapping}
        issues={data.issues}
        fixesByIssueId={data.fixesByIssueId}
        auditLogs={data.auditLogs}
      />
    </div>
  );
}
