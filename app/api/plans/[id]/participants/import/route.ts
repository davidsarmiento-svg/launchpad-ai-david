import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { runAgent } from "@/lib/server/agents/run";
import { toErrorResponse } from "@/lib/server/http";
import { getPlan } from "@/lib/server/plans";
import { downloadFileBytes } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/**
 * Participant census import can take 10-30 s once Claude reads the
 * CSV and runs the tool loop. The Vercel default function timeout
 * (10 s on hobby) is too short. 60 s matches the Phase 7 extract
 * route and is still well inside the platform's Pro/Enterprise
 * ceiling.
 */
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ file_id: z.string().uuid() });

const AGENT_NAME = "participant-import-agent";

/**
 * POST /api/plans/[id]/participants/import
 *
 * Run the Participant Import Agent against an uploaded participant
 * census CSV. The client supplies `file_id`; the route resolves it to
 * bytes, decodes UTF-8, and hands the text to Claude with the
 * participant-import skill. The agent calls `save_participants` once
 * (which upserts the rows and writes the import audit log) plus zero
 * or more `flag_participant_issue` calls for row-level data-quality
 * problems.
 *
 * Failure model mirrors the extract route:
 *   - 400: bad plan id / file id / file kind / plan_id mismatch.
 *   - 404: plan not found.
 *   - 500: agent loop completed without a successful save_participants
 *          call (we write a PARTICIPANT_IMPORT_FAILED audit row and
 *          return the full tool_calls log so the operator sees the
 *          dead end).
 *
 * Response always includes `tool_calls` so the UI can render the same
 * per-iteration timeline as plan extraction.
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
    if (file.kind !== "participant_census") {
      return Response.json(
        {
          error: "wrong_file_kind",
          message: `file ${file_id} has kind=${file.kind}; only participant_census is importable here`,
        },
        { status: 400 },
      );
    }

    // CSVs are text; embed directly in the user message. No `document`
    // attachment because Anthropic's document blocks are for binary
    // formats (PDF, etc.) -- a CSV in a text block is what Claude
    // expects.
    const csvText = new TextDecoder("utf-8").decode(bytes);

    // Bump max_tokens above the runAgent default (4096). The
    // save_participants tool input is bulk-row JSON (~150 tokens / row
    // for the demo schema), so a 30-row clean census already wants
    // ~5k tokens just for the tool_use payload, plus any
    // pre-tool reasoning. 4096 hits the wall mid-output and the model
    // never emits the tool_use block; we get stop_reason=max_tokens
    // and an empty tool_calls log. 16000 is comfortable headroom for
    // up to ~80 rows and well inside Sonnet 4.5's output ceiling. If
    // demos ever push beyond that, raise here -- this is the right
    // place to budget per agent shape.
    const result = await runAgent({
      skill: "participant-import",
      tool_names: [
        "save_participants",
        "flag_participant_issue",
        "write_audit_log",
      ],
      actor_name: AGENT_NAME,
      max_tokens: 16000,
      user_message: [
        {
          type: "text",
          text:
            `Import the participant census attached below. ` +
            `Use save_participants with plan_id="${id}" and ` +
            `source_file_id="${file_id}" exactly once. Call ` +
            `flag_participant_issue for any row-level data-quality ` +
            `issues you noticed. Do not produce prose after the tool ` +
            `calls.\n\n` +
            `CSV (first line is header):\n\n` +
            csvText,
        },
      ],
    });

    const saveCalls = result.tool_calls.filter(
      (c) => c.name === "save_participants",
    );
    const flagCalls = result.tool_calls.filter(
      (c) => c.name === "flag_participant_issue",
    );
    const successfulSaves = saveCalls.filter((c) => c.result.ok).length;
    const successfulFlags = flagCalls.filter((c) => c.result.ok).length;

    if (successfulSaves === 0) {
      const summary = result.tool_calls
        .map((c) => `${c.name}: ${c.result.ok ? "ok" : c.result.error}`)
        .join("; ");
      await writeAuditLog({
        actor_type: "agent",
        actor_name: AGENT_NAME,
        action: "PARTICIPANT_IMPORT_FAILED",
        entity_type: "file",
        entity_id: file_id,
        reason: `Agent stopped without a successful save_participants call. stop_reason=${result.stop_reason}; iterations=${result.iterations}; tool_calls=[${summary || "none"}]`,
        status: "failed",
      });
      return Response.json(
        {
          error: "import_failed",
          stop_reason: result.stop_reason,
          iterations: result.iterations,
          tool_calls: result.tool_calls,
        },
        { status: 500 },
      );
    }

    return Response.json({
      plan_id: id,
      file: { id: file.id, filename: file.filename, kind: file.kind },
      save_calls: successfulSaves,
      flag_calls: successfulFlags,
      stop_reason: result.stop_reason,
      iterations: result.iterations,
      tool_calls: result.tool_calls,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
