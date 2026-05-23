import { z } from "zod";

/**
 * Schema and helpers for payroll CSV column -> canonical field mapping
 * proposals produced by the Payroll Mapping Agent (and edited by a
 * human approver).
 *
 * Two directions matter here and they are NOT the same shape:
 *
 *   1. AGENT-FACING / PROPOSAL shape -- canonical-keyed.
 *      `{ employee_id: "Emp ID", first_name: "First", ... }`
 *      One key per canonical field, value is the CSV header (or null
 *      when no column reasonably maps). This is what the model emits
 *      via the `propose_payroll_mapping` tool and what the human-edit
 *      form binds to.
 *
 *   2. STORAGE shape -- CSV-column-keyed.
 *      `{ "Emp ID": "employee_id", "First": "first_name", ... }`
 *      Persisted in `payroll_mappings.mapping`. Indexed by the CSV
 *      header so the ingest can walk a parsed row once and look up
 *      each column's canonical destination in O(1).
 *
 * `toStorageMapping` / `fromStorageMapping` round-trip between them.
 *
 * No `server-only` here on purpose: the schema is pure data + Zod, so
 * the human-approval form (a Client Component) can import the same
 * shape, the same Zod validator, and the same UI hints map. One source
 * of truth for the agent, the route handlers, and the UI.
 */

/**
 * The 11 canonical fields the payroll ingest cares about. These are a
 * 1:1 mirror of the typed columns on `payroll_records`; if you rename
 * one of these, change the migration in the same commit or the ingest
 * write will fail.
 */
export const CANONICAL_PAYROLL_FIELDS = [
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
] as const;

export type CanonicalPayrollField = (typeof CANONICAL_PAYROLL_FIELDS)[number];

/**
 * Zod schema for an agent-emitted (or human-edited) mapping proposal.
 *
 * Every canonical field is REQUIRED in the object, but every value is
 * `.nullable()` (not `.optional()`). The agent is instructed to use
 * `null` when no CSV column reasonably maps, so the approver sees
 * "agent looked, found nothing" rather than "agent forgot the key".
 *
 * Non-null values are CSV column header strings copied verbatim from
 * the uploaded file's header row.
 */
export const payrollMappingProposalSchema = z.object({
  employee_id: z.string().min(1).nullable(),
  first_name: z.string().min(1).nullable(),
  last_name: z.string().min(1).nullable(),
  email: z.string().min(1).nullable(),
  pay_date: z.string().min(1).nullable(),
  gross_wages: z.string().min(1).nullable(),
  pretax_deferral_amount: z.string().min(1).nullable(),
  roth_amount: z.string().min(1).nullable(),
  employer_match: z.string().min(1).nullable(),
  loan_repayment: z.string().min(1).nullable(),
  employment_status_in_run: z.string().min(1).nullable(),
});

export type PayrollMappingProposal = z.infer<typeof payrollMappingProposalSchema>;

/**
 * JSON Schema fragment for the `propose_payroll_mapping` tool's
 * `input_schema` on the Anthropic tools API. Hand-rolled rather than
 * pulled from `zod-to-json-schema`, same reasoning as
 * `extractedPlanFieldsJsonSchema`: small surface area, kept inline
 * next to the Zod schema so renames show up in one diff.
 *
 * Note: every property uses `type: ["string", "null"]` and every key
 * is in `required`. `null` is a legal value, omission is not.
 */
