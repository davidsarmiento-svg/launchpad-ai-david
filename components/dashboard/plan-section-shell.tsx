import { ShieldCheck } from "lucide-react";

import type { PlanDashboardSection } from "@/lib/plan-dashboard-sections";
import { getPlanDashboardSection } from "@/lib/plan-dashboard-sections";

export function PlanSectionShell({
  section,
  children,
}: {
  section: PlanDashboardSection;
  children: React.ReactNode;
}) {
  const meta = getPlanDashboardSection(section);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-[1.25rem] border border-[#E0E7FF] bg-[#EEF2FF] px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white">
          <ShieldCheck className="size-5 text-[#4F46E5]" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-medium text-[#07133F]">
            Human approval required
          </p>
          <p className="mt-0.5 text-sm text-[#64748B]">
            AI agents in {meta.label} only propose changes. Nothing is applied
            until you review and approve.
          </p>
        </div>
      </div>

      <div className="[&_.rounded-lg]:rounded-[1.25rem] [&_.rounded-xl]:rounded-[1.25rem] [&_[data-slot=card]]:border-[#E5E7EB] [&_[data-slot=card]]:shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        {children}
      </div>
    </div>
  );
}
