import { notFound } from "next/navigation";

import {
  PlanDetailClient,
  type PlanDetailFile,
  type PlanDetailParticipant,
  type PlanDetailPlan,
} from "@/components/plan-detail-client";
import { listFilesForPlan } from "@/lib/server/files";
import { listParticipants } from "@/lib/server/participants";
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
  const participants = await listParticipants({ plan_id: id, limit: 200 });

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

  const participantsForClient: PlanDetailParticipant[] = participants.map(
    (p) => ({
      id: p.id,
      employee_id: p.employee_id,
      participant_id: p.participant_id,
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
      eligibility_status: p.eligibility_status,
      current_deferral_rate: p.current_deferral_rate,
      account_balance: p.account_balance,
      employment_status: p.employment_status,
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <PlanDetailClient
        plan={planForClient}
        files={filesForClient}
        participants={participantsForClient}
      />
    </div>
  );
}
