import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { DashboardModule } from "@/lib/dashboard-modules";
import { moduleHref } from "@/lib/dashboard-modules";
import { cn } from "@/lib/utils";

export function ModuleCard({
  module,
  planId,
  className,
}: {
  module: DashboardModule;
  planId: string | null;
  className?: string;
}) {
  const Icon = module.icon;
  const href = moduleHref(module, planId);

  return (
    <Link
      href={href}
      className={cn(
        "group flex h-full flex-col rounded-[1.25rem] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.04)] transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-[#C7D2FE] hover:shadow-[0_4px_20px_rgba(79,70,229,0.12)]",
        className,
      )}
    >
      <div
        className={cn(
          "mb-5 flex size-12 items-center justify-center rounded-full",
          module.accent.iconBg,
        )}
      >
        <Icon className={cn("size-5", module.accent.iconColor)} aria-hidden />
      </div>

      <h3 className="text-base font-semibold tracking-tight text-[#07133F]">
        {module.number}. {module.title}
      </h3>

      <p className="mt-2 flex-1 text-sm leading-relaxed text-[#64748B]">
        {module.description}
      </p>

      <span
        className={cn(
          "mt-6 inline-flex items-center gap-1.5 text-sm font-medium transition-colors",
          module.accent.ctaColor,
          "group-hover:gap-2",
        )}
      >
        {module.cta}
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}
