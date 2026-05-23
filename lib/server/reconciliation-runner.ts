import "server-only";

import {
  runAgent,
  type AgentToolCallRecord,
} from "@/lib/server/agents/run";
import { writeAuditLog } from "@/lib/server/audit-log";
import {
  ConflictError,
  DataLayerError,
  NotFoundError,
} from "@/lib/server/errors";
import {
  listParticipants,
  type ParticipantRow,
} from "@/lib/server/participants";
import {
  getPayrollRun,
  listPayrollRecordsForRun,
  listPayrollRunsForPlan,
  type PayrollRecordRow,
  type PayrollRunRow,
} from "@/lib/server/payroll-runs";
import { getPlan } from "@/lib/server/plans";
import {
  canParseEmployerMatchFormula,
  expectedEmployerMatch,
  RECONCILIATION_TOLERANCES,
} from "@/lib/server/reconciliation";
import {
  createReconciliationIssue,
  listIssuesForRun,
  listPriorIssuesForPlan,
  type PriorIssueProjection,
} from "@/lib/server/reconciliation-issues";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Reconciliation runner.
 *
 * Mirrors the shape of the payroll-mapping route's agent path:
 * thin route handler + thick runner so the route stays a pure HTTP
 * shell. The runner gathers everything the agent needs in one pass,
 * hands it off to `runAgent`, then transitions the run's status
 * based on the agent's terminal stop_reason.
 *
 * The user_message payload below is a stable contract: the
 * companion skill (`skills/payroll-reconciliation/SKILL.md`)
 * describes exactly which keys land in the message and how the
 * agent should read them. Any change to the projection here MUST
 * land with a paired skill edit so the agent and the runner stay
 * in lockstep.
 *
 * Status transitions (see step 8 below):
 *   - `end_turn`               -> 'reconciled' + RECONCILIATION_COMPLETED audit.
 *   - anything else (max_iterations / max_tokens / refusal / pause_turn)
 *                              -> stays 'mapped' (re-runnable) +
 *                                 RECONCILIATION_FAILED audit.
 *
 * Validation errors (missing run, plan mismatch, run not mapped)
 * propagate as NotFoundError / DataLayerError / ConflictError so
 * the route layer can translate them via toErrorResponse().
 */

const AGENT_NAME = "payroll-reconciliation-agent";

/**
 * How many prior runs of this plan to expose to the agent. Each
 * prior run brings ~30 records' worth of YTD math into context;
 * 10 is enough for cross-run regression detection without blowing
 * the prompt budget on long-lived plans. The window slides over
 * the most recent runs, so older history rolls out first.
 */
const PRIOR_RUNS_CONTEXT_CAP = 10;

export type RunReconciliationInput = {
  /** uuid of the plans row the run belongs to. */
  plan_id: string;
  /** uuid of the payroll_runs row to reconcile. */
  payroll_run_id: string;
};

export type RunReconciliationResult = {
  run_id: string;
  plan_id: string;
  stop_reason: string;
  iterations: number;
  /** One entry per Claude tool call observed; full inputs stay in audit_logs. */
  tool_calls: Array<{ name: string; ok: boolean }>;
  /** Count of reconciliation_issues for this run after the agent ran. */
  issue_count: number;
  /**
   * 'reconciled' when the agent ended cleanly and the run flipped
   * status; 'mapped' when the agent failed and the run is left
   * re-runnable.
   */
  final_status: "reconciled" | "mapped";
};

type PriorRunSummary = {
  run_id: string;
  pay_date: string | null;
  label: string | null;
  ytd_by_employee: Record<
    string,
    { pretax_ytd: number; roth_ytd: number; match_ytd: number }
  >;
};

/**
 * Convert a `numeric(12,2)` column (stringified by supabase-js) to a
 * JS number. Reconciliation math operates in floats; the runner
 * re-rounds to cents before serialising so downstream comparisons
 * are stable. Null and unparseable inputs collapse to zero -- a
 * missing contribution is not a YTD contribution.
 */
function moneyToNumber(value: string | null): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Stable null-last comparator on ISO date strings. Used both for
 * ordering eligible prior runs (most-recent-first) and for the
 * final ascending presentation order in the agent context.
 */
function comparePayDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Bucket a prior run's records into employee-keyed YTD sums. Skips
 * rows with no employee_id (those would have raised their own
 * MISSING_EMPLOYEE_ID issue during the run that produced them).
 * Each numeric is rounded to cents on the way out so the agent
 * compares stable values across runs.
 */
