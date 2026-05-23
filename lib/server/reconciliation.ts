import { z } from "zod";

/**
 * Schema, JSON Schema, tolerances, and helpers for the Payroll
 * Reconciliation Agent.
 *
 * Two directions matter here, mirroring `payroll-mapping.ts`:
 *
 *   1. AGENT-FACING / PROPOSAL shape -- what Claude emits via the
 *      `propose_reconciliation_issue` tool and what a human reviewer
 *      eyeballs in the UI. Issues describe a single problem found in
 *      one payroll run; suggested fixes describe a single mechanical
 *      mutation that would resolve that problem.
 *
 *   2. STORAGE shape -- the rows in `reconciliation_issues` and
 *      `suggested_fixes`. The agent shape lines up 1:1 with the
 *      typed columns on those tables; jsonb columns hold the
 *      free-form value pairs (`expected_value`, `actual_value`,
 *      `proposed_changes`) so the DAL can write a proposal verbatim
 *      and the fix-applier dispatch can pattern-match on `kind` at
 *      apply time.
 *
 * `proposedChangesSchema` is a discriminated union on `kind`. New
 * mutation kinds land here first; the applier dispatch in
 * `fix-appliers.ts` exhaustively switches on the same discriminator
 * so the type checker catches missing handlers at compile time.
 *
 * Field whitelists on the two `*.update` variants are deliberate:
 * they keep the agent from proposing changes to columns that aren't
 * safe to mutate via a fix (foreign keys, computed columns, audit
 * timestamps). Add a column to a whitelist only when you've thought
 * through what an "approve" press on that field actually does.
 *
 * No `server-only` here on purpose: the schema is pure data + Zod, so
 * the human-approval UI in `plan-detail-client.tsx` can import the
 * same Zod validators and inferred types. One source of truth for the
 * agent, the runner, the route handlers, the fix-appliers, and the
 * UI.
 */


// ============================================================================
// Categories and issue codes
// ============================================================================

/**
 * The four categories of reconciliation issue, matching the existing
 * CHECK constraint on `reconciliation_issues.category`. The four map
 * onto the planted-error families exercised by the demo CSV runs:
 *
 *   - `data_quality`      -- blanks, malformed values, duplicates (Run 2)
 *   - `contribution`      -- amounts inconsistent with census rates (Run 3)
 *   - `participant_match` -- identity mismatches against census (Run 4)
 *   - `roster_drift`      -- new/missing/status-changed people (Run 4, 5)
 *
 * Adding a value here requires the matching CHECK migration in the
 * same commit or the DAL insert will fail.
 */
export const RECONCILIATION_CATEGORIES = [
  "data_quality",
  "contribution",
  "participant_match",
  "roster_drift",
] as const;

export type ReconciliationCategory = (typeof RECONCILIATION_CATEGORIES)[number];

/**
 * Stable SCREAMING_SNAKE codes the agent attaches to every issue. The
 * skill (`skills/payroll-reconciliation/SKILL.md`) is the source of
 * truth for when each code fires; this tuple is the strict union the
 * Zod schema validates against.
 *
 * Codes are grouped here by category for readability but the union is
 * flat; the agent must pick one code AND one category and the route
 * handler does not cross-check the two (the skill is explicit about
 * which codes belong to which category).
 */
export const RECONCILIATION_ISSUE_CODES = [
  // data_quality
  "MISSING_EMPLOYEE_ID",
  "MALFORMED_EMAIL",
  "MISSING_GROSS_WAGES",
  "NON_ISO_PAY_DATE",
  "BLANK_EMPLOYMENT_STATUS",
  "DUPLICATE_ROW",

  // contribution
  "CONTRIBUTION_EXCEEDS_GROSS",
  "NEGATIVE_CONTRIBUTION",
  "RATE_AS_DOLLARS",
  "MATCH_WITHOUT_DEFERRAL",
  "YTD_LIMIT_EXCEEDED",
  "LOAN_REPAY_WITHOUT_LOAN",

  // participant_match
  "IDENTITY_NAME_DRIFT",
  "IDENTITY_EMAIL_DRIFT",
  "EMPLOYEE_ID_TYPO",
  "MISSING_FROM_PAYROLL",
  "EMPLOYEE_NOT_IN_CENSUS",

  // roster_drift
  "TERMINATED_STILL_PAID",
  "INELIGIBLE_PARTICIPANT_PAID",

  // contribution (employer-side) + cross-run
  "EMPLOYER_MATCH_WRONG_AMOUNT",
  "DUPLICATE_PAY_PERIOD",
  "REGRESSION_OF_PRIOR_ISSUE",
] as const;

