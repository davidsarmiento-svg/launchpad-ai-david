-- ============================================================================
-- Broaden reconciliation_issues so an issue can be scoped to a plan (no run)
-- as well as to a specific payroll run. Phase 9.1 introduces plan-scoped
-- observations (e.g. cross-run regressions, participant-level findings
-- surfaced outside any single payroll cycle) that have no payroll_run_id.
--
-- Changes:
--   1. Relax payroll_run_id to nullable (was NOT NULL).
--   2. Add plan_id uuid -> plans(id) on delete cascade.
--   3. Enforce at least one scope via a CHECK constraint
--      (payroll_run_id IS NOT NULL OR plan_id IS NOT NULL).
--   4. Add (plan_id, status) index to keep the plan-scoped reads fast,
--      mirroring the existing (payroll_run_id) / (status) indexes from
--      20260522130000_init_domain_schema.sql.
--
-- Existing rows keep their non-null payroll_run_id and a null plan_id;
-- they still satisfy the new CHECK. No data backfill is required.
-- ============================================================================

alter table reconciliation_issues
    alter column payroll_run_id drop not null;

alter table reconciliation_issues
    add column plan_id uuid references plans(id) on delete cascade;

alter table reconciliation_issues
    add constraint reconciliation_issues_run_or_plan_chk
    check (payroll_run_id is not null or plan_id is not null);

create index reconciliation_issues_plan_status_idx
    on reconciliation_issues (plan_id, status);
