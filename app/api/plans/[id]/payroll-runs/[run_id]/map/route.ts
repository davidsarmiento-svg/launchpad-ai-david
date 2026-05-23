import { z } from "zod";

import { runAgent } from "@/lib/server/agents/run";
import { writeAuditLog } from "@/lib/server/audit-log";
import { toErrorResponse } from "@/lib/server/http";
import {
  buildIngestRecord,
  parseCsvHeaderAndRows,
} from "@/lib/server/payroll-ingest";
import {
  csvHeaderCoversMapping,
  type PayrollStorageMapping,
} from "@/lib/server/payroll-mapping";
import {
  getLatestApprovedMapping,
  getLatestPendingMappingForPlan,
} from "@/lib/server/payroll-mappings";
import {
  applyMappingToRun,
  getPayrollRun,
} from "@/lib/server/payroll-runs";
import { downloadFileBytes } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/**
 * Payroll mapping runs Claude through a tiny prompt (header + 5
 * rows) so the actual model round-trip is short, but downstream calls
 * (CSV decode + supabase upserts on the auto-apply path) push the
 * envelope. 60 s mirrors the Phase 7 / Phase 8 routes and stays well
 * inside Vercel Pro's function-timeout ceiling.
 */
export const maxDuration = 60;

const paramsSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
});
const bodySchema = z.object({}).passthrough();

const AGENT_NAME = "payroll-mapping-agent";

