"use client";

import { createContext, useContext } from "react";

import type { PlanDashboardData } from "@/lib/server/load-plan-dashboard";

const PlanDashboardContext = createContext<PlanDashboardData | null>(null);

export function PlanDashboardProvider({
  data,
  children,
}: {
  data: PlanDashboardData;
  children: React.ReactNode;
}) {
  return (
    <PlanDashboardContext.Provider value={data}>
      {children}
    </PlanDashboardContext.Provider>
  );
}

export function usePlanDashboard(): PlanDashboardData {
  const ctx = useContext(PlanDashboardContext);
  if (!ctx) {
    throw new Error("usePlanDashboard must be used within PlanDashboardProvider");
  }
  return ctx;
}
