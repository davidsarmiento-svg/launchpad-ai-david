import "server-only";

import { parse as parseCsv } from "csv-parse/sync";

import {
  applyMappingToRow,
  type PayrollStorageMapping,
} from "@/lib/server/payroll-mapping";
import type { PayrollRecordInput } from "@/lib/server/payroll-runs";

/**
 * Shared helpers used by both the /map route (auto-apply path) and
 * the approve route (ingest-on-approve path) to turn raw CSV bytes
 * plus an approved mapping into the typed `payroll_records` rows the
 * DAL expects.
 *
 * Kept thin on purpose: parsing money / dates here is "best effort
 * normalization" -- any value that doesn't parse becomes null and
 * the Payroll Reconciliation Agent (later phase) flags the row.
 * That gives the ingest path a single clean failure mode (DB write
 * fails on a real DB error, never on a malformed cell).
 *
 * `server-only` because it transitively pulls `payroll-runs` (and
 * its supabase service-role client) through the `PayrollRecordInput`
 * type import. Keeping the marker here means a Client Component that
 * accidentally imports this file fails its build.
 */

/**
 * Parse a dollars-and-cents string into a JS number, returning null
 * when the value is blank or unparseable.
 *
 * Accepts the formats payroll exporters produce in the wild:
 *   - "$1,234.56" -> 1234.56
 *   - "1234.56"   -> 1234.56
 *   - "-12.34"    -> -12.34
 *   - "(12.34)"   -> -12.34  (accounting-style negatives)
 *   - " "         -> null
 *   - "N/A"       -> null
 *
 * Intentionally does NOT enforce a precision cap; supabase-js will
 * round to `numeric(12,2)` on insert. If we wanted to surface
 * precision loss we'd round here and compare -- not worth the
 * complexity for the demo.
 */
export function parseMoney(s: string | null | undefined): number | null {
  if (s == null) return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;

  let normalized = trimmed.replace(/[$,]/g, "").trim();
  let negative = false;
  if (/^\(.*\)$/.test(normalized)) {
    negative = true;
    normalized = normalized.slice(1, -1);
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse a date-ish string into ISO `YYYY-MM-DD`, returning null on
 * anything we don't recognize.
 *
 * Recognized forms:
 *   - Already ISO: "2026-04-15" -> "2026-04-15"
 *   - US-style: "4/15/26", "04/15/2026" -> "2026-04-15"
 *     (Two-digit years are assumed 20xx -- payroll CSVs predating
 *      2000 are not in our scope.)
 *
 * Anything else returns null. The reconciliation agent surfaces
 * unparseable dates as row-level issues rather than blocking ingest.
 */
export function parseIsoDate(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const month = m[1].padStart(2, "0");
    const day = m[2].padStart(2, "0");
    const yearRaw = Number(m[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

/**
 * Apply the approved storage mapping to one parsed CSV row and
 * coerce typed fields. The returned shape matches
 * `payrollRecordInputSchema` so the caller can pass it straight into
 * `applyMappingToRun`.
 *
 * `row_number` is 1-indexed (header is row 0, the first data line
 * is row 1) -- matches what reviewers see in spreadsheets.
 */
export function buildIngestRecord(
  rawRow: Record<string, string>,
  storageMapping: PayrollStorageMapping,
  rowNumber: number,
): PayrollRecordInput {
  const { raw, mapped } = applyMappingToRow(rawRow, storageMapping);
  return {
    row_number: rowNumber,
    raw_data: raw,
    employee_id: mapped.employee_id ?? null,
    first_name: mapped.first_name ?? null,
    last_name: mapped.last_name ?? null,
    email: mapped.email ?? null,
    pay_date: parseIsoDate(mapped.pay_date),
    gross_wages: parseMoney(mapped.gross_wages),
    pretax_deferral_amount: parseMoney(mapped.pretax_deferral_amount),
    roth_amount: parseMoney(mapped.roth_amount),
    employer_match: parseMoney(mapped.employer_match),
    loan_repayment: parseMoney(mapped.loan_repayment),
    employment_status_in_run: mapped.employment_status_in_run ?? null,
  };
}

export type ParsedCsv = {
  header: string[];
  records: Array<Record<string, string>>;
};

/**
 * Decode CSV bytes (UTF-8) and parse into header + record-array form
 * suitable for both the auto-apply path and the agent-prompt path.
 *
 * Trims cell whitespace and skips empty lines because payroll
 * exporters routinely leave trailing blank lines. The header order
 * matches the source file's column order, taken from the first
 * record's key insertion order.
 *
 * Throws plain `Error` on parse failure so callers can translate to
 * HTTP 400 -- there's no `DataLayerError` analog for "client gave us
 * bad CSV".
 */
export function parseCsvHeaderAndRows(bytes: Uint8Array): ParsedCsv {
  const csvText = new TextDecoder("utf-8").decode(bytes);
  const records = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;
  const header = records.length > 0 ? Object.keys(records[0]) : [];
  return { header, records };
}
