import { notFound } from "next/navigation";

import { PlanDashboardShell } from "@/components/plan-dashboard/plan-dashboard-shell";
import { loadPlanDashboard } from "@/lib/server/load-plan-dashboard";

export const dynamic = "force-dynamic";

export default async function PlanDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadPlanDashboard(id);
  if (!data) notFound();

  return (
    <PlanDashboardShell planId={id} data={data}>
      {children}
    </PlanDashboardShell>
  );
}