function summarisePriorRun(
  run: PayrollRunRow,
  records: PayrollRecordRow[],
): PriorRunSummary {
  const ytd_by_employee: PriorRunSummary["ytd_by_employee"] = {};
  for (const r of records) {
    if (!r.employee_id) continue;
    const bucket = ytd_by_employee[r.employee_id] ?? {
      pretax_ytd: 0,
      roth_ytd: 0,
      match_ytd: 0,
    };
    bucket.pretax_ytd += moneyToNumber(r.pretax_deferral_amount);
    bucket.roth_ytd += moneyToNumber(r.roth_amount);
    bucket.match_ytd += moneyToNumber(r.employer_match);
    ytd_by_employee[r.employee_id] = bucket;
  }
  for (const key of Object.keys(ytd_by_employee)) {
    const b = ytd_by_employee[key];
    b.pretax_ytd = round2(b.pretax_ytd);
    b.roth_ytd = round2(b.roth_ytd);
    b.match_ytd = round2(b.match_ytd);
  }
  return {
    run_id: run.id,
    pay_date: run.pay_date,
    label: run.label,
    ytd_by_employee,
  };
}

/**
 * Project a payroll record into the lean shape the agent reads.
 * Drops raw_data + validation_* (irrelevant for reconciliation)
 * and converts numeric strings to numbers (the agent does math).
 *
 * Also injects three pre-computed expected values
 * (`expected_pretax`, `expected_roth`, `expected_employer_match`)
 * sourced from the matched census participant + the plan's match
 * formula text. The agent is told (in SKILL.md) to treat these as
 * authoritative and skip the corresponding issue code when any
 * value is null. Centralising the math here removes a class of
 * agent-hallucination bugs (see lessons.md: phase 9.1 iteration
 * round 2) where the model invented its own match formula.
 *
 * `participant` may be null when the payroll record has no census
 * match (e.g. EMPLOYEE_NOT_IN_CENSUS); in that case all three
 * expected_* fields are null and the agent must fall back to its
 * other heuristics for that row.
 */
function projectRecord(
  record: PayrollRecordRow,
  participant: ParticipantRow | null,
  matchFormulaText: string | null,
) {
  const gross =
    record.gross_wages == null ? null : Number(record.gross_wages);

  const censusPretaxRate = participant
    ? Number(participant.current_deferral_rate)
    : null;
  const censusRothRate = participant
    ? Number(participant.roth_deferral_rate)
    : null;

  const expected_pretax =
    gross != null &&
    censusPretaxRate != null &&
    Number.isFinite(censusPretaxRate)
      ? round2(censusPretaxRate * gross)
      : null;

  const expected_roth =
    gross != null &&
    censusRothRate != null &&
    Number.isFinite(censusRothRate)
      ? round2(censusRothRate * gross)
      : null;

  const expected_employer_match =
    gross != null &&
    censusPretaxRate != null &&
    Number.isFinite(censusPretaxRate)
      ? expectedEmployerMatch({
          matchFormulaText,
          rate: censusPretaxRate,
          gross,
        })
      : null;

  return {
    row_number: record.row_number,
    employee_id: record.employee_id,
    first_name: record.first_name,
    last_name: record.last_name,
    email: record.email,
    pay_date: record.pay_date,
    gross_wages: gross,
    pretax_deferral_amount:
      record.pretax_deferral_amount == null
        ? null
        : Number(record.pretax_deferral_amount),
    roth_amount:
      record.roth_amount == null ? null : Number(record.roth_amount),
    employer_match:
      record.employer_match == null ? null : Number(record.employer_match),
    loan_repayment:
      record.loan_repayment == null ? null : Number(record.loan_repayment),
    employment_status_in_run: record.employment_status_in_run,
    expected_pretax,
    expected_roth,
    expected_employer_match,
  };
}

/**
 * Project a participant row into the census shape the agent reads.
 * Numeric strings become numbers; balance / audit columns are
 * dropped because none of the reconciliation rules read them.
 */
function projectCensus(p: ParticipantRow) {
  return {
    employee_id: p.employee_id,
    first_name: p.first_name,
    last_name: p.last_name,
    email: p.email,
    hire_date: p.hire_date,
    eligibility_status: p.eligibility_status,
    current_deferral_rate: Number(p.current_deferral_rate),
    roth_deferral_rate: Number(p.roth_deferral_rate),
    loan_balance: Number(p.loan_balance),
    employment_status: p.employment_status,
  };
}

