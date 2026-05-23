"use client";

import { Bell, ChevronDown, Menu } from "lucide-react";

import type { PlanPickerOption } from "@/components/dashboard/app-shell";
import { cn } from "@/lib/utils";

export function DashboardHeader({
  title,
  subtitle,
  plans,
  selectedPlanId,
  onPlanChange,
  onMenuClick,
  className,
}: {
  title: string;
  subtitle: string;
  plans: PlanPickerOption[];
  selectedPlanId: string | null;
  onPlanChange: (planId: string) => void;
  onMenuClick?: () => void;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-[#E5E7EB]/80 bg-[#F8FAFF]/80 px-6 py-6 backdrop-blur-sm sm:px-8 lg:flex-row lg:items-start lg:justify-between",
        className,
      )}
    >
      <div className="flex max-w-2xl items-start gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white text-[#64748B] shadow-sm md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#07133F] sm:text-[1.75rem]">
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-[#64748B] sm:text-base">{subtitle}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {plans.length > 0 && (
          <label className="relative">
            <span className="sr-only">Select plan</span>
            <select
              value={selectedPlanId ?? ""}
              onChange={(e) => onPlanChange(e.target.value)}
              className="h-10 min-w-[12rem] appearance-none rounded-xl border border-[#E5E7EB] bg-white py-2 pr-9 pl-3 text-sm font-medium text-[#07133F] shadow-sm focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/20"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-[#64748B]"
              aria-hidden
            />
          </label>
        )}

        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white text-[#64748B] shadow-sm transition-colors hover:text-[#07133F]"
          aria-label="Notifications"
        >
          <Bell className="size-5" />
        </button>
      </div>
    </header>
  );
}