export const payrollMappingProposalJsonSchema = {
  type: "object" as const,
  properties: {
    employee_id: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the employee identifier, e.g. 'Emp ID'. null only if no column reasonably maps.",
    },
    first_name: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the employee's first/given name, e.g. 'First'. null if absent.",
    },
    last_name: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the employee's last/family name, e.g. 'Last'. null if absent.",
    },
    email: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the work email address, e.g. 'Work Email'. null if absent.",
    },
    pay_date: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the pay date this row applies to, e.g. 'Pay Date'. null if absent.",
    },
    gross_wages: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for gross wages (pre-deduction earnings), e.g. 'Gross Wages'. null if absent.",
    },
    pretax_deferral_amount: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the employee pre-tax 401(k) deferral dollar amount, e.g. '401k Pre Tax'. null if absent.",
    },
    roth_amount: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the employee Roth deferral dollar amount, e.g. 'Roth Amount'. null if absent.",
    },
    employer_match: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the employer match dollar amount, e.g. 'ER Match'. null if absent.",
    },
    loan_repayment: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the participant loan repayment dollar amount, e.g. 'Loan Repay'. null if absent.",
    },
    employment_status_in_run: {
      type: ["string", "null"] as const,
      description:
        "CSV column header for the employment status as of this pay period, e.g. 'Status'. null if absent.",
    },
  },
  required: [...CANONICAL_PAYROLL_FIELDS],
  additionalProperties: false,
} as const;

/**
 * UI rendering hint kinds for the mapping-approval form. The proposal
 * is always "which CSV header maps here?", which is a free-text input,
 * so today there is exactly one kind. Kept as a union for symmetry
 * with `ExtractedPlanFieldUiKind` -- when (if) we add a dropdown of
 * known headers, that variant lands here.
 */
export type PayrollMappingFieldUiKind = "text";

export type PayrollMappingFieldUiHint = {
  kind: PayrollMappingFieldUiKind;
  /** Always true for mapping fields -- the agent may legitimately
   *  decide no CSV column maps, and the approver may clear a value. */
  nullable: true;
  hint?: string;
  label: string;
};

/**
 * UI hints for the human-approval form. Keep in sync with
 * `payrollMappingProposalSchema` -- if you add a canonical field
 * above, add a row here or the form will fall back to a label-less
 * raw input.
 */
export const payrollMappingFieldUiHints: Record<
  CanonicalPayrollField,
  PayrollMappingFieldUiHint
> = {
  employee_id: {
    kind: "text",
    nullable: true,
    label: "Employee ID",
    hint: "CSV column for the employee identifier (e.g. 'Emp ID')",
  },
  first_name: {
    kind: "text",
    nullable: true,
    label: "First name",
    hint: "CSV column for the employee's first name (e.g. 'First')",
  },
  last_name: {
    kind: "text",
    nullable: true,
    label: "Last name",
    hint: "CSV column for the employee's last name (e.g. 'Last')",
  },
  email: {
    kind: "text",
    nullable: true,
    label: "Email",
    hint: "CSV column for the work email (e.g. 'Work Email')",
  },
  pay_date: {
    kind: "text",
    nullable: true,
    label: "Pay date",
    hint: "CSV column for the pay date (e.g. 'Pay Date')",
  },
  gross_wages: {
    kind: "text",
    nullable: true,
    label: "Gross wages",
    hint: "CSV column for gross earnings (e.g. 'Gross Wages')",
  },
  pretax_deferral_amount: {
    kind: "text",
    nullable: true,
    label: "Pre-tax deferral amount",
    hint: "CSV column for pre-tax 401(k) deferral $ (e.g. '401k Pre Tax')",
  },
  roth_amount: {
    kind: "text",
    nullable: true,
    label: "Roth amount",
    hint: "CSV column for Roth deferral $ (e.g. 'Roth Amount')",
  },
  employer_match: {
    kind: "text",
    nullable: true,
    label: "Employer match",
    hint: "CSV column for employer match $ (e.g. 'ER Match')",
  },
  loan_repayment: {
    kind: "text",
    nullable: true,
    label: "Loan repayment",
    hint: "CSV column for participant loan repayment $ (e.g. 'Loan Repay')",
  },
  employment_status_in_run: {
    kind: "text",
    nullable: true,
    label: "Employment status",
    hint: "CSV column for employment status this period (e.g. 'Status')",
  },
};

/**
 * Storage-shape mapping persisted in `payroll_mappings.mapping`.
 *
 * Keys are CSV column headers as they appear in the source file.
 * Values are canonical field names. This direction lets the ingest
 * walk a parsed row's keys once and do an O(1) lookup per column.
 */
export type PayrollStorageMapping = Record<string, CanonicalPayrollField>;

