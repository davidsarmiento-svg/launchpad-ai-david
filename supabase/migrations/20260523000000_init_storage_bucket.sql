-- ============================================================================
-- Storage bucket for LaunchPad AI file uploads.
--
-- One private bucket holds every artifact (plan PDFs, participant census
-- CSVs, payroll CSVs). Identity / RLS is enforced by the server-only
-- Route Handlers in `app/api/*` that read and write through the service
-- role; we intentionally do NOT add any storage.objects policies, which
-- keeps anon access denied by default.
--
-- The object key layout (set in lib/server/storage.ts) is:
--   plans/{plan_id}/{file_id}/{filename}
-- so a file row in `public.files` maps 1:1 to a single object path and
-- can be deleted with one Storage call when the plan is purged.
--
-- file_size_limit is 50 MiB - generous for census / payroll CSVs and
-- comfortably above the largest training-program plan PDF, while still
-- cheap to refuse if a user drops a 200 MB upload by accident.
-- ============================================================================

-- Note: we intentionally do not COMMENT ON storage.buckets - that table
-- is owned by `supabase_storage_admin`, so a non-owner COMMENT fails
-- with "must be owner of table buckets" and aborts the whole migration
-- (Supabase wraps each migration in a transaction). The header above
-- is the documentation; keep it there.

insert into storage.buckets (id, name, public, file_size_limit)
values (
    'launchpad-files',
    'launchpad-files',
    false,
    52428800
)
on conflict (id) do nothing;