export type ReconciliationIssueCode = (typeof RECONCILIATION_ISSUE_CODES)[number];


// ============================================================================
// Issue input schema (agent-facing)
// ============================================================================

/**
 * Zod schema for one issue proposal emitted by `propose_reconciliation_issue`.
 *
 * Field-by-field rationale:
 *   - `category` / `severity` / `code` -- the triage triple. All required.
 *     Severity is orthogonal to whether a fix is appropriate; the skill is
 *     explicit that the agent must not downgrade severity to avoid
 *     proposing a fix.
 *   - `description` -- one short human sentence ("Row 14 has no gross
 *     wages"). Shown verbatim in the UI list view.
 *   - `agent_explanation` -- the why: what the agent compared, what
 *     evidence in the inputs justified the issue. Longer free text;
 *     shown when a reviewer expands the card.
 *   - `employee_id`, `row_number`, `field_name` -- the optional
 *     anchors. Run-level issues (e.g. DUPLICATE_PAY_PERIOD) omit all
 *     three. Row-level data-quality issues fill `row_number` and
 *     `field_name`. Identity / roster issues fill `employee_id`.
 *   - `expected_value` / `actual_value` -- jsonb on the table; we use
 *     `z.unknown()` so the agent can include any JSON-shaped value
 *     (string, number, boolean, null, object). `.nullable()` is kept
 *     explicit for documentation -- "this field can be present and
 *     null" is a different statement to a reviewer than "omitted".
 *   - `related_issue_id` -- the prior-run issue id referenced by
 *     REGRESSION_OF_PRIOR_ISSUE / DUPLICATE_PAY_PERIOD. UUID validated
 *     so a typoed reference fails at the tool boundary, not later.
 */
export const reconciliationIssueInputSchema = z.object({
  category: z.enum(RECONCILIATION_CATEGORIES),
  severity: z.enum(["low", "medium", "high"]),
  code: z.enum(RECONCILIATION_ISSUE_CODES),
  description: z.string().min(1).max(1000),
  agent_explanation: z.string().min(1).max(2000),
  employee_id: z.string().min(1).nullable().optional(),
  row_number: z.number().int().nullable().optional(),
  field_name: z.string().nullable().optional(),
  expected_value: z.unknown().nullable().optional(),
  actual_value: z.unknown().nullable().optional(),
  related_issue_id: z.uuid().nullable().optional(),
});

export type ReconciliationIssueInput = z.infer<typeof reconciliationIssueInputSchema>;

/**
 * Hand-mirrored JSON Schema for the issue half of the
 * `propose_reconciliation_issue` tool's `input_schema`. Same reasoning
 * as `payrollMappingProposalJsonSchema`: small surface area, kept
 * inline next to the Zod schema so renames show up in one diff.
 *
 * Optional-and-nullable properties use `type: [..., "null"]` and are
 * absent from `required`; the agent may either omit them or send
 * `null`. Run-level issues will omit row_number/field_name/employee_id;
 * the runner doesn't need them to file the row.
 */
export const reconciliationIssueJsonSchema = {
  type: "object" as const,
  properties: {
    category: {
      type: "string" as const,
      enum: [...RECONCILIATION_CATEGORIES],
      description:
        "Which family of problem this is. Must match the skill's category-to-code table.",
    },
    severity: {
      type: "string" as const,
      enum: ["low", "medium", "high"] as const,
      description:
        "Reviewer-facing triage hint. Orthogonal to whether a fix is appropriate.",
    },
    code: {
      type: "string" as const,
      enum: [...RECONCILIATION_ISSUE_CODES],
      description:
        "Stable machine-readable code. One per issue. Pick the most specific code from the skill that fits the observation.",
    },
    description: {
      type: "string" as const,
      minLength: 1,
      maxLength: 1000,
      description:
        "One short human sentence describing the problem (e.g. 'Row 14 has no gross wages').",
    },
    agent_explanation: {
      type: "string" as const,
      minLength: 1,
      maxLength: 2000,
      description:
        "Longer free text: what you compared, which input fields justified the issue, and (if relevant) how a reviewer should think about it.",
    },
    employee_id: {
      type: ["string", "null"] as const,
      description:
        "Source-system employee id when the issue is anchored to a person. Omit or send null for run-level issues.",
    },
    row_number: {
      type: ["integer", "null"] as const,
      description:
        "1-indexed payroll record row when the issue is anchored to a specific row. Omit or send null for run-level issues.",
    },
    field_name: {
      type: ["string", "null"] as const,
      description:
        "Canonical payroll field name the issue is about (e.g. 'gross_wages'). Omit for issues that aren't field-specific.",
    },
    expected_value: {
      description:
        "What the value should have been. Any JSON value (string, number, boolean, null, object). Omit when there is no derivable expected value.",
    },
    actual_value: {
      description:
        "What the value actually was. Any JSON value. Pair with expected_value so the reviewer can see the diff at a glance.",
    },
    related_issue_id: {
      type: ["string", "null"] as const,
      format: "uuid",
      description:
        "UUID of a prior issue this one references. Required for REGRESSION_OF_PRIOR_ISSUE; recommended for DUPLICATE_PAY_PERIOD.",
    },
  },
  required: ["category", "severity", "code", "description", "agent_explanation"],
  additionalProperties: false,
} as const;


