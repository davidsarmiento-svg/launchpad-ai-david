"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { PlanDashboardProvider } from "@/components/plan-dashboard/plan-dashboard-context";
import { buildSidebarNav } from "@/lib/dashboard-modules";
import type { PlanDashboardData } from "@/lib/server/load-plan-dashboard";
import type { PlanOnboardingSummary } from "@/lib/server/plan-onboarding-summaries";

export type PlanPickerOption = {
  id: string;
  label: string;
};

export function AppShell({
  plans,
  planData,
  children,
}: {
  plans: PlanOnboardingSummary[];
  planData?: PlanDashboardData | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const planIdFromPath = useMemo(() => {
    const match = pathname.match(/^\/plans\/([^/]+)/);
    return match?.[1] ?? null;
  }, [pathname]);

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    planIdFromPath ?? plans[0]?.id ?? null,
  );

  const activePlanId = planIdFromPath ?? selectedPlanId;

  const planOptions: PlanPickerOption[] = plans.map((p) => ({
    id: p.id,
    label: p.plan_name ?? p.employer_name,
  }));

  const navItems = buildSidebarNav(
    activePlanId,
    planData?.navHints ?? undefined,
  );

  function handlePlanChange(nextId: string) {
    setSelectedPlanId(nextId);
    if (planIdFromPath) {
      const section = pathname.replace(`/plans/${planIdFromPath}`, "") || "/plan-details";
      router.push(`/plans/${nextId}${section === "" ? "/plan-details" : section}`);
    }
  }

  const headerTitle = "Welcome back 👋";

  const headerSubtitle = planData
    ? `Here's what's happening with ${planData.plan.employer_name} today. All AI-suggested changes require your explicit approval.`
    : "Here's what's happening with your onboarding pipeline today.";

  const content = (
    <div className="flex min-h-screen bg-[#F8FAFF] md:pl-[260px]">
      <AppSidebar
        navItems={navItems}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader
          title={headerTitle}
          subtitle={headerSubtitle}
          plans={planOptions}
          selectedPlanId={activePlanId}
          onPlanChange={handlePlanChange}
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="flex-1 px-6 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );

  if (planData) {
    return (
      <PlanDashboardProvider data={planData}>{content}</PlanDashboardProvider>
    );
  }

  return content;
}
