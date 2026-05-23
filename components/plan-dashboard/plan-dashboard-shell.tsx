"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { PlanDashboardProvider } from "@/components/plan-dashboard/plan-dashboard-context";
import {
  ONBOARDING_HOME,
  PLAN_DASHBOARD_SECTIONS,
  type PlanDashboardSection,
} from "@/lib/plan-dashboard-sections";
import type { PlanDashboardData } from "@/lib/server/load-plan-dashboard";
import { cn } from "@/lib/utils";

function navBadge(
  slug: PlanDashboardSection,
  hints: PlanDashboardData["navHints"],
): number | null {
  switch (slug) {
    case "issues":
      return hints.openIssues > 0 ? hints.openIssues : null;
    case "payroll-mapping":
      return hints.pendingMapping ? 1 : null;
    case "plan-details":
      return hints.extractionNeedsReview ? 1 : null;
    case "payroll-runs":
      return hints.runsNeedingAction > 0 ? hints.runsNeedingAction : null;
    default:
      return null;
  }
}

export function PlanDashboardShell({
  planId,
  data,
  children,
}: {
  planId: string;
  data: PlanDashboardData;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <PlanDashboardProvider data={data}>
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <Link
              href="/"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              ← {ONBOARDING_HOME.label}
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                  {data.plan.employer_name}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {data.plan.plan_name ?? "401(k) onboarding"}
                  {data.plan.plan_year ? ` · ${data.plan.plan_year}` : ""}
                </p>
              </div>
              <Badge variant="secondary" className="capitalize">
                extraction: {data.plan.extraction_status.replace("_", " ")}
              </Badge>
            </div>
          </div>
        </header>

        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:px-8">
          <nav
            aria-label="Plan dashboard sections"
            className="shrink-0 lg:w-56"
          >
            <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
              {PLAN_DASHBOARD_SECTIONS.map((item) => {
                const href = `/plans/${planId}/${item.slug}`;
                const active = pathname === href;
                const badge = navBadge(item.slug, data.navHints);
                const Icon = item.icon;

                return (
                  <li key={item.slug}>
                    <Link
                      href={href}
                      className={cn(
                        "flex min-w-[9rem] items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors lg:min-w-0 lg:w-full",
                        active
                          ? "border-primary/30 bg-primary/5 font-medium text-foreground shadow-sm"
                          : "border-transparent bg-background text-muted-foreground hover:border-border hover:bg-background hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1 truncate">{item.shortLabel}</span>
                      {badge != null && (
                        <Badge
                          variant={active ? "default" : "secondary"}
                          className="h-5 min-w-5 justify-center px-1.5 text-[10px]"
                        >
                          {badge}
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </PlanDashboardProvider>
  );
}
