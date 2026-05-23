import { notFound } from "next/navigation";

import { AppShell } from "@/components/dashboard/app-shell";
import { loadPlanDashboard } from "@/lib/server/load-plan-dashboard";
import { listPlanOnboardingSummaries } from "@/lib/server/plan-onboarding-summaries";

export const dynamic = "force-dynamic";

export default async function PlanDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [plans, data] = await Promise.all([
    listPlanOnboardingSummaries(50),
    loadPlanDashboard(id),
  ]);

  if (!data) notFound();

  return (
    <AppShell plans={plans} planData={data}>
      {children}
    </AppShell>
  );
}