// ============================================================================
// Proposed changes (discriminated union)
// ============================================================================

/**
 * Whitelist of `payroll_records` columns that a `payroll_record.update`
 * fix is allowed to touch. Mirrors the typed columns on the table
 * minus foreign keys, ids, raw_data, validation_errors, and the
 * audit-only timestamps. `validation_status` is included so a fix can
 * mark a row as resolved after correcting the offending field.
 *
 * Adding a column here also requires:
 *   1. The skill section that explains when proposing the field is OK.
 *   2. Coverage in `fix-appliers.ts` for the new column's coercion
 *      (numeric vs date vs text) before it lands in the DB.
 */
export const PAYROLL_RECORD_UPDATABLE_FIELDS = [
  "employee_id",
  "first_name",
  "last_name",
  "email",
  "pay_date",
  "gross_wages",
  "pretax_deferral_amount",
  "roth_amount",
  "employer_match",
  "loan_repayment",
  "employment_status_in_run",
  "validation_status",
] as const;

export type PayrollRecordUpdatableField = (typeof PAYROLL_RECORD_UPDATABLE_FIELDS)[number];

/**
 * Whitelist of `participants` columns that a `participant.update`
 * fix is allowed to touch. Source-system identifiers (employee_id,
 * participant_id) and the balance/audit columns are intentionally
 * excluded -- those drift only via re-import of a fresh census, not
 * via a one-off payroll-reconciliation fix.
 */
export const PARTICIPANT_UPDATABLE_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "employment_status",
  "eligibility_status",
  "current_deferral_rate",
  "roth_deferral_rate",
  "loan_balance",
] as const;

export type ParticipantUpdatableField = (typeof PARTICIPANT_UPDATABLE_FIELDS)[number];

/**
 * One field-level change in a `*.update` proposal. `from` is the
 * value the agent observed in the DB at proposal time; the applier
 * uses it for optimistic concurrency (`.eq(field, from)`), so if the
 * row drifts before the human approves, the fix lands as `failed`
 * rather than silently overwriting a newer value.
 *
 * `z.unknown().nullable()` is kept explicit even though `unknown`
 * already permits `null`; the redundant `.nullable()` documents the
 * intent for readers ("this field can be present and null") and
 * matches the JSON Schema mirror below.
 */
const changeValueSchema = z.object({
  from: z.unknown().nullable(),
  to: z.unknown().nullable(),
});

/**
 * Hand-mirrored JSON Schema for one `{ from, to }` pair. No `type`
 * on `from`/`to` -- they can be any JSON value. Both are required so
 * the applier always has both halves of the OCC pair.
 */
const changeValueJsonSchema = {
  type: "object" as const,
  properties: {
    from: {
      description:
        "Current DB value at proposal time. Used for optimistic concurrency at apply time. Any JSON value, including null.",
    },
    to: {
      description:
        "Proposed new value. Any JSON value, including null. Type should match the destination column.",
    },
  },
  required: ["from", "to"],
  additionalProperties: false,
} as const;

