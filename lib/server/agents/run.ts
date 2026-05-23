import "server-only";

import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

import { getAnthropicClient } from "@/lib/server/anthropic";
import { loadSkill } from "@/lib/server/agents/skills";
import { DataLayerError } from "@/lib/server/errors";
import {
  dispatchToolCall,
  getToolsForClaude,
  type ToolContext,
} from "@/lib/server/tools/registry";

/**
 * Generic Claude agent runner.
 *
 * Most of the LaunchPad agents follow the same shape:
 *   1. Load a markdown skill -> use as the system prompt.
 *   2. Hand Claude a user message (text + optional documents/images).
 *   3. Expose a fixed set of tools from `lib/server/tools/registry`.
 *   4. Loop until Claude stops with reason="end_turn" or hits the
 *      max-iteration safety stop.
 *
 * This function captures that loop once so each agent endpoint can
 * stay a thin shell. The return value contains both the final assistant
 * text/tool-uses AND a structured record of every tool call (input,
 * output, ok/error) so the Route Handler can mirror them into audit
 * logs and the UI can show a clear "what did the agent do" timeline.
 *
 * Safety stops:
 *   - `max_iterations` (default 8) caps the agent loop so a runaway
 *     tool-use cycle can't burn the budget. The Plan Extraction Agent
 *     needs ~2 turns (extract -> save_plan_details -> end), so 8 is
 *     generous.
 *   - Each tool call is dispatched via `dispatchToolCall` which Zod-
 *     validates the model's input. Bad inputs come back as
 *     `{ok: false, error}` tool_results, which the model can fix on
 *     the next turn.
 */

export const DEFAULT_MODEL = "claude-sonnet-4-5" as const;

export type AgentMessage = {
  role: "user";
  content: Array<ContentBlockParam>;
};

export type AgentToolCallRecord = {
  iteration: number;
  tool_use_id: string;
  name: string;
  input: unknown;
  result: { ok: true; data: unknown } | { ok: false; error: string };
};

export type RunAgentInput = {
  /** Folder name under `skills/`, e.g. "plan-extraction". */
  skill: string;
  /** Tool names from `lib/server/tools/registry`. */
  tool_names: ReadonlyArray<string>;
  /** Initial user message (often text + a document block). */
  user_message: AgentMessage["content"];
  /**
   * Identifier written into every audit row this run produces.
   * e.g. "plan-extraction-agent".
   */
  actor_name: string;
  /** Defaults to DEFAULT_MODEL. */
  model?: string;
  /** Defaults to 4096; bump for agents that need long-form output. */
  max_tokens?: number;
  /** Defaults to 8; raise only when you understand the cost shape. */
  max_iterations?: number;
};

export type RunAgentResult = {
  stop_reason: string | null;
  iterations: number;
  /** Final assistant content blocks (text + tool_uses). */
  final_content: Array<ContentBlock>;
  /** Every tool call observed, in order. */
  tool_calls: Array<AgentToolCallRecord>;
};

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const {
    skill,
    tool_names,
    user_message,
    actor_name,
    model = DEFAULT_MODEL,
    max_tokens = 4096,
    max_iterations = 8,
  } = input;

  const system = await loadSkill(skill);
  const tools = getToolsForClaude(tool_names);
  const ctx: ToolContext = { actor_name };

  const anthropic = getAnthropicClient();

  const conversation: Array<MessageParam> = [
    { role: "user", content: user_message },
  ];
  const tool_calls: Array<AgentToolCallRecord> = [];
  let lastStopReason: string | null = null;
  let iteration = 0;

  while (iteration < max_iterations) {
    iteration += 1;

    const message = await anthropic.messages.create({
      model,
      max_tokens,
      system,
      tools,
      messages: conversation,
    });

    lastStopReason = message.stop_reason ?? null;
    conversation.push({ role: "assistant", content: message.content });

    if (message.stop_reason !== "tool_use") {
      // end_turn | max_tokens | stop_sequence | pause_turn | refusal
      return {
        stop_reason: lastStopReason,
        iterations: iteration,
        final_content: message.content,
        tool_calls,
      };
    }

    const toolUses = message.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      // Defensive: model said stop_reason=tool_use but emitted no
      // tool_use blocks. Bail with what we have rather than looping.
      return {
        stop_reason: lastStopReason,
        iterations: iteration,
        final_content: message.content,
        tool_calls,
      };
    }

    const toolResults: Array<ContentBlockParam> = [];
    for (const tu of toolUses) {
      let result: AgentToolCallRecord["result"];
      try {
        result = await dispatchToolCall({
          name: tu.name,
          input: tu.input,
          context: ctx,
        });
      } catch (err) {
        // Handlers are supposed to catch their own errors and return
        // {ok:false}. This branch covers anything that slipped through.
        if (err instanceof DataLayerError) {
          result = { ok: false, error: err.message };
        } else {
          result = {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      tool_calls.push({
        iteration,
        tool_use_id: tu.id,
        name: tu.name,
        input: tu.input,
        result,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        is_error: !result.ok,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
      });
    }

    conversation.push({ role: "user", content: toolResults });
  }

  // Safety-stop hit. Return what we have so the route can surface a
  // useful error to the operator.
  return {
    stop_reason: lastStopReason ?? "max_iterations",
    iterations: iteration,
    final_content: [],
    tool_calls,
  };
}
