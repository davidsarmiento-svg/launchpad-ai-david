import type { LucideIcon } from "lucide-react";
import {
  Bot,
  ClipboardList,
  FileText,
  History,
  Map,
  Upload,
  Users,
  Wallet,
} from "lucide-react";

/**
 * The seven plan-scoped dashboard modules from the training brief.
 * Module 1 (Onboarding Home) lives at `/` — not in this list.
 */
export const PLAN_DASHBOARD_SECTIONS = [
  {
    slug: "plan-details",
    label: "Plan Details",
    shortLabel: "Plan",
    description:
      "Upload the plan PDF, run extraction, and review or approve extracted fields.",
    icon: FileText,
  },
  {
    slug: "participants",
    label: "Participant Data",
    shortLabel: "Participants",
    description:
      "Upload the participant census CSV and review normalized roster records.",
    icon: Users,
  },
  {
    slug: "payroll-mapping",
    label: "Payroll Mapping",
    shortLabel: "Mapping",
    description:
      "Review the agent's column mapping for Payroll Run 1 and approve it.",
    icon: Map,
  },
  {
    slug: "payroll-runs",
    label: "Payroll Runs",
    shortLabel: "Runs",
    description:
      "Upload payroll CSVs, map each run, and run reconciliation.",
    icon: Wallet,
  },
  {
    slug: "issues",
    label: "Reconciliation Issues",
    shortLabel: "Issues",
    description:
      "Triage detected issues, read agent explanations, and approve or reject fixes.",
    icon: ClipboardList,
  },
  {
    slug: "audit-trail",
    label: "Change Logs",
    shortLabel: "Audit",
    description:
      "Chronological log of every action by users, agents, and the system.",
    icon: History,
  },
  {
    slug: "assistant",
    label: "AI Assistant",
    shortLabel: "Assistant",
    description:
      "Ask questions about plan data, open issues, and what changed — read-only.",
    icon: Bot,
  },
] as const satisfies ReadonlyArray<{
  slug: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
}>;

export type PlanDashboardSection =
  (typeof PLAN_DASHBOARD_SECTIONS)[number]["slug"];

export const PLAN_SECTION_SLUGS: ReadonlyArray<PlanDashboardSection> =
  PLAN_DASHBOARD_SECTIONS.map((s) => s.slug);

export function isPlanDashboardSection(
  value: string,
): value is PlanDashboardSection {
  return (PLAN_SECTION_SLUGS as ReadonlyArray<string>).includes(value);
}

export function getPlanDashboardSection(slug: PlanDashboardSection) {
  return PLAN_DASHBOARD_SECTIONS.find((s) => s.slug === slug)!;
}

/** Home module — separate route at `/`. */
export const ONBOARDING_HOME = {
  slug: "home",
  label: "Onboarding Home",
  description: "Overview of every plan in onboarding and quick actions.",
  icon: Upload,
} as const;