/**
 * Discriminated union of every mechanical mutation the reconciliation
 * agent is allowed to propose, keyed on `kind`. The applier dispatch
 * in `fix-appliers.ts` exhaustively switches on this same string so
 * adding a new variant here also requires a new handler there (the
 * compile-time exhaustiveness check is the safety net).
 *
 * Variants:
 *   - `payroll_record.update` -- correct one or more fields on a
 *     specific payroll row. Anchored to (run_id, row_number); the
 *     applier enforces OCC on every `from` value.
 *   - `participant.create_from_payroll` -- insert a brand-new
 *     `participants` row using the named payroll row's identity
 *     fields. Used for `EMPLOYEE_NOT_IN_CENSUS` only.
 *   - `participant.update` -- correct one or more fields on an
 *     existing `participants` row. Anchored to (plan_id, employee_id);
 *     applier enforces OCC on every `from` value.
 */
export const proposedChangesSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("payroll_record.update"),
    run_id: z.uuid(),
    row_number: z.number().int().positive(),
    changes: z
      .partialRecord(z.enum(PAYROLL_RECORD_UPDATABLE_FIELDS), changeValueSchema)
      .refine(
        (c) => Object.keys(c).length >= 1,
        { message: "changes must include at least one field" },
      ),
  }),
  z.object({
    kind: z.literal("participant.create_from_payroll"),
    plan_id: z.uuid(),
    run_id: z.uuid(),
    row_number: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("participant.update"),
    plan_id: z.uuid(),
    employee_id: z.string().min(1),
    changes: z
      .partialRecord(z.enum(PARTICIPANT_UPDATABLE_FIELDS), changeValueSchema)
      .refine(
        (c) => Object.keys(c).length >= 1,
        { message: "changes must include at least one field" },
      ),
  }),
]);

export type ProposedChanges = z.infer<typeof proposedChangesSchema>;

/**
 * JSON Schema mirror for the discriminated union. Uses `oneOf` so
 * Claude knows exactly one variant is allowed; each variant has
 * `kind` pinned via `const` so the model can't free-text the
 * discriminator.
 *
 * Field-set `properties` are built from the whitelist constants
 * above; if you add a field to a whitelist, the mirror updates here
 * automatically (no second list to keep in sync).
 */
export const proposedChangesJsonSchema = {
  oneOf: [
    {
      type: "object" as const,
      properties: {
        kind: {
          type: "string" as const,
          const: "payroll_record.update",
          description: "Discriminator for the payroll-row update variant.",
        },
        run_id: {
          type: "string" as const,
          format: "uuid",
          description: "UUID of the payroll_run this row lives in.",
        },
        row_number: {
          type: "integer" as const,
          minimum: 1,
          description: "1-indexed payroll record row to update.",
        },
        changes: {
          type: "object" as const,
          minProperties: 1,
          additionalProperties: false,
          properties: Object.fromEntries(
            PAYROLL_RECORD_UPDATABLE_FIELDS.map((f) => [f, changeValueJsonSchema]),
          ),
          description:
            "Object keyed by canonical payroll field. Each value is a { from, to } pair for optimistic concurrency.",
        },
      },
      required: ["kind", "run_id", "row_number", "changes"],
      additionalProperties: false,
    },
    {
      type: "object" as const,
      properties: {
        kind: {
          type: "string" as const,
          const: "participant.create_from_payroll",
          description:
            "Discriminator for inserting a new participants row sourced from a payroll row.",
        },
        plan_id: {
          type: "string" as const,
          format: "uuid",
          description: "UUID of the plan the new participant belongs to.",
        },
        run_id: {
          type: "string" as const,
          format: "uuid",
          description: "UUID of the payroll_run the source row lives in.",
        },
        row_number: {
          type: "integer" as const,
          minimum: 1,
          description: "1-indexed payroll record row to read identity fields from.",
        },
      },
      required: ["kind", "plan_id", "run_id", "row_number"],
      additionalProperties: false,
    },
    {
      type: "object" as const,
      properties: {
        kind: {
          type: "string" as const,
          const: "participant.update",
          description: "Discriminator for the participants-row update variant.",
        },
        plan_id: {
          type: "string" as const,
          format: "uuid",
          description: "UUID of the plan the participant belongs to.",
        },
        employee_id: {
          type: "string" as const,
          minLength: 1,
          description: "Source-system employee id of the participant to update.",
        },
        changes: {
          type: "object" as const,
          minProperties: 1,
          additionalProperties: false,
          properties: Object.fromEntries(
            PARTICIPANT_UPDATABLE_FIELDS.map((f) => [f, changeValueJsonSchema]),
          ),
          description:
            "Object keyed by canonical participant field. Each value is a { from, to } pair for optimistic concurrency.",
        },
      },
      required: ["kind", "plan_id", "employee_id", "changes"],
      additionalProperties: false,
    },
  ],
  description:
    "Exactly one of three mutation kinds. The kind field is the discriminator; pick the variant whose anchors (run_id+row_number or plan_id+employee_id) match the issue.",
} as const;


