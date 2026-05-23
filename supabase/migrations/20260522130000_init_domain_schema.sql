-- ============================================================================
-- Domain schema for LaunchPad AI onboarding.
--
-- Design notes:
--   * UUIDs as primary keys everywhere; source-system identifiers
--     (employee_id, participant_id) are kept as separate text columns so
--     re-imports map to the same internal rows.
--   * Money is numeric(12,2); deferral rates are numeric(5,4) where
--     0.0500 = 5%. No floating-point storage.
--   * Lifecycle / category / severity columns use TEXT + CHECK so allowed
--     values can be evolved with a single migration line.
--   * RLS is enabled on every table. Service role bypasses RLS, so server
--     code in lib/server/* keeps working. Anon access stays locked out
--     until an explicit policy is added.
--   * Files use sha256 checksums so re-uploading the same file within a
--     plan is idempotent.
--   * No plans rows are seeded - the app creates the Acme plan when the
--     plan PDF is first uploaded (matches the real onboarding flow).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Helper: bump updated_at on UPDATE.
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- plans: one row per onboarding (Acme Robotics for this demo).
-- ---------------------------------------------------------------------------
create table plans (
    id                  uuid primary key default gen_random_uuid(),
    employer_name       text not null,
    plan_name           text,
    plan_year           int,
    extracted_fields    jsonb not null default '{}'::jsonb,
    extraction_status   text not null default 'pending'
        check (extraction_status in ('pending', 'in_review', 'approved', 'failed')),
    extracted_at        timestamptz,
    status              text not null default 'draft'
        check (status in ('draft', 'in_review', 'active', 'archived')),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index plans_status_idx on plans (status);

create trigger plans_set_updated_at
    before update on plans
    for each row execute function set_updated_at();

comment on table plans is
    'One row per onboarding. Created when the user first uploads a plan PDF; extracted_fields holds the Plan Extraction Agent output pending human review.';


-- ---------------------------------------------------------------------------
-- files: metadata for every uploaded artifact (PDF, census CSV, payroll CSV).
-- ---------------------------------------------------------------------------
create table files (
    id                  uuid primary key default gen_random_uuid(),
    plan_id             uuid references plans(id) on delete cascade,
    kind                text not null
        check (kind in ('plan_pdf', 'participant_census', 'payroll_run', 'other')),
    filename            text not null,
    mime_type           text,
    size_bytes          bigint,
    checksum_sha256     text not null,
    storage_path        text,
    uploaded_by         text,
    uploaded_at         timestamptz not null default now(),
    unique (plan_id, checksum_sha256)
);

create index files_plan_kind_idx on files (plan_id, kind);

comment on table files is
    'Upload manifest. (plan_id, checksum_sha256) is unique so re-uploads of the same file inside a plan are idempotent.';


-- ---------------------------------------------------------------------------
-- participants: normalized roster from the participant census CSV.
-- ---------------------------------------------------------------------------
create table participants (
    id                      uuid primary key default gen_random_uuid(),
    plan_id                 uuid not null references plans(id) on delete cascade,
    source_file_id          uuid references files(id) on delete set null,

    -- Source-system identifiers (kept verbatim from the CSV)
    participant_id          text not null,
    employee_id             text not null,

    -- Identity
    first_name              text not null,
    last_name               text not null,
    email                   text,
    date_of_birth           date,
    hire_date               date,

    -- Plan state at time of import
    eligibility_status      text
        check (eligibility_status in (
            'Eligible',
            'Ineligible - Terminated',
            'Pending - In Service Period',
            'Ineligible - Other'
        )),
    current_deferral_rate   numeric(5,4) not null default 0,
    roth_deferral_rate      numeric(5,4) not null default 0,
    account_balance         numeric(12,2) not null default 0,
    loan_balance            numeric(12,2) not null default 0,
    employment_status       text
        check (employment_status in ('Active', 'Terminated', 'On Leave', 'Unknown')),
    beneficiary_on_file     boolean not null default false,

    imported_at             timestamptz not null default now(),
    updated_at              timestamptz not null default now(),

    unique (plan_id, employee_id),
    unique (plan_id, participant_id)
);

create index participants_employee_idx on participants (plan_id, employee_id);
create index participants_employment_status_idx on participants (employment_status);

create trigger participants_set_updated_at
    before update on participants
    for each row execute function set_updated_at();

comment on table participants is
    'Normalized roster. (plan_id, employee_id) is the natural key for re-imports.';
comment on column participants.current_deferral_rate is
    'Pre-tax 401(k) deferral as a decimal (0.0500 = 5%).';
comment on column participants.roth_deferral_rate is
    'Roth deferral as a decimal (0.0500 = 5%).';


-- ---------------------------------------------------------------------------
-- payroll_mappings: approved column->field mappings for payroll uploads.
-- Immutable once approved; superseded mappings are kept for audit, not
-- updated in place.
-- ---------------------------------------------------------------------------
create table payroll_mappings (
    id              uuid primary key default gen_random_uuid(),
    plan_id         uuid not null references plans(id) on delete cascade,
    name            text not null,
    mapping         jsonb not null,
    suggested_by    text,
    suggested_at    timestamptz not null default now(),
    approved_by     text,
    approved_at     timestamptz,
    status          text not null default 'pending'
        check (status in ('pending', 'approved', 'superseded'))
);

create index payroll_mappings_plan_status_idx on payroll_mappings (plan_id, status);

comment on table payroll_mappings is
    'Column->field mapping for payroll uploads. New mappings are inserted as new rows; status flips to ''superseded'' on the prior version. Approved mappings are not edited in place.';
comment on column payroll_mappings.mapping is
    'JSON object mapping CSV column names to internal field names, e.g. {"Emp ID":"employee_id","401k Pre Tax":"pretax_deferral_amount"}.';


-- ---------------------------------------------------------------------------
-- payroll_runs: one row per uploaded payroll CSV.
-- ---------------------------------------------------------------------------
create table payroll_runs (
    id                  uuid primary key default gen_random_uuid(),
    plan_id             uuid not null references plans(id) on delete cascade,
    source_file_id      uuid references files(id) on delete set null,
    mapping_id          uuid references payroll_mappings(id) on delete restrict,
    label               text,
    pay_date            date,
    status              text not null default 'uploaded'
        check (status in (
            'uploaded',
            'mapped',
            'validated',
            'reconciled',
            'failed'
        )),
    row_count           int not null default 0,
    accepted_count      int not null default 0,
    rejected_count      int not null default 0,
    issue_count         int not null default 0,
    uploaded_at         timestamptz not null default now(),
    mapped_at           timestamptz,
    validated_at        timestamptz,
    reconciled_at       timestamptz
);

create index payroll_runs_plan_status_idx on payroll_runs (plan_id, status);
create index payroll_runs_pay_date_idx on payroll_runs (pay_date desc);

comment on table payroll_runs is
    'One row per uploaded payroll CSV. Tracks lifecycle: uploaded -> mapped -> validated -> reconciled.';


-- ---------------------------------------------------------------------------
-- payroll_records: one row per line in each payroll CSV.
-- raw_data preserves the original row verbatim for audit / re-derivation.
-- ---------------------------------------------------------------------------
create table payroll_records (
    id                          uuid primary key default gen_random_uuid(),
    payroll_run_id              uuid not null references payroll_runs(id) on delete cascade,
    row_number                  int not null,

    -- Source row preserved verbatim
    raw_data                    jsonb not null,

    -- Normalized columns (derived during import using the approved mapping)
    employee_id                 text,
    matched_participant_id      uuid references participants(id) on delete set null,
    first_name                  text,
    last_name                   text,
    email                       text,
    pay_date                    date,
    gross_wages                 numeric(12,2),
    pretax_deferral_amount      numeric(12,2),
    roth_amount                 numeric(12,2),
    employer_match              numeric(12,2),
    loan_repayment              numeric(12,2),
    employment_status_in_run    text,

    validation_status           text not null default 'pending'
        check (validation_status in (
            'pending',
            'valid',
            'has_warnings',
            'has_errors',
            'rejected'
        )),
    validation_errors           jsonb not null default '[]'::jsonb,

    created_at                  timestamptz not null default now(),

    unique (payroll_run_id, row_number)
);

create index payroll_records_run_idx on payroll_records (payroll_run_id);
create index payroll_records_employee_idx on payroll_records (employee_id);
create index payroll_records_matched_idx on payroll_records (matched_participant_id);

comment on table payroll_records is
    'One row per line in a payroll CSV. raw_data is the original row; the typed columns are derived during import.';
comment on column payroll_records.validation_errors is
    'Array of error objects, e.g. [{"code":"BLANK_EMP_ID","field":"Emp ID","message":"..."}].';


-- ---------------------------------------------------------------------------
-- reconciliation_issues: problems the Payroll Reconciliation Agent finds.
-- Categories match the planted-error families in the demo CSV runs:
--   * data_quality      - blanks, malformed values, duplicates (Run 2)
--   * contribution      - amounts inconsistent with census rates (Run 3)
--   * participant_match - identity mismatches against census (Run 4)
--   * roster_drift      - new/missing/status-changed people (Run 4, 5)
-- ---------------------------------------------------------------------------
create table reconciliation_issues (
    id                  uuid primary key default gen_random_uuid(),
    payroll_run_id      uuid not null references payroll_runs(id) on delete cascade,
    payroll_record_id   uuid references payroll_records(id) on delete cascade,
    participant_id      uuid references participants(id) on delete set null,

    category            text not null
        check (category in ('data_quality', 'contribution', 'participant_match', 'roster_drift')),
    severity            text not null default 'medium'
        check (severity in ('low', 'medium', 'high')),
    code                text not null,
    description         text not null,

    field_name          text,
    expected_value      jsonb,
    actual_value        jsonb,
    agent_explanation   text,

    status              text not null default 'open'
        check (status in ('open', 'resolved', 'ignored')),
    created_at          timestamptz not null default now(),
    resolved_at         timestamptz,
    resolved_by         text
);

create index reconciliation_issues_run_idx on reconciliation_issues (payroll_run_id);
create index reconciliation_issues_status_idx on reconciliation_issues (status);
create index reconciliation_issues_category_idx on reconciliation_issues (category);

comment on table reconciliation_issues is
    'Problems detected during payroll reconciliation. category maps to the error families exercised by the demo runs.';


-- ---------------------------------------------------------------------------
-- suggested_fixes: agent proposals (human-in-the-loop).
-- Lifecycle: pending -> approved | rejected -> applied | failed.
-- DB-level guard rails ensure approval/decision metadata is present at
-- each transition; the actual mutation logic lives in server code and
-- must refuse to run unless status = 'approved'.
-- ---------------------------------------------------------------------------
create table suggested_fixes (
    id                  uuid primary key default gen_random_uuid(),
    issue_id            uuid not null references reconciliation_issues(id) on delete cascade,
    description         text not null,
    proposed_changes    jsonb not null,
    confidence          numeric(3,2) not null default 0.5
        check (confidence >= 0 and confidence <= 1),
    agent_reasoning     text,

    status              text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected', 'applied', 'failed')),
    proposed_at         timestamptz not null default now(),
    decided_by          text,
    decided_at          timestamptz,
    applied_at          timestamptz,
    apply_error         text,

    -- Guard rail: any post-pending status must carry decision metadata.
    constraint suggested_fixes_decided_when_terminal check (
        status = 'pending'
        or (decided_by is not null and decided_at is not null)
    ),
    -- Guard rail: applied rows must record when application happened.
    constraint suggested_fixes_applied_at_present check (
        status <> 'applied' or applied_at is not null
    )
);

create index suggested_fixes_issue_idx on suggested_fixes (issue_id);
create index suggested_fixes_status_idx on suggested_fixes (status);

comment on table suggested_fixes is
    'Agent-proposed fixes for reconciliation issues. status lifecycle: pending -> approved/rejected -> applied/failed. Server code must verify status = ''approved'' before applying any data change.';


-- ---------------------------------------------------------------------------
-- Enable RLS on every table. Service role (used by lib/server/supabase.ts)
-- bypasses these checks. Anon access is denied by default until explicit
-- policies are added.
-- ---------------------------------------------------------------------------
alter table plans                 enable row level security;
alter table files                 enable row level security;
alter table participants          enable row level security;
alter table payroll_mappings      enable row level security;
alter table payroll_runs          enable row level security;
alter table payroll_records       enable row level security;
alter table reconciliation_issues enable row level security;
alter table suggested_fixes       enable row level security;
