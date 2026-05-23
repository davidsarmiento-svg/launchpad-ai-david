import { redirect } from "next/navigation";

export default async function PlanIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/plans/${id}/plan-details`);
}
