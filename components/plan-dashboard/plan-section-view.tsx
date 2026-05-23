"use client";

import { PlanDetailClient } from "@/components/plan-detail-client";
import { PlanSectionShell } from "@/components/dashboard/plan-section-shell";
import { SupportBanner } from "@/components/dashboard/support-banner";
import { usePlanDashboard } from "@/components/plan-dashboard/plan-dashboard-context";
import type { PlanDashboardSection } from "@/lib/plan-dashboard-sections";

export function PlanSectionView({ section }: { section: PlanDashboardSection }) {
  const data = usePlanDashboard();

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8">
      <PlanSectionShell section={section}>
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
      </PlanSectionShell>
      <SupportBanner />
    </div>
  );
}
