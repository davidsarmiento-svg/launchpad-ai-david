import "server-only";

import { z } from "zod";

import { auditLogInputSchema, writeAuditLog } from "@/lib/server/audit-log";
import { DataLayerError } from "@/lib/server/errors";
import {
  extractedPlanFieldsJsonSchema,
  extractedPlanFieldsSchema,
} from "@/lib/server/plan-extraction";
import { updateExtractedFields } from "@/lib/server/plans";

/**
 * Tool registry for the Claude tool-use loop.
 *
 * Each entry pairs:
 *   - the JSON schema sent to Claude in `messages.create({ tools })`,
 *   - a Zod schema that re-validates the model's output before any
 *     side effect happens, and
 *   - an async handler that performs the side effect.
 *
 * The agent runner (lib/server/agents/run.ts) iterates Claude's
 * tool_use blocks, looks them up by name in this map, validates the
 * input, invokes the handler, and returns the result as a
 * tool_result block. A tool name Claude calls that isn't in this map
 * is surfaced as `{ ok: false, error: "unknown tool ..." }` so the
 * model can self-correct on the next turn.
 *
 * Why JSON Schema AND Zod (belt + suspenders):
 *   - JSON Schema goes to Claude so it knows the contract.
 *   - Zod runs server-side because models occasionally invent fields
 *     or drop required ones, and we never want bad data to reach the
 *     DB. Two independent checks > one.
 */

export type ToolContext = {
  /** Always set on every agent run; threaded into audit rows. */
  actor_name: string;
};

export type ToolHandlerResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type ToolDefinition<TInput> = {
  name: string;
  description: string;
  inputJsonSchema: Record<string, unknown>;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput, ctx: ToolContext) => Promise<ToolHandlerResult>;
};

// ---------------------------------------------------------------------------
// save_plan_details
// ---------------------------------------------------------------------------

const savePlanDetailsInputSchema = z.object({
  plan_id: z.string().uuid(),
  extracted_fields: extractedPlanFieldsSchema,
  reason: z.string().min(1).max(2000),
});

type SavePlanDetailsInput = z.infer<typeof savePlanDetailsInputSchema>;