// ============================================================================
// Suggested fix input (optional inline payload)
// ============================================================================

/**
 * Zod schema for the optional inline `suggested_fix` payload on
 * `propose_reconciliation_issue`. When present, the tool handler
 * inserts a `suggested_fixes` row tied to the new issue in the same
 * call.
 *
 *   - `description` -- short human sentence the reviewer reads first
 *     ("Set pay_date to 2026-05-01.").
 *   - `proposed_changes` -- the discriminated mutation payload above.
 *   - `confidence` -- a [0,1] number. Used as a sort key in the UI;
 *     does NOT gate apply (humans decide).
 *   - `agent_reasoning` -- the why for the fix specifically (separate
 *     from the issue's `agent_explanation` because a single issue can
 *     have multiple plausible fixes; this paragraph defends THIS one).
 */
export const suggestedFixInputSchema = z.object({
  description: z.string().min(1).max(1000),
  proposed_changes: proposedChangesSchema,
  confidence: z.number().min(0).max(1),
  agent_reasoning: z.string().min(1).max(2000),
});

export type SuggestedFixInput = z.infer<typeof suggestedFixInputSchema>;

/**
 * Hand-mirrored JSON Schema for the suggested-fix payload. Embeds
 * `proposedChangesJsonSchema` directly under `proposed_changes` so
 * Claude sees the full discriminated-union spec inline.
 */
export const suggestedFixJsonSchema = {
  type: "object" as const,
  properties: {
    description: {
      type: "string" as const,
      minLength: 1,
      maxLength: 1000,
      description:
        "Short human sentence describing the fix (e.g. 'Set pay_date to 2026-05-01.').",
    },
    proposed_changes: proposedChangesJsonSchema,
    confidence: {
      type: "number" as const,
      minimum: 0,
      maximum: 1,
      description:
        "Self-assessed confidence in [0,1]. Sort key only; does not gate apply.",
    },
    agent_reasoning: {
      type: "string" as const,
      minLength: 1,
      maxLength: 2000,
      description:
        "Why THIS fix is the right correction for the issue. Separate from the issue's agent_explanation.",
    },
  },
  required: ["description", "proposed_changes", "confidence", "agent_reasoning"],
  additionalProperties: false,
} as const;


// ============================================================================
// Tolerances and expected-amount helpers
// ============================================================================

/**
 * Numeric tolerances the agent must respect before flagging a diff.
 *
 *   - `MONEY_CENTS` -- dollar tolerance for contribution math. Half a
 *     cent absorbs rounding noise from rate*gross arithmetic without
 *     hiding real off-by-a-buck errors.
 *   - `RATE_PCT` -- rate decimal tolerance (5 basis points). Census
 *     deferral rates are stored as `numeric(5,4)` (0.0500 = 5%); this
 *     covers the rounding gap between 0.0499 and 0.0500.
 *   - `YTD_LIMIT_2026` -- IRS 401(k) elective-deferral limit for
 *     calendar 2026. Used by the YTD_LIMIT_EXCEEDED detector. Bump
 *     this value (and the variable name) at the start of each new
 *     plan year.
 */
export const RECONCILIATION_TOLERANCES = {
  MONEY_CENTS: 0.5,
  RATE_PCT: 0.0005,
  YTD_LIMIT_2026: 23500,
} as const;

/**
 * Expected employee deferral dollars for a given rate and gross
 * wages. Returns a value rounded to two decimals so it can be
 * compared against the payroll record's `numeric(12,2)` column with
 * the `MONEY_CENTS` tolerance.
 *
 * Callers must compare with `Math.abs(expected - actual) <=
 * RECONCILIATION_TOLERANCES.MONEY_CENTS` -- a strict equality check
 * would re-introduce the rounding-noise false positives the
 * tolerance exists to suppress.
 *
 * `rate` is the decimal rate (0.05 = 5%), not the percent. `gross`
 * is dollars. Negative or NaN inputs are the caller's problem; this
 * function is a pure arithmetic helper.
 */
export function expectedDeferralAmount(rate: number, gross: number): number {
  return Math.round(rate * gross * 100) / 100;
}