/**
 * POST /api/plans/[id]/payroll-runs/[run_id]/map
 *
 * Turn an `uploaded` payroll_runs row into a `mapped` one. Two
 * branches:
 *
 *   1. Auto-apply. If the plan has a latest-approved mapping and
 *      the uploaded CSV's header is a superset of the approved
 *      mapping's keys (case-sensitive), apply that mapping in-line,
 *      write a PAYROLL_RUN_MAPPED audit row, and return 200 with
 *      `auto_applied: true`. No agent round-trip.
 *
 *   2. Agent path. Otherwise hand the header + first 5 rows to the
 *      payroll-mapping-agent. If there's already a pending mapping
 *      for the plan, reject with 409 so we don't queue a second
 *      proposal alongside the existing one. On success the agent
 *      lands a pending mapping via propose_payroll_mapping and the
 *      response carries the new mapping_id; ingest happens later
 *      when a human approves (see PATCH .../payroll-mappings/[id]).
 *
 * Status flow:
 *   - 200: auto-applied OR agent proposed a pending mapping.
 *   - 400: bad uuid / CSV parse failure / wrong file kind / plan
 *          mismatch / empty CSV.
 *   - 404: payroll_runs row missing.
 *   - 409: run isn't 'uploaded' OR a pending mapping already exists.
 *   - 500: agent loop ended without a successful
 *          propose_payroll_mapping call, or any DataLayerError.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; run_id: string }> },
) {
  try {
    const { id, run_id } = paramsSchema.parse(await ctx.params);

    const rawBody = await request.json().catch(() => ({}));
    bodySchema.parse(rawBody);

    const run = await getPayrollRun(run_id);
    if (!run) {
      return Response.json(
        {
          error: "not_found",
          message: `no payroll_runs row with id ${run_id}`,
        },
        { status: 404 },
      );
    }

    if (run.plan_id !== id) {
      return Response.json(
        {
          error: "plan_run_mismatch",
          message: `run ${run_id} belongs to plan ${run.plan_id}, not ${id}`,
        },
        { status: 400 },
      );
    }
    if (run.status !== "uploaded") {
      return Response.json(
        {
          error: "run_not_uploadable",
          message: `run ${run_id} status is ${run.status}, expected uploaded`,
        },
        { status: 409 },
      );
    }
    if (!run.source_file_id) {
      // Defensive: createPayrollRun always sets source_file_id, but
      // a hand-edited row could land here without one.
      return Response.json(
        {
          error: "missing_source_file",
          message: `run ${run_id} has no source_file_id`,
        },
        { status: 500 },
      );
    }

    const { file, bytes } = await downloadFileBytes(run.source_file_id);
    if (file.kind !== "payroll_run") {
      return Response.json(
        {
          error: "wrong_file_kind",
          message: `file ${run.source_file_id} has kind=${file.kind}; only payroll_run is mappable here`,
        },
        { status: 400 },
      );
    }

    let header: string[];
    let records: Array<Record<string, string>>;
    try {
      const parsed = parseCsvHeaderAndRows(bytes);
      header = parsed.header;
      records = parsed.records;
    } catch (err) {
      return Response.json(
        {
          error: "csv_parse_failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 400 },
      );
    }

    if (records.length === 0) {
      return Response.json(
        {
          error: "empty_csv",
          message: `payroll CSV ${run.source_file_id} has no data rows`,
        },
        { status: 400 },
      );
    }

    // ---- Auto-apply path -------------------------------------------------
    const approved = await getLatestApprovedMapping(id);
    if (approved && csvHeaderCoversMapping(header, approved.mapping)) {
      const storage: PayrollStorageMapping = approved.mapping;
      const ingestRecords = records.map((row, idx) =>
        buildIngestRecord(row, storage, idx + 1),
      );

      const result = await applyMappingToRun({
        run_id,
        mapping_id: approved.id,
        records: ingestRecords,
      });

      await writeAuditLog({
        actor_type: "system",
        actor_name: AGENT_NAME,
        action: "PAYROLL_RUN_MAPPED",
        entity_type: "payroll_run",
        entity_id: run_id,
        payroll_run_id: run_id,
        after_value: {
          mapping_id: approved.id,
          record_count: ingestRecords.length,
          auto_applied: true,
        },
        reason:
          "Auto-applied approved mapping (CSV header covers approved mapping keys).",
      });

      return Response.json({
        run_id,
        plan_id: id,
        auto_applied: true,
        mapping_id: approved.id,
        mapping_name: approved.name,
        record_count: ingestRecords.length,
        run: result.run,
      });
    }

    // ---- Agent path ------------------------------------------------------
    const pending = await getLatestPendingMappingForPlan(id);
    if (pending) {
      return Response.json(
        {
          error: "pending_mapping_exists",
          mapping_id: pending.id,
          message:
            "Approve or reject the pending mapping before proposing a new one.",
        },
        { status: 409 },
      );
    }

    // Cap the prompt at 5 data rows: the model only needs enough
    // signal to spot column shapes / formats; bulk row content is
    // wasted context.
    const sampleRows = records.slice(0, 5);
    const sampleCsv = [
      header.join(","),
      ...sampleRows.map((r) =>
        header.map((h) => JSON.stringify(r[h] ?? "")).join(","),
      ),
    ].join("\n");

    // Default max_tokens (4096) is fine: the propose_payroll_mapping
    // input is ~11 keys with short string/null values plus one short
    // reason -- contrast with Phase 8's bump to 16k where the bulk
    // participants payload could otherwise hit the wall mid-output.
    const result = await runAgent({
      skill: "payroll-mapping",
      tool_names: [
        "propose_payroll_mapping",
        "flag_mapping_issue",
        "write_audit_log",
      ],
      actor_name: AGENT_NAME,
      user_message: [
        {
          type: "text",
          text:
            `Propose a payroll mapping for the CSV attached below.\n\n` +
            `Use propose_payroll_mapping with plan_id="${id}" and a ` +
            `descriptive name. The source_file_id for any ` +
            `flag_mapping_issue calls is "${run.source_file_id}".\n\n` +
            `CSV header + first 5 data rows:\n\n` +
            sampleCsv,
        },
      ],
    });

    const proposeCalls = result.tool_calls.filter(
      (c) => c.name === "propose_payroll_mapping",
    );
    const successfulProposals = proposeCalls.filter((c) => c.result.ok);

    if (successfulProposals.length === 0) {
      const summary = result.tool_calls
        .map((c) => `${c.name}: ${c.result.ok ? "ok" : c.result.error}`)
        .join("; ");
      await writeAuditLog({
        actor_type: "agent",
        actor_name: AGENT_NAME,
        action: "PAYROLL_MAPPING_FAILED",
        entity_type: "payroll_run",
        entity_id: run_id,
        payroll_run_id: run_id,
        reason: `Agent stopped without a successful propose_payroll_mapping call. stop_reason=${result.stop_reason}; iterations=${result.iterations}; tool_calls=[${summary || "none"}]`,
        status: "failed",
      });
      return Response.json(
        {
          error: "mapping_failed",
          stop_reason: result.stop_reason,
          iterations: result.iterations,
          tool_calls: result.tool_calls,
        },
        { status: 500 },
      );
    }

    const successfulCall = successfulProposals[0];
    // `successfulProposals[0].result.ok === true` is guaranteed by
    // the filter above, so the type narrowing is safe.
    const proposedMappingId =
      successfulCall.result.ok &&
      typeof successfulCall.result.data === "object" &&
      successfulCall.result.data !== null &&
      "mapping_id" in successfulCall.result.data
        ? (successfulCall.result.data as { mapping_id: string }).mapping_id
        : null;

    return Response.json({
      run_id,
      plan_id: id,
      auto_applied: false,
      mapping_id: proposedMappingId,
      stop_reason: result.stop_reason,
      iterations: result.iterations,
      tool_calls: result.tool_calls,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
