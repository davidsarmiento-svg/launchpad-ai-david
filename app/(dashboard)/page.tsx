import { AppShell } from "@/components/dashboard/app-shell";
import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { listPlanOnboardingSummaries } from "@/lib/server/plan-onboarding-summaries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const plans = await listPlanOnboardingSummaries(50);

  return (
    <AppShell plans={plans}>
      <DashboardHome initialSummaries={plans} />
    </AppShell>
  );
}
