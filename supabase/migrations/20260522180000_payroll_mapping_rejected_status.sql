-- ============================================================================
-- Add 'rejected' to payroll_mappings.status CHECK so the Payroll Mapping
-- Agent's pending proposals can be rejected with a reason without overloading
-- the 'superseded' semantic (which means "was approved, then replaced by a
-- newer approved version").
--
-- Lifecycle after this migration: pending -> approved | rejected; approved
-- can later become superseded when a new mapping is approved.
-- ============================================================================

alter table payroll_mappings
    drop constraint payroll_mappings_status_check;

alter table payroll_mappings
    add constraint payroll_mappings_status_check
    check (status in ('pending', 'approved', 'superseded', 'rejected'));
