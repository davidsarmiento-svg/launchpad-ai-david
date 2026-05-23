import "server-only";

import { z } from "zod";

import { DataLayerError } from "@/lib/server/errors";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * The audit log is the spine of LaunchPad AI. Every meaningful change
 * --- whether a user click, an agent proposal, or a system job ---
 * must write a row here. The Zod schema below enforces that:
 *
 *   - `actor_type`, `actor_name`, and `action` are always present
 *     (matches the DB NOT NULL columns + CHECK constraint).
 *   - The optional context columns (`entity_*`, `payroll_run_id`,
 *     `employee_id`, `field_name`, `before_value`, `after_value`,
 *     `reason`, `status`) have explicit types, so a typo at a call
 *     site fails at compile or parse time instead of being silently
 *     dropped on the wire.
 *
 * The function returns the inserted id + timestamp so the caller can
 * thread the audit-log id into agent responses (the deployment plan
 * calls this "include audit-log IDs in every agent response").
 */
export const auditLogInputSchema = z.object({
  actor_type: z.enum(["user", "agent", "system"]),
  actor_name: z.string().min(1, "actor_name is required"),
  action: z.string().min(1, "action is required"),
  entity_type: z.string().min(1).optional(),
  entity_id: z.string().min(1).optional(),
  payroll_run_id: z.string().min(1).optional(),
  employee_id: z.string().min(1).optional(),
  field_name: z.string().min(1).optional(),
  before_value: z.unknown().optional(),
  after_value: z.unknown().optional(),
  reason: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
});

export type AuditLogInput = z.infer<typeof auditLogInputSchema>;

export type AuditLogRow = {
  id: string;
  timestamp: string;
  actor_type: "user" | "agent" | "system";
  actor_name: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  payroll_run_id: string | null;
  employee_id: string | null;
  field_name: string | null;
  before_value: unknown;
  after_value: unknown;
  reason: string | null;
  status: string | null;
};

/**
 * Append a single row to `audit_logs`. Throws `ZodError` on bad input
 * and `DataLayerError` on Supabase failure. Callers should not swallow
 * either --- silently failing audits is exactly the failure mode the
 * audit log exists to prevent.
 */
export async function writeAuditLog(
  input: AuditLogInput,
): Promise<{ id: string; timestamp: string }> {
  const parsed = auditLogInputSchema.parse(input);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .insert(parsed)
    .select("id, timestamp")
    .single();

  if (error || !data) {
    throw new DataLayerError({
      module: "audit-log",
      operation: "writeAuditLog",
      message: error?.message ?? "insert returned no row",
      cause: error,
    });
  }

  return { id: data.id, timestamp: data.timestamp };
}

/**
 * Filters for `listAuditLogs`. All fields are optional; the query is
 * always ordered by timestamp desc and capped at `limit` (default 100,
 * max 500) so a buggy caller cannot pull the entire ledger.
 */
export const auditLogQuerySchema = z.object({
  entity_type: z.string().min(1).optional(),
  entity_id: z.string().min(1).optional(),
  payroll_run_id: z.string().min(1).optional(),
  actor_type: z.enum(["user", "agent", "system"]).optional(),
  actor_name: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export type AuditLogQuery = z.input<typeof auditLogQuerySchema>;

/**
 * Read recent audit-log rows for the Audit Trail UI. Returns most
 * recent first.
 */
export async function listAuditLogs(
  query: AuditLogQuery = {},
): Promise<AuditLogRow[]> {
  const parsed = auditLogQuerySchema.parse(query);

  const supabase = getSupabaseServiceRoleClient();
  let q = supabase
    .from("audit_logs")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(parsed.limit);

  if (parsed.entity_type) q = q.eq("entity_type", parsed.entity_type);
  if (parsed.entity_id) q = q.eq("entity_id", parsed.entity_id);
  if (parsed.payroll_run_id) q = q.eq("payroll_run_id", parsed.payroll_run_id);
  if (parsed.actor_type) q = q.eq("actor_type", parsed.actor_type);
  if (parsed.actor_name) q = q.eq("actor_name", parsed.actor_name);
  if (parsed.since) q = q.gte("timestamp", parsed.since);

  const { data, error } = await q;
  if (error) {
    throw new DataLayerError({
      module: "audit-log",
      operation: "listAuditLogs",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as AuditLogRow[];
}

/**
 * Scope filters for `listAuditLogsForPlan`. The caller supplies the
 * related entity ids the page already loaded (runs, files, issues,
 * fixes) so we can OR-match every audit row tied to this plan without
 * a plan_id column on `audit_logs`.
 */
export const listAuditLogsForPlanInputSchema = z.object({
  plan_id: z.string().uuid(),
  payroll_run_ids: z.array(z.string().uuid()).default([]),
  file_ids: z.array(z.string().uuid()).default([]),
  reconciliation_issue_ids: z.array(z.string().uuid()).default([]),
  suggested_fix_ids: z.array(z.string().uuid()).default([]),
  limit: z.number().int().positive().max(500).default(500),
});

export type ListAuditLogsForPlanInput = z.input<
  typeof listAuditLogsForPlanInputSchema
>;

function quotedIn(values: string[]): string {
  return values.map((id) => `"${id}"`).join(",");
}

/**
 * Read audit-log rows scoped to a plan. Returns oldest-first so the
 * Audit Trail UI reads as a chronological ledger. Caps at `limit`
 * (default/max 500) by taking the most recent N rows, then reversing.
 */
export async function listAuditLogsForPlan(
  input: ListAuditLogsForPlanInput,
): Promise<AuditLogRow[]> {
  const parsed = listAuditLogsForPlanInputSchema.parse(input);

  const orParts: string[] = [
    `and(entity_type.eq.plan,entity_id.eq.${parsed.plan_id})`,
  ];

  if (parsed.payroll_run_ids.length > 0) {
    orParts.push(`payroll_run_id.in.(${quotedIn(parsed.payroll_run_ids)})`);
  }
  if (parsed.file_ids.length > 0) {
    orParts.push(
      `and(entity_type.eq.file,entity_id.in.(${quotedIn(parsed.file_ids)}))`,
    );
  }
  if (parsed.reconciliation_issue_ids.length > 0) {
    orParts.push(
      `and(entity_type.eq.reconciliation_issue,entity_id.in.(${quotedIn(parsed.reconciliation_issue_ids)}))`,
    );
  }
  if (parsed.suggested_fix_ids.length > 0) {
    orParts.push(
      `and(entity_type.eq.suggested_fix,entity_id.in.(${quotedIn(parsed.suggested_fix_ids)}))`,
    );
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .or(orParts.join(","))
    .order("timestamp", { ascending: false })
    .limit(parsed.limit);

  if (error) {
    throw new DataLayerError({
      module: "audit-log",
      operation: "listAuditLogsForPlan",
      message: error.message,
      cause: error,
    });
  }

  const rows = (data ?? []) as AuditLogRow[];
  rows.reverse();
  return rows;
}