const savePlanDetails: ToolDefinition<SavePlanDetailsInput> = {
  name: "save_plan_details",
  description:
    "Persist the structured plan fields you extracted from the plan document. " +
    "This sets plans.extraction_status to 'in_review' (the human approver " +
    "still has to flip it to 'approved'). Call this exactly once per plan " +
    "extraction. The `reason` becomes the audit-log entry and should " +
    "summarize any contradictions you resolved while extracting.",
  inputJsonSchema: {
    type: "object",
    properties: {
      plan_id: {
        type: "string",
        description: "uuid of the plans row to update.",
      },
      extracted_fields: extractedPlanFieldsJsonSchema,
      reason: {
        type: "string",
        description:
          "1-3 sentence summary of contradictions resolved, ambiguities, " +
          "or interesting observations from the document. Becomes the " +
          "audit-log reason for human reviewers.",
      },
    },
    required: ["plan_id", "extracted_fields", "reason"],
    additionalProperties: false,
  },
  inputSchema: savePlanDetailsInputSchema,
  async handler(input, ctx) {
    try {
      // Snapshot the prior extracted_fields so the audit log has a real
      // before/after diff. Acceptable to skip on the first extraction
      // (empty `{}` is fine for `before_value`).
      const updated = await updateExtractedFields(input.plan_id, {
        extracted_fields: input.extracted_fields,
        extraction_status: "in_review",
        employer_name: input.extracted_fields.company_name,
        plan_name: input.extracted_fields.plan_name,
      });

      await writeAuditLog({
        actor_type: "agent",
        actor_name: ctx.actor_name,
        action: "PLAN_DETAILS_EXTRACTED",
        entity_type: "plan",
        entity_id: input.plan_id,
        after_value: {
          extraction_status: updated.extraction_status,
          extracted_at: updated.extracted_at,
          extracted_fields: input.extracted_fields,
        },
        reason: input.reason,
        status: "in_review",
      });

      return {
        ok: true,
        data: {
          plan_id: updated.id,
          extraction_status: updated.extraction_status,
          extracted_at: updated.extracted_at,
        },
      };
    } catch (err) {
      if (err instanceof DataLayerError) {
        return { ok: false, error: err.message };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ---------------------------------------------------------------------------
// write_audit_log
// ---------------------------------------------------------------------------

// Match the shape of writeAuditLog but force `actor_type` to "agent"
// when invoked through the tool path. Agents may not impersonate users
// or the system, and `actor_name` is supplied by the runner (not the
// model) so the model can't forge attribution either.
const writeAuditLogToolInputSchema = auditLogInputSchema.omit({
  actor_type: true,
  actor_name: true,
});

type WriteAuditLogToolInput = z.infer<typeof writeAuditLogToolInputSchema>;

const writeAuditLogTool: ToolDefinition<WriteAuditLogToolInput> = {
  name: "write_audit_log",
  description:
    "Record a separate audit-log observation. Most tools (e.g. " +
    "save_plan_details) write their own audit row, so use this only for " +
    "observations that don't fit another tool's payload -- for example, " +
    "flagging a notable contradiction you noticed but did not act on. " +
    "actor_type and actor_name are filled in automatically as the agent.",
  inputJsonSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "Verb describing what happened, e.g. PLAN_DOCUMENT_INCONSISTENCY_NOTED.",
      },
      entity_type: { type: "string" },
      entity_id: { type: "string" },
      payroll_run_id: { type: "string" },
      employee_id: { type: "string" },
      field_name: { type: "string" },
      before_value: {},
      after_value: {},
      reason: { type: "string" },
      status: { type: "string" },
    },
    required: ["action"],
    additionalProperties: false,
  },
  inputSchema: writeAuditLogToolInputSchema,
  async handler(input, ctx) {
    try {
      const row = await writeAuditLog({
        actor_type: "agent",
        actor_name: ctx.actor_name,
        ...input,
      });
      return { ok: true, data: row };
    } catch (err) {
      if (err instanceof DataLayerError) {
        return { ok: false, error: err.message };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ALL_TOOLS = [savePlanDetails, writeAuditLogTool] as const;

const TOOLS_BY_NAME: Record<string, ToolDefinition<unknown>> =
  Object.fromEntries(
    ALL_TOOLS.map((t) => [t.name, t as ToolDefinition<unknown>]),
  );

/**
 * Pick a subset of the registry by name. Returns the JSON-schema-only
 * shape that the Anthropic SDK's `messages.create({ tools })` expects.
 */
export function getToolsForClaude(names: ReadonlyArray<string>): Array<{
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [k: string]: unknown;
  };
}> {
  return names.map((n) => {
    const t = TOOLS_BY_NAME[n];
    if (!t) throw new Error(`Tool not found in registry: ${n}`);
    return {
      name: t.name,
      description: t.description,
      input_schema: t.inputJsonSchema as {
        type: "object";
        properties?: Record<string, unknown>;
        required?: string[];
      },
    };
  });
}

/**
 * Dispatch a tool_use block coming back from Claude. Validates the
 * model's input via Zod and runs the handler. Returns a shape suitable
 * for embedding in a `tool_result` block (stringified JSON).
 */
export async function dispatchToolCall(args: {
  name: string;
  input: unknown;
  context: ToolContext;
}): Promise<ToolHandlerResult> {
  const tool = TOOLS_BY_NAME[args.name];
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${args.name}` };
  }

  const parsed = tool.inputSchema.safeParse(args.input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        `Invalid input for tool ${args.name}: ` +
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
    };
  }

  return tool.handler(parsed.data, args.context);
}

/** All registered tool names. Useful for "give the agent everything". */
export const ALL_TOOL_NAMES: ReadonlyArray<string> = ALL_TOOLS.map(
  (t) => t.name,
);
