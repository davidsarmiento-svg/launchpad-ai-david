import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  Clock3,
  FileText,
  Home,
  LayoutDashboard,
  Map,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";

import type { PlanDashboardSection } from "@/lib/plan-dashboard-sections";

export type ModuleAccent = {
  iconBg: string;
  iconColor: string;
  ctaColor: string;
};

export type DashboardModule = {
  id: string;
  number: number;
  title: string;
  description: string;
  cta: string;
  icon: LucideIcon;
  accent: ModuleAccent;
  /** Plan-scoped section slug; omitted for home-only modules. */
  section?: PlanDashboardSection;
};

export const DASHBOARD_MODULES: DashboardModule[] = [
  {
    id: "onboarding-home",
    number: 1,
    title: "Onboarding Home",
    description:
      "Status overview of the entire onboarding workflow, active tasks, completion progress, and recent activity.",
    cta: "View onboarding status",
    icon: Home,
    accent: {
      iconBg: "bg-violet-100",
      iconColor: "text-violet-600",
      ctaColor: "text-violet-600",
    },
  },
  {
    id: "plan-details",
    number: 2,
    title: "Plan Details",
    description:
      "Upload plan PDFs, run AI extraction agents, and review or edit extracted structured plan fields.",
    cta: "Manage plan details",
    icon: FileText,
    section: "plan-details",
    accent: {
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      ctaColor: "text-blue-600",
    },
  },
  {
    id: "participants",
    number: 3,
    title: "Participant Data",
    description:
      "Upload census CSV files, normalize participant records, and review missing or invalid data.",
    cta: "Review participant data",
    icon: Users,
    section: "participants",
    accent: {
      iconBg: "bg-teal-100",
      iconColor: "text-teal-700",
      ctaColor: "text-teal-700",
    },
  },
  {
    id: "payroll-mapping",
    number: 4,
    title: "Payroll Mapping",
    description:
      "Upload Payroll Run 1 and review AI-suggested payroll column mappings before approval.",
    cta: "Review mappings",
    icon: Map,
    section: "payroll-mapping",
    accent: {
      iconBg: "bg-indigo-100",
      iconColor: "text-indigo-600",
      ctaColor: "text-indigo-600",
    },
  },
  {
    id: "payroll-runs",
    number: 5,
    title: "Payroll Runs",
    description:
      "Upload and reconcile Payroll Runs 2–5, monitor processing status, and review detected discrepancies.",
    cta: "View payroll runs",
    icon: Wallet,
    section: "payroll-runs",
    accent: {
      iconBg: "bg-sky-100",
      iconColor: "text-sky-700",
      ctaColor: "text-sky-700",
    },
  },
  {
    id: "issues",
    number: 6,
    title: "Reconciliation Issues",
    description:
      "Review detected payroll issues, AI explanations, suggested fixes, and approve or reject changes.",
    cta: "Review issues",
    icon: AlertTriangle,
    section: "issues",
    accent: {
      iconBg: "bg-amber-100",
      iconColor: "text-amber-700",
      ctaColor: "text-amber-700",
    },
  },
  {
    id: "audit-trail",
    number: 7,
    title: "Change Logs / Audit Trail",
    description:
      "View a complete chronological history of every action performed by users, agents, and system processes.",
    cta: "Open audit trail",
    icon: Clock3,
    section: "audit-trail",
    accent: {
      iconBg: "bg-slate-100",
      iconColor: "text-slate-700",
      ctaColor: "text-slate-700",
    },
  },
  {
    id: "assistant",
    number: 8,
    title: "AI Onboarding Assistant",
    description:
      "Chat with an AI assistant that can answer onboarding questions and retrieve information using MCP tools.",
    cta: "Open assistant",
    icon: Bot,
    section: "assistant",
    accent: {
      iconBg: "bg-purple-100",
      iconColor: "text-purple-600",
      ctaColor: "text-purple-600",
    },
  },
];

export function moduleHref(
  module: DashboardModule,
  planId: string | null,
): string {
  if (module.id === "onboarding-home") return "/";
  if (module.section && planId) {
    return `/plans/${planId}/${module.section}`;
  }
  return "/";
}

export type SidebarNavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number | null;
};

export function buildSidebarNav(
  planId: string | null,
  navHints?: {
    openIssues: number;
    pendingMapping: boolean;
    runsNeedingAction: number;
    extractionNeedsReview: boolean;
  },
): SidebarNavItem[] {
  const planModules = DASHBOARD_MODULES.filter((m) => m.id !== "onboarding-home");

  const items: SidebarNavItem[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      href: "/",
      icon: LayoutDashboard,
    },
    {
      id: "onboarding-home",
      label: "Onboarding Home",
      href: "/#active-plans",
      icon: Home,
    },
    ...planModules.map((m) => ({
      id: m.id,
      label: m.title,
      href: moduleHref(m, planId),
      icon: m.icon,
      badge: badgeForModule(m, navHints),
    })),
    {
      id: "settings",
      label: "Settings",
      href: planId ? `/plans/${planId}/plan-details` : "/",
      icon: ShieldCheck,
    },
  ];

  return items;
}

function badgeForModule(
  module: DashboardModule,
  hints?: {
    openIssues: number;
    pendingMapping: boolean;
    runsNeedingAction: number;
    extractionNeedsReview: boolean;
  },
): number | null {
  if (!hints) return null;
  switch (module.section) {
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
