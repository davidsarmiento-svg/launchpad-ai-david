import { notFound } from "next/navigation";

import {
  PlanDetailClient,
  type PlanDetailFile,
  type PlanDetailParticipant,
  type PlanDetailPayrollMapping,
  type PlanDetailPayrollRun,
  type PlanDetailPlan,
} from "@/components/plan-detail-client";
import { listFilesForPlan } from "@/lib/server/files";
import { listParticipants } from "@/lib/server/participants";
import {
  getLatestApprovedMapping,
  getLatestPendingMappingForPlan,
  type PayrollMappingRow,
} from "@/lib/server/payroll-mappings";
import {
  listPayrollRunsForPlan,
  type PayrollRunRow,
} from "@/lib/server/payroll-runs";
import { getPlan } from "@/lib/server/plans";

// The page reads the live plan + files at request time so the operator
// always sees the current `extraction_status`. Static prerender would
// freeze the demo at deploy time.
export const dynamic = "force-dynamic";

function toClientRun(run: PayrollRunRow): PlanDetailPayrollRun {
  return {
    id: run.id,
    plan_id: run.plan_id,
    source_file_id: run.source_file_id,
    mapping_id: run.mapping_id,
    label: run.label,
    pay_date: run.pay_date,
    status: run.status,
    row_count: run.row_count,
    uploaded_at: run.uploaded_at,
    mapped_at: run.mapped_at,
  };
}

function toClientMapping(mapping: PayrollMappingRow): PlanDetailPayrollMapping {
  return {
    id: mapping.id,
    plan_id: mapping.plan_id,
    name: mapping.name,
    mapping: mapping.mapping,
    suggested_by: mapping.suggested_by,
    suggested_at: mapping.suggested_at,
    approved_by: mapping.approved_by,
    approved_at: mapping.approved_at,
    status: mapping.status,
  };
}

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

  // Fetch everything in parallel: this page already had three
  // separate awaits, and adding three more would multiply the round-
  // trip latency. `Promise.all` lets the slowest query set the floor.
  const [
    files,
    participants,
    payrollRuns,
    pendingMapping,
    approvedMapping,
  ] = await Promise.all([
    listFilesForPlan(id),
    listParticipants({ plan_id: id, limit: 200 }),
    listPayrollRunsForPlan(id),
    getLatestPendingMappingForPlan(id),
    getLatestApprovedMapping(id),
  ]);

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

  const payrollRunsForClient: PlanDetailPayrollRun[] =
    payrollRuns.map(toClientRun);
  const pendingMappingForClient: PlanDetailPayrollMapping | null =
    pendingMapping ? toClientMapping(pendingMapping) : null;
  const approvedMappingForClient: PlanDetailPayrollMapping | null =
    approvedMapping ? toClientMapping(approvedMapping) : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <PlanDetailClient
        plan={planForClient}
        files={filesForClient}
        participants={participantsForClient}
        payrollRuns={payrollRunsForClient}
        pendingMapping={pendingMappingForClient}
        approvedMapping={approvedMappingForClient}
      />
    </div>
  );
}