/**
 * Project a prior issue into the agent's prior_issues array. The
 * DAL already returns a minimal projection; we just rename `id` ->
 * `issue_id` to match the field name the skill documents.
 */
function projectPriorIssue(i: PriorIssueProjection) {
  return {
    issue_id: i.id,
    run_id: i.payroll_run_id,
    employee_id: i.employee_id,
    code: i.code,
    severity: i.severity,
    description: i.description,
  };
}

/**
 * Pick prior runs the agent should compare against: any run past
 * the 'mapped' state (validated or reconciled), excluding the
 * current run. Sorted descending by pay_date and capped at
 * `PRIOR_RUNS_CONTEXT_CAP` most recent so older history rolls out
 * first; then re-reversed so the agent reads them oldest-first
 * (the natural temporal narrative for cross-run YTD checks).
 */
function selectPriorRuns(
  runs: PayrollRunRow[],
  current_run_id: string,
): PayrollRunRow[] {
  const eligible = runs.filter(
    (r) =>
      r.id !== current_run_id &&
      (r.status === "validated" || r.status === "reconciled"),
  );
  // Most-recent first so the cap drops the oldest runs.
  eligible.sort((a, b) => comparePayDate(b.pay_date, a.pay_date));
  const recent = eligible.slice(0, PRIOR_RUNS_CONTEXT_CAP);
  // Present to the agent oldest-first so YTD math reads naturally.
  recent.reverse();
  return recent;
}

/**
 * Strip tool-call records down to `{ name, ok }` for the response.
 * The route handler returns this directly to the UI; full inputs
 * stay server-side (each tool's handler already wrote them into
 * audit_logs at call time).
 */
function projectToolCalls(
  calls: Array<AgentToolCallRecord>,
): Array<{ name: string; ok: boolean }> {
  return calls.map((c) => ({ name: c.name, ok: c.result.ok }));
}

