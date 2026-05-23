import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { readJsonBody, toErrorResponse } from "@/lib/server/http";
import {
  buildIngestRecord,
  parseCsvHeaderAndRows,
} from "@/lib/server/payroll-ingest";
import {
  csvHeaderCoversMapping,
  payrollMappingProposalSchema,
} from "@/lib/server/payroll-mapping";
import { approveMapping } from "@/lib/server/payroll-mappings";
import {
  applyMappingToRun,
  getPayrollRun,
  type PayrollRunRow,
} from "@/lib/server/payroll-runs";
import { downloadFileBytes } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
  mapping_id: z.string().uuid(),
});

const approveBodySchema = z.object({
  /**
   * Optional human edits to the agent's proposal. When omitted the
   * stored mapping is approved as-is.
   */
  proposal: payrollMappingProposalSchema.optional(),
  approver_name: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000).optional(),
  /**
   * Optional convenience: if the reviewer wants the approved mapping
   * to immediately ingest a specific payroll_runs row (e.g. the run
   * that triggered the proposal), pass its id. We attempt the ingest
   * but never let an ingest failure roll back the approval -- the
   * mapping has already been promoted.
   */
  ingest_run_id: z.string().uuid().optional(),
});

/**
 * PATCH /api/plans/[id]/payroll-mappings/[mapping_id]
 *
 * Approve a pending mapping (optionally with human edits) and
 * optionally ingest a payroll run in the same call.
 *
 * Status flow:
 *   - 200: mapping reaches status='approved'. Body may include
 *          `ingest_skipped: true` if the optional ingest didn't fit
 *          (run wrong state, header mismatch, etc.); the approve
 *          itself still succeeded.
 *   - 400: bad uuid or malformed body.
 *   - 404: no mapping with that id.
 *   - 409: mapping exists but isn't 'pending'.
 *   - 500: data-layer error during approve or ingest.
 *
 * Side effects:
 *   - payroll_mappings: target row promoted to 'approved', prior
 *     approved row (if any) flipped to 'superseded' by the DAL.
 *   - audit_logs: PAYROLL_MAPPING_APPROVED row; plus a separate
 *     PAYROLL_RUN_MAPPED row if the optional ingest fires.
 *   - payroll_runs / payroll_records: only when `ingest_run_id` is
 *     provided AND the run is in a usable state.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; mapping_id: string }> },
) {
  try {
    const { id, mapping_id } = paramsSchema.parse(await ctx.params);
    const body = await readJsonBody(request, approveBodySchema);

    const { mapping, before, after, superseded_id } = await approveMapping(
      mapping_id,
      {
        proposal: body.proposal,
        approver_name: body.approver_name,
        reason: body.reason,
      },
    );

    const approveAudit = await writeAuditLog({
      actor_type: "user",
      actor_name: body.approver_name,
      action: "PAYROLL_MAPPING_APPROVED",
      entity_type: "plan",
      entity_id: id,
      before_value: { mapping: before, superseded_id: superseded_id ?? null },
      after_value: {
        mapping_id: mapping.id,
        mapping: after,
        name: mapping.name,
      },
      reason: body.reason ?? "Mapping approved",
      status: "approved",
    });

    // ---- Optional ingest path -------------------------------------------
    // Approve already succeeded; from here on a failure becomes an
    // `ingest_skipped` flag in the response body, never a non-2xx
    // status code. The user already saw "approval landed".
    let ingestRun: PayrollRunRow | undefined;
    let ingestRecordCount: number | undefined;
    let ingestSkipped: boolean | undefined;
    let ingestSkipReason: string | undefined;

    if (body.ingest_run_id) {
      const run = await getPayrollRun(body.ingest_run_id);
      if (!run) {
        ingestSkipped = true;
        ingestSkipReason = `run ${body.ingest_run_id} not found`;
      } else if (run.plan_id !== id) {
        ingestSkipped = true;
        ingestSkipReason = `run belongs to plan ${run.plan_id}, not ${id}`;
      } else if (run.status !== "uploaded") {
        ingestSkipped = true;
        ingestSkipReason = `run status is ${run.status}, expected uploaded`;
      } else if (!run.source_file_id) {
        ingestSkipped = true;
        ingestSkipReason = "run has no source_file_id";
      } else {
        const { bytes } = await downloadFileBytes(run.source_file_id);
        let header: string[];
        let records: Array<Record<string, string>>;
        try {
          const parsed = parseCsvHeaderAndRows(bytes);
          header = parsed.header;
          records = parsed.records;
        } catch (err) {
          ingestSkipped = true;
          ingestSkipReason = `csv_parse_failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
          header = [];
          records = [];
        }

        if (!ingestSkipped) {
          if (records.length === 0) {
            ingestSkipped = true;
            ingestSkipReason = "empty_csv";
          } else if (!csvHeaderCoversMapping(header, mapping.mapping)) {
            ingestSkipped = true;
            ingestSkipReason = "header_mismatch";
          } else {
            const ingestRecords = records.map((row, idx) =>
              buildIngestRecord(row, mapping.mapping, idx + 1),
            );
            const applyResult = await applyMappingToRun({
              run_id: run.id,
              mapping_id: mapping.id,
              records: ingestRecords,
            });
            ingestRun = applyResult.run;
            ingestRecordCount = applyResult.record_count;

            await writeAuditLog({
              actor_type: "user",
              actor_name: body.approver_name,
              action: "PAYROLL_RUN_MAPPED",
              entity_type: "payroll_run",
              entity_id: run.id,
              payroll_run_id: run.id,
              after_value: {
                mapping_id: mapping.id,
                record_count: ingestRecords.length,
                auto_applied: false,
                via: "approve_route",
              },
              reason:
                "Ingest triggered by mapping-approval call with ingest_run_id.",
            });
          }
        }
      }
    }

    return Response.json({
      mapping,
      audit_log_id: approveAudit.id,
      ...(ingestSkipped !== undefined ? { ingest_skipped: ingestSkipped } : {}),
      ...(ingestSkipReason ? { ingest_skip_reason: ingestSkipReason } : {}),
      ...(ingestRun ? { run: ingestRun } : {}),
      ...(ingestRecordCount !== undefined
        ? { record_count: ingestRecordCount }
        : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