// Two-tier match parser. Captures both match percentages and both
// deferral thresholds so e.g. "75% of first 4%, 25% of next 2%"
// would still compute correctly if a future plan needs it.
//
// Group 1: tier-1 match percent (e.g. "100")
// Group 2: tier-1 deferral threshold percent (e.g. "3")
// Group 3: tier-2 match percent (e.g. "50")
// Group 4: tier-2 deferral threshold percent (e.g. "2")
//
// Separator between the two tiers tolerates: comma, semicolon,
// plus-sign, the words "plus" / "and" / "then" (any combination),
// and an optional "of <word>" interjection (e.g. "of compensation")
// between the tier-1 threshold percent and the connector.
const TWO_TIER_MATCH_FORMULA_PATTERN =
  /(\d+(?:\.\d+)?)\s*%\s*(?:match\s+)?(?:of|on)\s+(?:the\s+)?first\s+(\d+(?:\.\d+)?)\s*%(?:\s+of\s+\w+)?\s*(?:[,;+]\s*)?(?:plus\s+|and\s+|then\s+)?(\d+(?:\.\d+)?)\s*%\s*(?:match\s+)?(?:of|on)\s+(?:the\s+)?next\s+(\d+(?:\.\d+)?)\s*%/i;

/**
 * Pure parser probe for the plan match formula. Used by the runner to
 * warn operators when employer-match issue coverage is reduced before
 * any per-record math is attempted.
 */
export function canParseEmployerMatchFormula(
  matchFormulaText: string | null,
): boolean {
  if (!matchFormulaText) return false;
  return TWO_TIER_MATCH_FORMULA_PATTERN.test(matchFormulaText);
}

/**
 * Expected employer-match dollars for a participant deferring at a
 * given rate on the given gross wages, under the plan's match
 * formula.
 *
 * Formula parsing is intentionally tiny -- the MVP only recognises
 * the Acme "100% of first 3%, 50% of next 2%" two-tier shape and its
 * common rewrites. The separator between the two tiers is
 * deliberately liberal because the extraction agent emits at least
 * four observed phrasings (canonical short form `+`, prose form
 * `plus`, semicolon form, and the document-quoting form with `of
 * compensation,` interposed before the connector). Anything else
 * returns `null`, which the runner injects verbatim as
 * `record.expected_employer_match`; the agent must interpret null
 * as "cannot derive deterministically" and skip
 * EMPLOYER_MATCH_WRONG_AMOUNT for that record.
 *
 * Phrasings the regex below matches:
 *   - "100% of first 3%, 50% of next 2%"
 *   - "100% of the first 3%; 50% of the next 2%"
 *   - "100% on first 3%, 50% on next 2%"
 *   - "100% of first 3% + 50% of next 2%"
 *   - "100% of first 3% of compensation, plus 50% of next 2%"
 *   - "100% match of first 3% and 50% match of next 2%"
 *
 * Expanding to other shapes (tiered with three brackets, flat
 * percent, dollar-cap match) should live here so the agent and the
 * route layer keep computing the same expected value.
 *
 * Return value (when non-null) is dollars, rounded to two decimals.
 * Compare against actual with `MONEY_CENTS` tolerance, same as
 * `expectedDeferralAmount`.
 */
export function expectedEmployerMatch(opts: {
  matchFormulaText: string | null;
  rate: number;
  gross: number;
}): number | null {
  const { matchFormulaText, rate, gross } = opts;
  if (!matchFormulaText) return null;
  if (!Number.isFinite(rate) || !Number.isFinite(gross)) return null;

  const m = matchFormulaText.match(TWO_TIER_MATCH_FORMULA_PATTERN);
  if (!m) return null;

  const tier1MatchPct = Number(m[1]) / 100;
  const tier1Threshold = Number(m[2]) / 100;
  const tier2MatchPct = Number(m[3]) / 100;
  const tier2Threshold = Number(m[4]) / 100;

  if (
    !Number.isFinite(tier1MatchPct) ||
    !Number.isFinite(tier1Threshold) ||
    !Number.isFinite(tier2MatchPct) ||
    !Number.isFinite(tier2Threshold)
  ) {
    return null;
  }

  const tier1Deferred = Math.min(rate, tier1Threshold);
  const tier2Deferred = Math.min(Math.max(rate - tier1Threshold, 0), tier2Threshold);
  const matchRate = tier1Deferred * tier1MatchPct + tier2Deferred * tier2MatchPct;

  return Math.round(matchRate * gross * 100) / 100;
}