export async function runReconciliation(
  input: RunReconciliationInput,
): Promise<RunReconciliationResult> {
  const { plan_id, payroll_run_id } = input;

  // 1. Load and validate the run before any agent work happens.
  //    Throws propagate to the route via toErrorResponse().
  const run = await getPayrollRun(payroll_run_id);
  if (!run) {
    throw new NotFoundError({
      module: "reconciliation-runner",
      operation: "runReconciliation",
      message: `no payroll_runs row with id ${payroll_run_id}`,
    });
  }
  if (run.plan_id !== plan_id) {
    throw new DataLayerError({
      module: "reconciliation-runner",
      operation: "runReconciliation",
      message: `plan_run_mismatch: run ${payroll_run_id} belongs to plan ${run.plan_id}, not ${plan_id}`,
    });
  }
  if (run.status !== "mapped") {
    throw new ConflictError({
      module: "reconciliation-runner",
      operation: "runReconciliation",
      message: `run_not_reconcilable: run ${payroll_run_id} status is ${run.status}, expected mapped`,
    });
  }

  // 2. Wide context fetch. Each call hits a different table, so
  //    they fan out safely. The agent reads everything in one pass;
  //    we don't need them ordered relative to each other.
  const [plan, census, records, allRunsForPlan, priorIssues] =
    await Promise.all([
      getPlan(plan_id),
      listParticipants({ plan_id, limit: 1000 }),
      listPayrollRecordsForRun(payroll_run_id),
      listPayrollRunsForPlan(plan_id),
      listPriorIssuesForPlan(plan_id, payroll_run_id),
    ]);

  if (!plan) {
    // Defensive: run.plan_id matched, but the plan disappeared
    // between the run read and the plan read. The FK should make
    // this impossible in practice; treat as a 404 anyway.
    throw new NotFoundError({
      module: "reconciliation-runner",
      operation: "runReconciliation",
      message: `no plans row with id ${plan_id}`,
    });
  }

  // 3. Prior-run YTD: filter / sort / cap, then fan out the
  //    record fetches in parallel. The cap keeps the prompt size
  //    bounded on long-running plans (see PRIOR_RUNS_CONTEXT_CAP).
  const priorRuns = selectPriorRuns(allRunsForPlan, payroll_run_id);
  const priorRunRecords = await Promise.all(
    priorRuns.map((r) => listPayrollRecordsForRun(r.id)),
  );
  const prior_runs_summary = priorRuns.map((r, idx) =>
    summarisePriorRun(r, priorRunRecords[idx]),
  );

  // 4. Build per-employee participant index + pull the match
  //    formula text out of the plan's extracted_fields so the
  //    record projection can pre-compute expected contribution
  //    amounts (see `projectRecord`). The match formula lives
  //    under the `employer_match` key (see plan-extraction.ts);
  //    extracted_fields is a `Record<string, unknown>` so we
  //    narrow defensively.
  const participantByEmployeeId = new Map<string, ParticipantRow>();
  for (const p of census) {
    if (p.employee_id) participantByEmployeeId.set(p.employee_id, p);
  }

  const matchFormulaText =
    plan.extracted_fields &&
    typeof (plan.extracted_fields as Record<string, unknown>)
      .employer_match === "string"
      ? ((plan.extracted_fields as Record<string, unknown>)
          .employer_match as string)
      : null;
  const matchFormulaParseWarning =
    matchFormulaText && !canParseEmployerMatchFormula(matchFormulaText)
      ? {
          code: "EMPLOYER_MATCH_FORMULA_UNPARSEABLE",
          message:
            "Employer match formula could not be parsed; EMPLOYER_MATCH_WRONG_AMOUNT checks are disabled for this reconciliation run.",
          match_formula: matchFormulaText,
        }
      : null;

  // ============================================================================
  // Deterministic pre-checks
  // ============================================================================
  //
  // Some reconciliation findings are mechanical enough that the
  // agent should never have to derive them. We run them here, file
  // the resulting issues directly via the DAL (bypassing the agent
  // tool path), and pass the resulting `issue_id` set to the agent
  // in `system_detected_issues` so it does NOT re-emit them.
  //
  // Each pre-check writes its own audit-log row at the runner
  // layer (not the route layer) so the actor chain reads
  // `system / reconciliation-runner` rather than the user-facing
  // route actor -- these are background detections, not user
  // actions.

  const system_detected_issues: Array<{
    issue_id: string;
    code: string;
    description: string;
  }> = [];

  // Coverage warning: a non-empty match formula that the runner
  // cannot parse means expected_employer_match will be null for every
  // record. That is not a reconciliation issue by itself, but it
  // materially reduces coverage, so leave a visible audit breadcrumb.
  if (matchFormulaParseWarning) {
    await writeAuditLog({
      actor_type: "system",
      actor_name: "reconciliation-runner",
      action: "RECONCILIATION_OBSERVATION",
      entity_type: "payroll_run",
      entity_id: payroll_run_id,
      payroll_run_id,
      field_name: "employer_match",
      after_value: matchFormulaParseWarning,
      reason:
        "Plan employer match formula was present but could not be parsed; employer-match amount checks were skipped.",
      status: "warning",
    });
  }

  // Pre-check #1: DUPLICATE_PAY_PERIOD. Fires when the current
  // run shares a pay_date with any prior run we're showing the
  // agent. The agent has historically missed this cross-run
  // pattern; pre-detecting it removes the failure mode entirely.
  // Skips when current pay_date is null (no false positives on
  // legitimately-unknown dates).
  const currentPayDate = run.pay_date;
  if (currentPayDate != null) {
    for (const priorRun of prior_runs_summary) {
      if (priorRun.pay_date !== currentPayDate) continue;

      const description = `Pay date ${currentPayDate} matches prior run ${priorRun.run_id} (${priorRun.pay_date}).`;
      const agent_explanation = `System-detected: current run pay_date and prior run ${priorRun.run_id} share the same pay_date. This usually indicates a duplicate import or off-cycle pay run. Reviewer should verify intent before processing further.`;

      const issue = await createReconciliationIssue({
        plan_id,
        payroll_run_id,
        payroll_record_id: null,
        category: "roster_drift",
        severity: "high",
        code: "DUPLICATE_PAY_PERIOD",
        description,
        agent_explanation,
        employee_id: null,
        row_number: null,
        field_name: "pay_date",
        expected_value: null,
        actual_value: currentPayDate,
        related_issue_id: null,
      });

      await writeAuditLog({
        actor_type: "system",
        actor_name: "reconciliation-runner",
        action: "ISSUE_CREATED",
        entity_type: "reconciliation_issue",
        entity_id: issue.id,
        payroll_run_id,
        after_value: {
          code: issue.code,
          severity: issue.severity,
          description: issue.description,
        },
        reason:
          "Deterministic DUPLICATE_PAY_PERIOD pre-check before agent run",
      });

      system_detected_issues.push({
        issue_id: issue.id,
        code: issue.code,
        description: issue.description,
      });
    }
  }

  // ============================================================================
  // Agent payload
  // ============================================================================
  //
  // Stable contract -- the skill enumerates these keys verbatim.
  // Serialised without indentation to save tokens; the agent
  // parses it as JSON, so whitespace is meaningless to it.
  const payload = {
    plan: {
      id: plan.id,
      extracted_fields: plan.extracted_fields ?? null,
    },
    current_run: {
      id: run.id,
      pay_date: run.pay_date,
      label: run.label,
      records: records.map((r) =>
        projectRecord(
          r,
          r.employee_id
            ? (participantByEmployeeId.get(r.employee_id) ?? null)
            : null,
          matchFormulaText,
        ),
      ),
    },
    census: census.map(projectCensus),
    prior_runs_summary,
    prior_issues: priorIssues.map(projectPriorIssue),
    system_detected_issues,
    tolerances: RECONCILIATION_TOLERANCES,
  };

  // 5. Run the agent. Higher caps than the default agent settings:
  //    reconciliation emits one tool call per issue and a dirty
  //    run can carry 10+ issues, so 16 iterations / 16k tokens
  //    gives plenty of headroom while still bounding cost.
  const result = await runAgent({
    skill: "payroll-reconciliation",
    tool_names: [
      "propose_reconciliation_issue",
      "flag_reconciliation_observation",
      "write_audit_log",
    ],
    actor_name: AGENT_NAME,
    user_message: [{ type: "text", text: JSON.stringify(payload) }],
    max_iterations: 16,
    max_tokens: 16000,
  });

  // 6. Issue count after the agent ran. Captured BEFORE the status
  //    flip so the failure path can return a useful number too
  //    (some issues may have landed before the agent gave up).
  const issuesAfter = await listIssuesForRun(payroll_run_id);
  const issue_count = issuesAfter.length;
  const tool_calls_projection = projectToolCalls(result.tool_calls);

  if (result.stop_reason === "end_turn") {
    // 7a. Atomic flip filtered on status='mapped' so a concurrent
    //     status change is detected (no row updated -> conflict).
    //     The pre-check above said 'mapped'; the .eq is belt-and-
    //     braces against a parallel reconcile.
    const supabase = getSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("payroll_runs")
      .update({
        status: "reconciled",
        reconciled_at: new Date().toISOString(),
        issue_count,
      })
      .eq("id", payroll_run_id)
      .eq("status", "mapped")
      .select("id")
      .maybeSingle();

    if (error) {
      throw new DataLayerError({
        module: "reconciliation-runner",
        operation: "runReconciliation",
        message: error.message,
        cause: error,
      });
    }
    if (!data) {
      throw new ConflictError({
        module: "reconciliation-runner",
        operation: "runReconciliation",
        message: `run ${payroll_run_id} status changed before reconcile could land (no longer mapped)`,
      });
    }

    await writeAuditLog({
      actor_type: "system",
      actor_name: AGENT_NAME,
      action: "RECONCILIATION_COMPLETED",
      entity_type: "payroll_run",
      entity_id: payroll_run_id,
      payroll_run_id,
      after_value: { issue_count, iterations: result.iterations },
      reason:
        "Reconciliation agent completed; run transitioned to reconciled.",
      status: "reconciled",
    });

    return {
      run_id: payroll_run_id,
      plan_id,
      stop_reason: result.stop_reason,
      iterations: result.iterations,
      tool_calls: tool_calls_projection,
      issue_count,
      final_status: "reconciled",
    };
  }

  // 7b. Agent did not end_turn (max_iterations / max_tokens /
  //     refusal / pause_turn). Run stays 'mapped' so a human can
  //     re-run; any issues the agent did file remain attached.
  const stop_reason = result.stop_reason ?? "max_iterations";
  await writeAuditLog({
    actor_type: "agent",
    actor_name: AGENT_NAME,
    action: "RECONCILIATION_FAILED",
    entity_type: "payroll_run",
    entity_id: payroll_run_id,
    payroll_run_id,
    after_value: { stop_reason, iterations: result.iterations },
    reason: `Reconciliation agent did not end_turn (stop_reason=${stop_reason}).`,
    status: "failed",
  });

  return {
    run_id: payroll_run_id,
    plan_id,
    stop_reason,
    iterations: result.iterations,
    tool_calls: tool_calls_projection,
    issue_count,
    final_status: "mapped",
  };
}
