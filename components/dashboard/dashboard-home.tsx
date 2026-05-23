"use client";

import { useState } from "react";

import { ModuleCard } from "@/components/dashboard/module-card";
import { SupportBanner } from "@/components/dashboard/support-banner";
import { UploadPanel } from "@/components/dashboard/upload-panel";
import { DASHBOARD_MODULES } from "@/lib/dashboard-modules";
import type { PlanOnboardingSummary } from "@/lib/server/plan-onboarding-summaries";

export function DashboardHome({
  initialSummaries,
}: {
  initialSummaries: PlanOnboardingSummary[];
}) {
  const [summaries, setSummaries] =
    useState<PlanOnboardingSummary[]>(initialSummaries);

  const activePlanId = summaries[0]?.id ?? null;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {DASHBOARD_MODULES.map((module) => (
            <ModuleCard
              key={module.id}
              module={module}
              planId={activePlanId}
            />
          ))}
        </div>

        <UploadPanel
          plans={summaries}
          onPlanCreated={(plan) => setSummaries((prev) => [plan, ...prev])}
        />
      </div>

      {summaries.length > 0 && (
        <section
          id="active-plans"
          className="scroll-mt-8 rounded-[1.25rem] border border-[#E5E7EB] bg-white p-6 shadow-sm"
          aria-label="Active plans"
        >
          <h2 className="text-sm font-semibold text-[#07133F]">Active plans</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((plan) => (
              <li
                key={plan.id}
                className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFF] px-4 py-3 text-sm"
              >
                <p className="font-medium text-[#07133F]">{plan.employer_name}</p>
                <p className="mt-1 text-xs text-[#64748B]">
                  {plan.participant_count} participants · {plan.open_issues} open
                  issues · {plan.runs_reconciled}/{plan.payroll_run_count} runs
                  reconciled
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SupportBanner />
    </div>
  );
}
