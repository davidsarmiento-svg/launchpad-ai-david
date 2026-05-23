-- ============================================================================
-- Phase 9.1 iteration -- add related_issue_id to reconciliation_issues
-- ============================================================================
--
-- Purpose: the shared module's reconciliationIssueInputSchema includes
-- related_issue_id (for DUPLICATE_PAY_PERIOD references and
-- REGRESSION_OF_PRIOR_ISSUE links between current and prior issues).
-- The Wave 1 migration omitted the column, so the field was silently
-- dropped on insert. This migration backfills the column and an index
-- so the regression-link UI can render and audits stay coherent.
--
-- The FK uses ON DELETE SET NULL so deleting an older issue doesn't
-- cascade-delete the newer issues that reference it.
-- ============================================================================

alter table reconciliation_issues
    add column related_issue_id uuid
        references reconciliation_issues(id) on delete set null;

create index reconciliation_issues_related_issue_idx
    on reconciliation_issues (related_issue_id)
    where related_issue_id is not null;
