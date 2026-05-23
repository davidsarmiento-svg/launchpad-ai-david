import "server-only";

import { z } from "zod";

/**
 * Schema for `plans.extracted_fields` JSON produced by the Plan
 * Extraction Agent.
 *
 * Mirrors `skills/plan-extraction/SKILL.md` 1:1. If you add or rename
 * a field here, change the SKILL.md table in the same commit -- the
 * skill file is the prompt the model sees, so the two must stay in
 * sync or the model will keep producing the old shape.
 *
 * `unknown` is intentionally NOT in the type union. Every field has a
 * declared shape and either holds the extracted value or `null`. The
 * agent is instructed to use `null` rather than omitting a field, so
 * approvers see "agent looked, found nothing" rather than "agent
 * didn't bother to look".
 */
export const extractedPlanFieldsSchema = z.object({
  company_name: z.string().min(1),
  plan_name: z.string().min(1),

  /** Federal EIN in `NN-NNNNNNN` format. */
  ein: z.string().regex(/^\d{2}-\d{7}$/, "EIN must look like NN-NNNNNNN"),

  /** Original plan effective date. ISO YYYY-MM-DD. */
  plan_effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "plan_effective_date must be YYYY-MM-DD"),

  /** Last day of the plan year, no year prefix. e.g. "12-31". */
  plan_year_end: z
    .string()
    .regex(/^\d{2}-\d{2}$/, "plan_year_end must be MM-DD"),

  eligibility: z.string().min(1),
  entry_dates: z.string().min(1),

  auto_enrollment: z.boolean(),
  /** Current rate as a percentage string, e.g. "3%". */
  default_deferral_rate: z.string().min(1),

  auto_escalation: z.boolean(),
  auto_escalation_detail: z.string().min(1).nullable(),

  employer_match: z.string().min(1),
  /** Computed from the formula, e.g. "4%". */
  max_match_percentage: z.string().min(1),
  vesting_schedule: z.string().min(1),

  safe_harbor: z.boolean(),
  roth_allowed: z.boolean(),

  loans_allowed: z.boolean(),
  loan_max_outstanding: z.number().int().min(0).nullable(),
  loan_cap: z.number().min(0).nullable(),

  payroll_frequency: z.string().min(1),
  payroll_provider: z.string().min(1).nullable(),
  recordkeeper: z.string().min(1).nullable(),
  tpa: z.string().min(1).nullable(),
  advisor: z.string().min(1).nullable(),
});

export type ExtractedPlanFields = z.infer<typeof extractedPlanFieldsSchema>;

/**
 * Convert the Zod schema to a JSON Schema fragment suitable for the
 * Anthropic `tools[].input_schema` field.
 *
 * Hand-rolled rather than pulled from `zod-to-json-schema` because:
 *   1. We control every field, so the mapping is obvious.
 *   2. Anthropic's tools API expects draft-2020-12 JSON Schema with
 *      `type: "object"`, `properties`, `required` -- a thin surface
 *      area we can build directly without taking a dependency.
 *   3. Keeping this inline next to the Zod schema means a field rename
 *      shows up in one PR diff for the model spec and the validator.
 */
export const extractedPlanFieldsJsonSchema = {
  type: "object" as const,
  properties: {
    company_name: { type: "string" },
    plan_name: { type: "string" },
    ein: {
      type: "string",
      pattern: "^\\d{2}-\\d{7}$",
      description: "Federal EIN in NN-NNNNNNN format.",
    },
    plan_effective_date: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "Original plan effective date, ISO YYYY-MM-DD.",
    },
    plan_year_end: {
      type: "string",
      pattern: "^\\d{2}-\\d{2}$",
      description: "Last day of the plan year, MM-DD, no year prefix.",
    },
    eligibility: { type: "string" },
    entry_dates: { type: "string" },
    auto_enrollment: { type: "boolean" },
    default_deferral_rate: {
      type: "string",
      description: "Current rate as a percentage string, e.g. '3%'.",
    },
    auto_escalation: { type: "boolean" },
    auto_escalation_detail: { type: ["string", "null"] },
    employer_match: { type: "string" },
    max_match_percentage: { type: "string" },
    vesting_schedule: { type: "string" },
    safe_harbor: { type: "boolean" },
    roth_allowed: { type: "boolean" },
    loans_allowed: { type: "boolean" },
    loan_max_outstanding: { type: ["integer", "null"] },
    loan_cap: { type: ["number", "null"] },
    payroll_frequency: { type: "string" },
    payroll_provider: { type: ["string", "null"] },
    recordkeeper: { type: ["string", "null"] },
    tpa: { type: ["string", "null"] },
    advisor: { type: ["string", "null"] },
  },
  required: [
    "company_name",
    "plan_name",
    "ein",
    "plan_effective_date",
    "plan_year_end",
    "eligibility",
    "entry_dates",
    "auto_enrollment",
    "default_deferral_rate",
    "auto_escalation",
    "employer_match",
    "max_match_percentage",
    "vesting_schedule",
    "safe_harbor",
    "roth_allowed",
    "loans_allowed",
    "payroll_frequency",
  ],
  additionalProperties: false,
} as const;
