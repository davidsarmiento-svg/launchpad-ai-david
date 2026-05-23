import { OnboardingHomeClient } from "@/components/onboarding-home-client";
import {
  listPlanOnboardingSummaries,
  type PlanOnboardingSummary,
} from "@/lib/server/plan-onboarding-summaries";

export async function OnboardingHome() {
  let summaries: PlanOnboardingSummary[] = [];
  try {
    summaries = await listPlanOnboardingSummaries(50);
  } catch (err) {
    console.error("[onboarding-home] failed to load summaries:", err);
  }

  return <OnboardingHomeClient initialSummaries={summaries} />;
}
