-- Audit log: append-only record of every user, agent, and system action.
--
-- This is the "spine" of LaunchPad AI. Every meaningful change
-- (data mutation, agent proposal, file upload, MCP tool call) writes
-- a row here so the trail can answer "who did what, to what, when,
-- and why" without joining other tables.
--
-- Writes go through the Supabase service role from server-only code
-- (lib/server/supabase.ts), which bypasses RLS. We still enable RLS
-- so that any future anon access defaults to "no access until you
-- add an explicit policy".

create table audit_logs (
    id              uuid primary key default gen_random_uuid(),
    timestamp       timestamptz not null default now(),
    actor_type      text not null check (actor_type in ('user', 'agent', 'system')),
    actor_name      text not null,
    action          text not null,
    entity_type     text,
    entity_id       text,
    payroll_run_id  text,
    employee_id     text,
    field_name      text,
    before_value    jsonb,
    after_value     jsonb,
    reason          text,
    status          text
);

comment on table audit_logs is
    'Append-only record of every user, agent, and system action.';
comment on column audit_logs.actor_type is
    'user | agent | system - who initiated the action.';
comment on column audit_logs.action is
    'Verb describing what happened, e.g. FILE_UPLOADED, FIX_APPROVED.';
comment on column audit_logs.before_value is
    'Snapshot of affected value(s) before this action, when applicable.';
comment on column audit_logs.after_value is
    'Snapshot of affected value(s) after this action, when applicable.';

create index audit_logs_timestamp_idx     on audit_logs (timestamp desc);
create index audit_logs_entity_idx        on audit_logs (entity_type, entity_id);
create index audit_logs_payroll_run_idx   on audit_logs (payroll_run_id);
create index audit_logs_actor_idx         on audit_logs (actor_type, actor_name);

alter table audit_logs enable row level security;
