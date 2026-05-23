import { notFound } from "next/navigation";

import { PlanSectionView } from "@/components/plan-dashboard/plan-section-view";
import { isPlanDashboardSection } from "@/lib/plan-dashboard-sections";

export default async function PlanSectionPage({
  params,
}: {
  params: Promise<{ id: string; section: string }>;
}) {
  const { section } = await params;
  if (!isPlanDashboardSection(section)) notFound();

  return <PlanSectionView section={section} />;
}
