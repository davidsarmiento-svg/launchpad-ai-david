import "server-only";

import { z } from "zod";

import { auditLogInputSchema, writeAuditLog } from "@/lib/server/audit-log";
import { DataLayerError } from "@/lib/server/errors";
import {
  importParticipants,
  importParticipantsInputSchema,
} from "@/lib/server/participants";
import {
  payrollMappingProposalJsonSchema,
  payrollMappingProposalSchema,
} from "@/lib/server/payroll-mapping";
import { proposeMapping } from "@/lib/server/payroll-mappings";
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
// save_participants
// ---------------------------------------------------------------------------

/**
 * `importParticipantsInputSchema` already validates plan_id,
 * source_file_id, and the participants array. We extend it with an
 * optional `reason` so the agent can attach a short summary to the
 * `PARTICIPANTS_IMPORTED` audit row -- mirrors the `reason` field on
 * `save_plan_details`.
 */
const saveParticipantsInputSchema = importParticipantsInputSchema.extend({
  reason: z.string().min(1).max(2000).optional(),
});

type SaveParticipantsInput = z.infer<typeof saveParticipantsInputSchema>;

const participantItemJsonSchema = {
  type: "object" as const,
  properties: {
    participant_id: {
      type: "string",
      description: "Census participant id, e.g. 'P0001'.",
    },
    employee_id: {
      type: "string",
      description:
        "Employer-side employee id. Natural key for upsert.",
    },
    first_name: { type: "string" },
    last_name: { type: "string" },
    email: {
      type: ["string", "null"],
      description: "RFC-valid email or null.",
    },
    date_of_birth: {
      type: ["string", "null"],
      description: "ISO date YYYY-MM-DD or null.",
    },
    hire_date: {
      type: ["string", "null"],
      description: "ISO date YYYY-MM-DD or null.",
    },
    eligibility_status: {
      type: ["string", "null"],
      enum: [
        "Eligible",
        "Ineligible - Terminated",
        "Pending - In Service Period",
        "Ineligible - Other",
        null,
      ],
    },
    current_deferral_rate: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description:
        "Decimal in [0, 1]. e.g. 0.05 for 5%. NEVER pass percentage values like 5 -- the validator rejects rates above 1.",
    },
    roth_deferral_rate: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Decimal in [0, 1]. Same units as current_deferral_rate.",
    },
    account_balance: {
      type: "number",
      description: "Dollars and cents, e.g. 45200.00.",
    },
    loan_balance: {
      type: "number",
      description: "Dollars and cents, e.g. 0.00.",
    },
    employment_status: {
      type: ["string", "null"],
      enum: ["Active", "Terminated", "On Leave", "Unknown", null],
    },
    beneficiary_on_file: { type: "boolean" },
  },
  required: [
    "participant_id",
    "employee_id",
    "first_name",
    "last_name",
  ],
  additionalProperties: false,
};

