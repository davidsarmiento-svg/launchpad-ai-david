import { notFound } from "next/navigation";

import {
  PlanDetailClient,
  type PlanDetailFile,
  type PlanDetailPlan,
} from "@/components/plan-detail-client";
import { listFilesForPlan } from "@/lib/server/files";
import { getPlan } from "@/lib/server/plans";

// The page reads the live plan + files at request time so the operator
// always sees the current `extraction_status`. Static prerender would
// freeze the demo at deploy time.
export const dynamic = "force-dynamic";

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const plan = await getPlan(id);
  if (!plan) {
    notFound();
  }

  const files = await listFilesForPlan(id);

  const planForClient: PlanDetailPlan = {
    id: plan.id,
    employer_name: plan.employer_name,
    plan_name: plan.plan_name,
    plan_year: plan.plan_year,
    status: plan.status,
    extraction_status: plan.extraction_status,
    extracted_at: plan.extracted_at,
    extracted_fields: plan.extracted_fields,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  };

  const filesForClient: PlanDetailFile[] = files.map((f) => ({
    id: f.id,
    filename: f.filename,
    kind: f.kind,
    size_bytes: f.size_bytes,
    uploaded_at: f.uploaded_at,
  }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <PlanDetailClient plan={planForClient} files={filesForClient} />
    </div>
  );
}
