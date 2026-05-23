import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { extractAssistantText, runAgent } from "@/lib/server/agents/run";
import { toErrorResponse } from "@/lib/server/http";
import { getPlan } from "@/lib/server/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.string().uuid() });

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  history: z.array(historyMessageSchema).max(40).default([]),
  user_name: z.string().min(1).max(120).default("demo_operator"),
});

const AGENT_NAME = "onboarding-assistant-agent";

const ASSISTANT_TOOLS = [
  "get_plan_details",
  "get_participants",
  "list_reconciliation_issues",
  "list_audit_logs",
] as const;

/**
 * POST /api/plans/[id]/assistant
 *
 * Multi-turn onboarding Q&A. The client sends the new user message plus
 * prior turns; the assistant may call read-only tools before replying.
 * Writes CHAT_QUESTION_ASKED (user) and MCP_TOOL_CALLED (per tool) audit
 * rows. Never mutates domain data.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = bodySchema.parse(await request.json().catch(() => ({})));

    const plan = await getPlan(id);
    if (!plan) {
      return Response.json(
        { error: "not_found", message: `no plans row with id ${id}` },
        { status: 404 },
      );
    }

    const questionAudit = await writeAuditLog({
      actor_type: "user",
      actor_name: body.user_name,
      action: "CHAT_QUESTION_ASKED",
      entity_type: "plan",
      entity_id: id,
      reason: body.message,
    });

    const conversation: Array<MessageParam> = [
      ...body.history.map(
        (turn): MessageParam => ({
          role: turn.role,
          content: turn.content,
        }),
      ),
      { role: "user", content: body.message },
    ];

    const result = await runAgent({
      skill: "onboarding-assistant",
      tool_names: ASSISTANT_TOOLS,
      conversation,
      actor_name: AGENT_NAME,
      max_iterations: 8,
      max_tokens: 4096,
    });

    for (const tc of result.tool_calls) {
      await writeAuditLog({
        actor_type: "agent",
        actor_name: AGENT_NAME,
        action: "MCP_TOOL_CALLED",
        entity_type: "plan",
        entity_id: id,
        after_value: {
          tool: tc.name,
          ok: tc.result.ok,
          ...(tc.result.ok ? {} : { error: tc.result.error }),
        },
        reason: `Assistant invoked ${tc.name}`,
      });
    }

    const reply = extractAssistantText(result.final_content);
    if (!reply && result.stop_reason === "max_tokens") {
      return Response.json(
        {
          error: "max_tokens",
          message: "Assistant response was truncated; try a narrower question.",
          stop_reason: result.stop_reason,
          iterations: result.iterations,
          tool_calls: result.tool_calls.map((tc) => ({
            name: tc.name,
            ok: tc.result.ok,
          })),
          audit_log_id: questionAudit.id,
        },
        { status: 500 },
      );
    }

    return Response.json({
      reply:
        reply ||
        "I couldn't generate a reply. Try rephrasing or ask about plan details, participants, issues, or the audit trail.",
      stop_reason: result.stop_reason,
      iterations: result.iterations,
      tool_calls: result.tool_calls.map((tc) => ({
        name: tc.name,
        ok: tc.result.ok,
      })),
      audit_log_id: questionAudit.id,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