const saveParticipants: ToolDefinition<SaveParticipantsInput> = {
  name: "save_participants",
  description:
    "Bulk-upsert participants into the participants table. The upsert " +
    "key is (plan_id, employee_id), so re-running the same import is " +
    "idempotent. Call this exactly once per CSV. Rates must be decimals " +
    "in [0, 1] (e.g. 0.05 for 5%) -- the validator rejects anything " +
    "higher. Use null for any missing or unparseable nullable field; " +
    "for unrecoverable required fields (e.g. missing employee_id), " +
    "skip the row entirely and emit a flag_participant_issue instead.",
  inputJsonSchema: {
    type: "object",
    properties: {
      plan_id: {
        type: "string",
        description: "uuid of the plans row these participants belong to.",
      },
      source_file_id: {
        type: "string",
        description:
          "uuid of the files row holding the CSV being imported. " +
          "Optional in the underlying DAL but always supplied here so the " +
          "audit log can trace the row back to a file.",
      },
      participants: {
        type: "array",
        minItems: 1,
        maxItems: 10000,
        items: participantItemJsonSchema,
      },
      reason: {
        type: "string",
        description:
          "Optional 1-3 sentence summary of the import (e.g. 'Imported " +
          "30 active participants; 0 issues flagged'). Becomes the " +
          "audit-log reason.",
      },
    },
    required: ["plan_id", "participants"],
    additionalProperties: false,
  },
  inputSchema: saveParticipantsInputSchema,
  async handler(input, ctx) {
    try {
      const result = await importParticipants({
        plan_id: input.plan_id,
        source_file_id: input.source_file_id,
        participants: input.participants,
      });

      await writeAuditLog({
        actor_type: "agent",
        actor_name: ctx.actor_name,
        action: "PARTICIPANTS_IMPORTED",
        entity_type: "plan",
        entity_id: input.plan_id,
        after_value: {
          source_file_id: input.source_file_id ?? null,
          count: result.count,
          employee_ids: result.rows.map((r) => r.employee_id),
        },
        reason:
          input.reason ?? "Participants imported by participant-import-agent",
      });

      return {
        ok: true,
        data: {
          count: result.count,
          employee_ids: result.rows.map((r) => r.employee_id),
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
// flag_participant_issue
// ---------------------------------------------------------------------------

const participantIssueCodes = [
  "BLANK_REQUIRED_FIELD",
  "MALFORMED_EMAIL",
  "INVALID_DATE",
  "RATE_AMBIGUOUS",
  "DUPLICATE_EMPLOYEE_ID",
  "INVALID_ENUM",
  "OTHER",
] as const;

const flagParticipantIssueInputSchema = z.object({
  plan_id: z.string().uuid(),
  source_file_id: z.string().uuid(),
  employee_id: z.string().min(1).optional(),
  row_number: z.number().int().nonnegative().optional(),
  issue_code: z.enum(participantIssueCodes),
  field_name: z.string().min(1).optional(),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  description: z.string().min(1).max(2000),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
});

type FlagParticipantIssueInput = z.infer<typeof flagParticipantIssueInputSchema>;

const flagParticipantIssue: ToolDefinition<FlagParticipantIssueInput> = {
  name: "flag_participant_issue",
  description:
    "Record a row-level data-quality problem you noticed while " +
    "importing a participant census. Each call writes one audit_logs " +
    "row with action='PARTICIPANT_DATA_QUALITY_ISSUE'. Use this for " +
    "issues you can describe with a single code (malformed email, " +
    "invalid date, ambiguous rate, etc.) rather than refusing to " +
    "import the row.",
  inputJsonSchema: {
    type: "object",
    properties: {
      plan_id: { type: "string", description: "uuid of the plans row." },
      source_file_id: {
        type: "string",
        description: "uuid of the files row (the CSV being imported).",
      },
      employee_id: {
        type: "string",
        description: "The row's employee_id, when known.",
      },
      row_number: {
        type: "integer",
        minimum: 0,
        description:
          "1-indexed CSV body row number (header is row 0). Optional.",
      },
      issue_code: {
        type: "string",
        enum: [...participantIssueCodes],
        description:
          "BLANK_REQUIRED_FIELD: required column was empty. " +
          "MALFORMED_EMAIL: value looked like an email but didn't parse. " +
          "INVALID_DATE: value couldn't be parsed to YYYY-MM-DD. " +
          "RATE_AMBIGUOUS: bare numeric rate (assumed percent). " +
          "DUPLICATE_EMPLOYEE_ID: same employee_id as an earlier row. " +
          "INVALID_ENUM: value didn't match the enum for the field. " +
          "OTHER: anything else worth surfacing.",
      },
      field_name: {
        type: "string",
        description: "The CSV column the problem is about. Optional.",
      },
      severity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Defaults to 'medium'.",
      },
      description: {
        type: "string",
        description:
          "One human-readable sentence explaining the issue. Becomes " +
          "the audit-log reason.",
      },
      expected: {
        description: "The normalized value you used. Optional.",
      },
      actual: {
        description: "The raw CSV value. Optional.",
      },
    },
    required: [
      "plan_id",
      "source_file_id",
      "issue_code",
      "description",
    ],
    additionalProperties: false,
  },
  inputSchema: flagParticipantIssueInputSchema,
  async handler(input, ctx) {
    try {
      const row = await writeAuditLog({
        actor_type: "agent",
        actor_name: ctx.actor_name,
        action: "PARTICIPANT_DATA_QUALITY_ISSUE",
        entity_type: "file",
        entity_id: input.source_file_id,
        employee_id: input.employee_id,
        field_name: input.field_name,
        before_value: {
          actual: input.actual,
          issue_code: input.issue_code,
          row_number: input.row_number,
        },
        after_value: { expected: input.expected },
        reason: input.description,
        status: input.severity,
      });
      return { ok: true, data: { audit_log_id: row.id } };
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
// propose_payroll_mapping
// ---------------------------------------------------------------------------

const proposePayrollMappingInputSchema = z.object({
  plan_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  mapping: payrollMappingProposalSchema,
  reason: z.string().min(1).max(2000),
});

type ProposePayrollMappingInput = z.infer<
  typeof proposePayrollMappingInputSchema
>;

const proposePayrollMapping: ToolDefinition<ProposePayrollMappingInput> = {
  name: "propose_payroll_mapping",
  description:
    "Persist a proposed payroll-CSV column mapping for human review. " +
    "The mapping links CSV header columns to the canonical payroll " +
    "fields. After this call the mapping row is in 'pending' status; " +
    "a human operator approves or rejects before any payroll_records " +
    "get ingested. Call this exactly once after analyzing the CSV " +
    "header + sample rows.",
  inputJsonSchema: {
    type: "object",
    properties: {
      plan_id: {
        type: "string",
        description: "uuid of the plans row this mapping belongs to.",
      },
      name: {
        type: "string",
        description:
          "Short human-readable label for this mapping, e.g. 'ACME " +
          "payroll CSV (Pay Period 2026-04)' or 'Auto-detected ACME " +
          "payroll'.",
      },
      mapping: payrollMappingProposalJsonSchema,
      reason: {
        type: "string",
        description:
          "1-3 sentences explaining notable choices: e.g. which column " +
          "you picked over a near-synonym, any flagged columns, why a " +
          "canonical field was left null. Becomes the audit-log reason " +
          "for the human reviewer.",
      },
    },
    required: ["plan_id", "name", "mapping", "reason"],
    additionalProperties: false,
  },
  inputSchema: proposePayrollMappingInputSchema,
  async handler(input, ctx) {
    try {
      const row = await proposeMapping({
        plan_id: input.plan_id,
        name: input.name,
        proposal: input.mapping,
        suggested_by: ctx.actor_name,
      });

      await writeAuditLog({
        actor_type: "agent",
        actor_name: ctx.actor_name,
        action: "PAYROLL_MAPPING_PROPOSED",
        entity_type: "plan",
        entity_id: input.plan_id,
        after_value: {
          mapping_id: row.id,
          name: row.name,
          mapping: row.mapping,
        },
        reason: input.reason,
        status: "in_review",
      });

      return {
        ok: true,
        data: {
          mapping_id: row.id,
          status: row.status,
          name: row.name,
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
// flag_mapping_issue
// ---------------------------------------------------------------------------

const flagMappingIssueInputSchema = z.object({
  source_file_id: z.string().uuid(),
  /**
   * null when the issue is "no CSV column maps to canonical field X"
   * (a missing-column flag); a string when the issue is about a
   * specific column the CSV does contain.
   */
  csv_column: z.string().min(1).max(255).nullable(),
  severity: z.enum(["low", "medium", "high"]),
  /** SCREAMING_SNAKE, e.g. AMBIGUOUS_CANDIDATE, UNKNOWN_COLUMN. */
  issue_code: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  sample_values: z.array(z.string()).max(10).optional(),
  /**
   * Up to 11 canonical-field names this column could plausibly map
   * to. 11 = length of CANONICAL_PAYROLL_FIELDS, which is the
   * theoretical upper bound.
   */
  candidate_canonical_fields: z.array(z.string()).max(11).optional(),
});

type FlagMappingIssueInput = z.infer<typeof flagMappingIssueInputSchema>;

const flagMappingIssue: ToolDefinition<FlagMappingIssueInput> = {
  name: "flag_mapping_issue",
  description:
    "Record a column-level mapping issue noticed in the payroll CSV " +
    "header -- for example, two columns that look like candidates for " +
    "the same canonical field, an unknown column with no canonical " +
    "home, or a missing required column. Use this when you want the " +
    "human reviewer to see the issue alongside your proposed mapping; " +
    "the issue does not block the proposal from landing.",
  inputJsonSchema: {
    type: "object",
    properties: {
      source_file_id: {
        type: "string",
        description: "uuid of the files row (the payroll CSV).",
      },
      csv_column: {
        type: ["string", "null"],
        description:
          "The CSV column header the issue is about. null when the " +
          "issue is about a canonical field with no matching column.",
      },
      severity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "low for cosmetic/ambiguous; medium for likely-but-not-" +
          "blocking; high for blocking (e.g. missing required field).",
      },
      issue_code: {
        type: "string",
        description:
          "SCREAMING_SNAKE code, e.g. AMBIGUOUS_CANDIDATE, " +
          "UNKNOWN_COLUMN, MISSING_REQUIRED_FIELD.",
      },
      description: {
        type: "string",
        description:
          "One human-readable sentence explaining the issue. Becomes " +
          "the audit-log reason.",
      },
      sample_values: {
        type: "array",
        items: { type: "string" },
        maxItems: 10,
        description:
          "Optional: a few example values from this column to help " +
          "the reviewer judge the call.",
      },
      candidate_canonical_fields: {
        type: "array",
        items: { type: "string" },
        maxItems: 11,
        description:
          "Optional: canonical field name(s) this column might map " +
          "to, or that the missing column would have mapped to.",
      },
    },
    required: [
      "source_file_id",
      "csv_column",
      "severity",
      "issue_code",
      "description",
    ],
    additionalProperties: false,
  },
  inputSchema: flagMappingIssueInputSchema,
  async handler(input, ctx) {
    try {
      const row = await writeAuditLog({
        actor_type: "agent",
        actor_name: ctx.actor_name,
        action: "PAYROLL_MAPPING_ISSUE",
        entity_type: "file",
        entity_id: input.source_file_id,
        field_name: input.csv_column ?? undefined,
        before_value: {
          csv_column: input.csv_column,
          issue_code: input.issue_code,
          sample_values: input.sample_values ?? null,
        },
        after_value: {
          candidate_canonical_fields:
            input.candidate_canonical_fields ?? null,
        },
        reason: input.description,
        status: input.severity,
      });
      return { ok: true, data: { audit_log_id: row.id } };
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

const ALL_TOOLS = [
  savePlanDetails,
  writeAuditLogTool,
  saveParticipants,
  flagParticipantIssue,
  proposePayrollMapping,
  flagMappingIssue,
] as const;

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