/**
 * Convert an agent-facing proposal into the CSV-keyed storage shape.
 *
 * Drops keys whose value is null or empty after trimming. If two
 * canonical fields somehow point at the same CSV column (shouldn't
 * happen but we don't want to throw at the data-layer boundary), the
 * LAST canonical field in `CANONICAL_PAYROLL_FIELDS` order wins. The
 * approve route is responsible for surfacing collisions before they
 * reach this function; this function stays total.
 */
export function toStorageMapping(
  proposal: PayrollMappingProposal,
): PayrollStorageMapping {
  const storage: PayrollStorageMapping = {};
  for (const field of CANONICAL_PAYROLL_FIELDS) {
    const col = proposal[field];
    if (col !== null && col.trim().length > 0) {
      storage[col] = field;
    }
  }
  return storage;
}

/**
 * Inverse of `toStorageMapping`. Returns a complete proposal with all
 * 11 keys present (null where the storage mapping has no entry for
 * that canonical field). The result is validated by
 * `payrollMappingProposalSchema` before being returned, so any drift
 * in the storage shape (e.g. unknown canonical field names) fails
 * loudly instead of producing a half-valid proposal.
 */
export function fromStorageMapping(
  storage: PayrollStorageMapping,
): PayrollMappingProposal {
  const reverse: Partial<Record<CanonicalPayrollField, string>> = {};
  for (const [csvCol, canonical] of Object.entries(storage)) {
    reverse[canonical] = csvCol;
  }

  const proposal: Record<CanonicalPayrollField, string | null> = {
    employee_id: reverse.employee_id ?? null,
    first_name: reverse.first_name ?? null,
    last_name: reverse.last_name ?? null,
    email: reverse.email ?? null,
    pay_date: reverse.pay_date ?? null,
    gross_wages: reverse.gross_wages ?? null,
    pretax_deferral_amount: reverse.pretax_deferral_amount ?? null,
    roth_amount: reverse.roth_amount ?? null,
    employer_match: reverse.employer_match ?? null,
    loan_repayment: reverse.loan_repayment ?? null,
    employment_status_in_run: reverse.employment_status_in_run ?? null,
  };

  return payrollMappingProposalSchema.parse(proposal);
}

/**
 * Returns true iff every CSV column referenced by the storage mapping
 * appears in `header`. Used by the apply-mapping route to decide
 * whether a previously-approved mapping can be auto-applied to a new
 * payroll upload (same provider, same column layout) or whether the
 * mapping agent has to run again.
 *
 * Case-sensitive exact match -- the demo CSVs come from a small set
 * of payroll providers and their headers are stable. If two uploads
 * differ only in casing we want the agent to look at it, not silently
 * "succeed" and feed garbage downstream.
 */
export function csvHeaderCoversMapping(
  header: readonly string[],
  storage: PayrollStorageMapping,
): boolean {
  const headerSet = new Set(header);
  for (const csvCol of Object.keys(storage)) {
    if (!headerSet.has(csvCol)) return false;
  }
  return true;
}

/**
 * Apply a storage mapping to a single parsed CSV row.
 *
 * Returns both:
 *   - `raw`: the original row preserved verbatim. The caller writes
 *     this into `payroll_records.raw_data` so the source-of-truth
 *     copy survives even if the mapping is wrong.
 *   - `mapped`: a partial canonical-keyed object holding only the
 *     fields whose CSV column exists in `row`. Values are strings;
 *     this function intentionally does NOT coerce to number / date /
 *     boolean. Type coercion and validation live in the ingest step
 *     so the mapping module stays a pure structural transform.
 */
export function applyMappingToRow(
  row: Record<string, string>,
  storage: PayrollStorageMapping,
): {
  raw: Record<string, string>;
  mapped: Partial<Record<CanonicalPayrollField, string>>;
} {
  const mapped: Partial<Record<CanonicalPayrollField, string>> = {};
  for (const [csvCol, canonical] of Object.entries(storage)) {
    if (Object.prototype.hasOwnProperty.call(row, csvCol)) {
      mapped[canonical] = row[csvCol];
    }
  }
  return { raw: row, mapped };
}
