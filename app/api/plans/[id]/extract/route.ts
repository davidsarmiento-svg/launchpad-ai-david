import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { runAgent } from "@/lib/server/agents/run";
import { toErrorResponse } from "@/lib/server/http";
import { getPlan } from "@/lib/server/plans";
import { downloadFileBytes } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/**
 * PDF extraction can take 10-30 s once Claude streams the document
 * and runs the tool loop. The Vercel default function timeout (10 s
 * on hobby) is too short. 60 s is plenty of headroom for one PDF and
 * still well inside the platform's Pro/Enterprise ceiling.
 */
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ file_id: z.string().uuid() });

const AGENT_NAME = "plan-extraction-agent";

/**
 * POST /api/plans/[id]/extract
 *
 * Run the Plan Extraction Agent against an uploaded plan PDF. The
 * client supplies the file_id; the route resolves it to bytes, hands
 * them to Claude with the plan-extraction skill, and lets Claude call
 * `save_plan_details` (which both updates the plans row and writes an
 * audit log entry).
 *
 * Failure model:
 *   - 400: bad plan id / file id / file kind / plan_id mismatch.
 *   - 404: plan or file not found.
 *   - 500: the agent loop completed without ever calling
 *          save_plan_details (we mark `extraction_status='failed'` and
 *          write a PLAN_EXTRACTION_FAILED audit row so the operator
 *          sees the dead end).
 *
 * The response always contains the full `tool_calls` log so the UI
 * can show the operator exactly what the agent did, even on failure.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = await request.json().catch(() => ({}));
    const { file_id } = bodySchema.parse(body);

    const plan = await getPlan(id);
    if (!plan) {
      return Response.json(
        { error: "not_found", message: `no plans row with id ${id}` },
        { status: 404 },
      );
    }

    const { file, bytes } = await downloadFileBytes(file_id);

    if (file.plan_id !== id) {
      return Response.json(
        {
          error: "plan_file_mismatch",
          message: `file ${file_id} belongs to plan ${file.plan_id}, not ${id}`,
        },
        { status: 400 },
      );
    }
    if (file.kind !== "plan_pdf") {
      return Response.json(
        {
          error: "wrong_file_kind",
          message: `file ${file_id} has kind=${file.kind}; only plan_pdf is extractable`,
        },
        { status: 400 },
      );
    }

    const base64 = Buffer.from(bytes).toString("base64");

    const result = await runAgent({
      skill: "plan-extraction",
      tool_names: ["save_plan_details", "write_audit_log"],
      actor_name: AGENT_NAME,
      user_message: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          },
          title: file.filename,
        },
        {
          type: "text",
          text:
            `Extract the plan details from the attached document.\n\n` +
            `Use save_plan_details with plan_id="${id}" exactly once. ` +
            `Do not produce prose after the tool call.`,
        },
      ],
    });

    const saveCalls = result.tool_calls.filter(
      (c) => c.name === "save_plan_details",
    );
    const savedSuccessfully = saveCalls.some((c) => c.result.ok);

    if (!savedSuccessfully) {
      const summary = result.tool_calls
        .map((c) => `${c.name}: ${c.result.ok ? "ok" : c.result.error}`)
        .join("; ");
      await writeAuditLog({
        actor_type: "agent",
        actor_name: AGENT_NAME,
        action: "PLAN_EXTRACTION_FAILED",
        entity_type: "plan",
        entity_id: id,
        reason: `Agent stopped without a successful save_plan_details call. stop_reason=${result.stop_reason}; iterations=${result.iterations}; tool_calls=[${summary || "none"}]`,
        status: "failed",
      });
      return Response.json(
        {
          error: "extraction_failed",
          stop_reason: result.stop_reason,
          iterations: result.iterations,
          tool_calls: result.tool_calls,
        },
        { status: 500 },
      );
    }

    const updatedPlan = await getPlan(id);
    return Response.json({
      plan: updatedPlan,
      stop_reason: result.stop_reason,
      iterations: result.iterations,
      tool_calls: result.tool_calls,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
