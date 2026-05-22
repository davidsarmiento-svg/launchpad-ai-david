# LaunchPad AI Deployment And Production Readiness

This guide is based on the current repository state plus the training docs in the ATP folder. It separates what is already present from what is still an architectural target, then walks from the current GitHub project to a credible production deployment on Vercel.

## Current Repo State

As of this review, the repository is on `main` at commit `08d5864` (`Hello world`) with local uncommitted changes. The app is a Next.js `16.2.6` App Router project with TypeScript, Tailwind, shadcn UI components, a themed `app/globals.css`, a home page, a client `HelloButton`, and one Route Handler at `app/api/hello/route.ts`.

What is already done:

- Next.js App Router scaffold exists.
- shadcn components exist for `button`, `input`, `table`, `badge`, `dialog`, `card`, and `tabs`.
- A hello-world API route exists and is wired to the homepage.
- `.gitignore` excludes `.env*`, `.vercel`, `.next`, and `node_modules`.
- `npm run lint` passes.
- `npm run build` passes when the build process has network access to fetch `next/font/google` assets.

What is not yet present in the repo:

- No direct `@supabase/supabase-js` dependency.
- No direct `@anthropic-ai/sdk` dependency.
- No direct `@modelcontextprotocol/sdk` dependency for the application runtime. It currently appears only transitively through `shadcn`, which should not be treated as the app's MCP dependency.
- No `supabase/` folder, migrations, seed scripts, or committed SQL schema.
- No Supabase client or server-only data access layer.
- No `skills/` folder or `SKILL.md` files.
- No MCP server/tool registry.
- No Claude SDK agent implementations.
- No API routes for plan extraction, participant import, payroll mapping, reconciliation, suggested fixes, or assistant chat.
- No UI modules yet for the eight LaunchPad AI dashboard areas.

The ATP docs already document the target product, stack, environment model, audit-log schema, five agents, and required MCP tools. The repo itself is currently closer to Session 3/early Session 4 than to a deployable AI onboarding product.

## Source Of Truth From The Training Docs

Already documented:

- `launchpad-dev` is for local development and Vercel preview deployments.
- `launchpad-prod` is for the public production demo URL.
- Pushing branches other than `main` creates Vercel preview deployments.
- Pushing `main` creates a Vercel production deployment.
- `NEXT_PUBLIC_*` variables may be used in browser code.
- `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` must stay server-side only.
- The core human-in-the-loop rule is non-negotiable: agents propose changes, users explicitly approve, and only then can data be changed.
- `audit_logs` is the spine of the system.

Decision points not fully settled by the docs or current repo:

- Whether the custom MCP server is an in-process TypeScript tool registry called by Route Handlers, an HTTP MCP service, or a separately hosted long-running process.
- The final schema for tables beyond `audit_logs`.
- Whether file uploads go through Next.js Route Handlers or directly to Supabase Storage with signed upload URLs.
- Whether the demo has no authentication, a lightweight demo gate, or full Supabase Auth.
- The exact RLS policy strategy.
- Whether long-running AI workflows run synchronously in Vercel functions or through a queued/background job model.

## Recommended Deployment Architecture

Use Vercel for the Next.js app and Supabase for Postgres and, ideally, file storage.

For this app on Vercel, treat Next.js Route Handlers as the public backend-for-frontend layer. They are publicly reachable HTTP endpoints, so every route that touches data, Claude, or the MCP tools must validate input and enforce authorization. Server-only code should live behind those handlers in modules such as `lib/server/*` or `lib/data/*`.

For the MCP layer, the safest MVP shape on Vercel is:

```text
Browser
  -> Next.js Route Handler
    -> server-only agent function
      -> MCP tool registry / tool dispatcher
        -> server-only Supabase data access
      -> Claude SDK
```

This keeps everything request-scoped and compatible with Vercel. A standalone stdio MCP process is awkward in serverless hosting because Vercel functions are not designed to keep a long-running local server alive between requests. If you later need a real remote MCP server, host it as an HTTP service and call it from the Vercel app using a server-only secret.

## Environment Mapping

Use three practical environments:

| Context | Vercel environment | Supabase project | Purpose |
|---|---|---|---|
| Local development | `.env.local` | `launchpad-dev` | Build and test on your laptop |
| Feature branch / PR | `Preview` | `launchpad-dev` | Safe internet-accessible testing |
| `main` branch | `Production` | `launchpad-prod` | Public demo URL |

Vercel also has a `Development` environment for `vercel dev`. The training docs focus on Production and Preview; for local work, either pull the Preview/dev values into `.env.local` or manually create `.env.local` with `launchpad-dev` credentials.

## Required Environment Variables

Set these in Vercel.

Production values use `launchpad-prod`:

```text
NEXT_PUBLIC_SUPABASE_URL=<launchpad-prod project url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<launchpad-prod anon key>
SUPABASE_SERVICE_ROLE_KEY=<launchpad-prod service role key>
ANTHROPIC_API_KEY=<anthropic key>
```

Preview values use `launchpad-dev`:

```text
NEXT_PUBLIC_SUPABASE_URL=<launchpad-dev project url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<launchpad-dev anon key>
SUPABASE_SERVICE_ROLE_KEY=<launchpad-dev service role key>
ANTHROPIC_API_KEY=<anthropic key>
```

Optional later variables:

```text
APP_ENV=production | preview | development
NEXT_PUBLIC_APP_ENV=production | preview | development
SUPABASE_STORAGE_BUCKET=launchpad-files
MCP_SERVER_URL=<only if MCP is separately hosted>
MCP_SERVER_TOKEN=<only if MCP is separately hosted>
DEMO_ACCESS_TOKEN=<only if adding a lightweight demo gate>
```

Client-safe:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_ENV`, if used

Server-only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `MCP_SERVER_TOKEN`
- Any future encryption/signing secrets

Important Next.js behavior: `NEXT_PUBLIC_*` values are inlined into browser JavaScript at build time. If you change a public env var in Vercel, redeploy the affected environment.

## Pre-Deployment Implementation Steps

The current repo will deploy as a hello-world app, but it will not yet satisfy the LaunchPad AI demo criteria. Before calling the production URL operational, complete these foundations.

1. Commit the current scaffold state.

   ```bash
   git status --short
   npm run lint
   npm run build
   git add .
   git commit -m "Session 3 scaffold and UI foundation"
   git push origin main
   ```

2. Install direct runtime dependencies.

   ```bash
   npm install @supabase/supabase-js @anthropic-ai/sdk @modelcontextprotocol/sdk
   ```

   Add CSV/schema helpers as needed, for example `zod` and a CSV parser. Keep dependencies boring and purposeful.

3. Create committed database migrations.

   Prefer a `supabase/migrations` folder over manual SQL-only setup. Manual SQL is fine while learning, but migrations are how you keep `launchpad-dev` and `launchpad-prod` from drifting.

   Minimum MVP tables from the project context:

   - `audit_logs`
   - `plans`
   - `participants`
   - `payroll_runs`
   - `reconciliation_issues`

   Session 4 also names likely supporting tables:

   - `payroll_mappings`
   - `payroll_records`
   - `suggested_fixes`
   - `chat_messages`
   - file metadata, if not represented elsewhere

4. Create server-only Supabase access.

   Recommended pattern:

   - `lib/server/supabase.ts` creates a service-role client and imports `server-only`.
   - Browser components do not import this module.
   - Route Handlers call server-only functions.
   - Client components call Route Handlers, not Supabase directly, unless you have strong RLS policies.

5. Create skills.

   At minimum:

   - `skills/api-endpoint-pattern/SKILL.md`
   - `skills/clean-code/SKILL.md`
   - `skills/audit-logging/SKILL.md`
   - `skills/supabase-query/SKILL.md`
   - `skills/plan-extraction/SKILL.md`
   - `skills/payroll-mapping/SKILL.md`
   - `skills/participant-import/SKILL.md`
   - `skills/payroll-reconciliation/SKILL.md`
   - `skills/fix-suggestion/SKILL.md`

6. Implement the MCP tool registry.

   Required for the MVP path:

   - `upload_file_metadata`
   - `extract_plan_details`
   - `save_plan_details`
   - `write_audit_log`
   - `apply_approved_fix`
   - `get_audit_logs`

   Next batch from Session 4:

   - `get_plan_details`
   - `parse_participant_file`
   - `save_participant_records`
   - `parse_payroll_file`
   - `suggest_payroll_mapping`
   - `save_payroll_mapping`
   - `get_payroll_mapping`
   - `normalize_payroll_run`
   - `validate_payroll_run`
   - `reconcile_payroll_run`
   - `create_reconciliation_issue`
   - `suggest_fix_for_issue`
   - `answer_onboarding_question`

7. Implement the five agent entry points.

   Each agent should have one clear server-side function and one or more Route Handlers:

   - Plan Extraction Agent
   - Payroll Mapping Agent
   - Participant Import Agent
   - Payroll Reconciliation Agent
   - Onboarding Assistant Agent

   Each agent response should include structured status, artifacts, errors, and audit-log IDs. Do not let agent code update domain data except through approved tool paths.

8. Build the dashboard modules.

   Minimum visible modules for demo:

   - Onboarding Home
   - Plan Details
   - Participant Data
   - Payroll Mapping
   - Payroll Runs
   - Reconciliation Issues
   - Audit Trail
   - AI Onboarding Assistant

## Vercel Setup

Connect GitHub to Vercel and import the repository.

Recommended project settings:

- Framework preset: Next.js
- Build command: `npm run build`
- Install command: `npm install`
- Output directory: leave default
- Node runtime: use the default supported by Vercel for the project, unless a dependency requires a specific version

Add environment variables in Vercel:

1. Open Vercel project.
2. Go to Settings -> Environment Variables.
3. Add the production values and select `Production`.
4. Add the dev values and select `Preview`.
5. Do not mark service role or Anthropic keys as public.
6. Redeploy after env var changes.

Equivalent CLI flow:

```bash
vercel link

vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add ANTHROPIC_API_KEY production

vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
vercel env add SUPABASE_SERVICE_ROLE_KEY preview
vercel env add ANTHROPIC_API_KEY preview
```

For local development, create `.env.local` using `launchpad-dev` values. Confirm `.env.local` remains ignored by Git.

## Deploy Flow

Preview deployment:

```bash
git checkout -b feature/plan-extraction
git push origin feature/plan-extraction
```

Vercel creates a Preview deployment that should talk to `launchpad-dev`.

Production deployment:

```bash
git checkout main
git merge feature/plan-extraction
git push origin main
```

Vercel creates a Production deployment that should talk to `launchpad-prod`.

Before merging to `main`:

```bash
npm run lint
npm run build
```

Then verify the preview URL end to end against `launchpad-dev`.

## Supabase Production Setup

Create or apply the same schema to `launchpad-prod` before the production deploy. Do not assume the dev SQL editor changes exist in prod.

If using migrations:

```bash
supabase link --project-ref <launchpad-prod-ref>
supabase db push
```

If using SQL Editor manually, run the same SQL in `launchpad-prod` that you ran in `launchpad-dev`.

Confirm table existence in `launchpad-prod`:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'audit_logs',
    'plans',
    'participants',
    'payroll_runs',
    'reconciliation_issues',
    'payroll_mappings',
    'payroll_records',
    'suggested_fixes',
    'chat_messages'
  )
order by table_name;
```

Confirm the `audit_logs` columns:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'audit_logs'
order by ordinal_position;
```

Expected audit columns:

```text
id
timestamp
actor_type
actor_name
action
entity_type
entity_id
payroll_run_id
employee_id
field_name
before_value
after_value
reason
status
```

Add practical indexes before demo:

```sql
create index if not exists audit_logs_timestamp_idx
  on audit_logs (timestamp desc);

create index if not exists audit_logs_entity_idx
  on audit_logs (entity_type, entity_id);

create index if not exists audit_logs_payroll_run_idx
  on audit_logs (payroll_run_id);

create index if not exists reconciliation_issues_status_idx
  on reconciliation_issues (status);
```

RLS decision for the MVP:

- If all reads/writes go through server Route Handlers using the service role key, enable RLS and create no broad anon write policies. The service role bypasses RLS, so protect it in server-only code.
- If browser code reads Supabase directly with the anon key, enable RLS and add narrow read policies. Do not allow public anon writes to operational tables.
- Because the training MVP says no auth is required, treat the production URL as a demo-only public surface with fictional data. For real internal use, add authentication before real plan or participant data touches the app.

## Production Verification

After pushing to `main`, verify the Vercel Production deployment.

1. Open the production URL.
2. Confirm the UI shows a production/environment indicator if you added one.
3. In Vercel -> Deployments, confirm the deployment is attached to the `main` branch.
4. In Vercel -> Settings -> Environment Variables, confirm Production env vars point to `launchpad-prod`.
5. In Supabase `launchpad-prod`, check that new data appears only after production actions.
6. Open Vercel runtime logs during smoke tests.

Health checks to add before final demo:

- `/api/health` returns app version, environment, and basic status without exposing secrets.
- `/api/health/db` performs a tiny server-side Supabase query.
- `/api/health/mcp` confirms the tool registry contains required tools.
- `/api/health/anthropic` can be an authenticated or disabled-by-default check that validates the Anthropic key with a tiny request. Do not leave a public endpoint that burns tokens.

## Verifying The Five Agents

Each agent should have a deterministic smoke test in production using Acme demo data.

Plan Extraction Agent:

- Upload the Acme plan PDF.
- Confirm extracted structured fields render with confidence values.
- Confirm the user can edit/review before saving.
- Confirm `FILE_UPLOADED`, `PLAN_EXTRACTED`, and save/update audit rows are written.

Payroll Mapping Agent:

- Upload Payroll Run 1.
- Confirm the agent proposes column mappings.
- Confirm mappings are not saved as approved until the user clicks Approve.
- Confirm `MAPPING_SUGGESTED` and `MAPPING_APPROVED` audit rows.

Participant Import Agent:

- Upload participant census CSV.
- Confirm normalized records are previewed before save.
- Confirm missing/invalid fields are flagged.
- Confirm import audit rows identify actor, action, entity, reason, and status.

Payroll Reconciliation Agent:

- Upload Payroll Run 2.
- Run reconciliation.
- Confirm issues are created and suggested fixes remain pending.
- Approve one fix and reject another.
- Confirm only the approved fix changes data.
- Confirm `ISSUE_CREATED`, `FIX_SUGGESTED`, `FIX_APPROVED`, `FIX_REJECTED`, and `FIX_APPLIED` audit rows as appropriate.

Onboarding Assistant Agent:

- Ask, "What plan details were extracted?"
- Ask, "What issues are still open?"
- Ask, "What changes were applied for Payroll Run 2?"
- Confirm answers cite or summarize data returned by MCP tools rather than inventing state.
- Confirm `CHAT_QUESTION_ASKED` and `MCP_TOOL_CALLED` audit rows.

## Verifying MCP Tools And Skills

MCP tool verification should prove three things:

1. The tool exists in the registry.
2. The tool validates input and returns a typed response.
3. The tool performs the correct database/audit side effect.

Minimum tool smoke tests:

- `upload_file_metadata`: write metadata for a demo file and confirm the row exists.
- `extract_plan_details`: run against a known PDF and compare key fields.
- `save_plan_details`: save reviewed fields and confirm `plans` row plus audit log.
- `write_audit_log`: insert a synthetic non-destructive audit row.
- `apply_approved_fix`: attempt to apply an unapproved fix and confirm it fails; approve the fix and confirm it succeeds.
- `get_audit_logs`: confirm the UI and assistant can retrieve chronological logs.

Skills verification:

- Confirm each agent loads the intended `SKILL.md` instructions.
- Confirm the output schema in the skill matches the validation schema in code.
- Change a skill in a preview branch and verify the preview deployment behavior changes while production remains stable.
- Keep skills committed to Git so Vercel deployments include them.

## End-To-End Pre-Launch Checklist

Run this full sequence on a Vercel Preview URL first, then on Production.

1. Start with a clean Acme demo dataset in the target Supabase project.
2. Open the app and confirm it is pointed at the expected environment.
3. Upload the plan PDF.
4. Run plan extraction.
5. Review extracted fields and save.
6. Confirm plan details appear in the UI.
7. Confirm audit log shows file upload, extraction, and save actions.
8. Upload participant census CSV.
9. Review normalized participant records.
10. Save participant records.
11. Confirm participants appear in the UI.
12. Upload Payroll Run 1.
13. Run payroll mapping.
14. Approve the suggested mapping.
15. Confirm mapping persists and audit rows exist.
16. Upload Payroll Run 2.
17. Run reconciliation.
18. Confirm at least one issue appears with explanation and suggested fix.
19. Verify suggested fixes show pending state and no data has changed yet.
20. Approve one suggested fix.
21. Reject one suggested fix if available.
22. Confirm only the approved fix changed data.
23. Ask the assistant about extracted plan details.
24. Ask the assistant about open reconciliation issues.
25. Ask the assistant what changed after the approved fix.
26. Open the audit trail and confirm all important actions appear chronologically.
27. Refresh the browser and confirm state persists.
28. Check Vercel runtime logs for unhandled errors.
29. Check Supabase logs for query or auth errors.
30. Redeploy once after changing an env var to confirm you understand env/build behavior.

## Common Failure Points

Environment mismatch:

- Symptom: Preview data appears in production, production appears empty, or writes go to the wrong Supabase project.
- Check: Vercel deployment branch, Vercel env var scope, and Supabase project URL.
- Fix: Correct env var values in the right Vercel environment and redeploy. Add a visible environment badge for non-production deployments.

Secret exposed to the browser:

- Symptom: `SUPABASE_SERVICE_ROLE_KEY` or `ANTHROPIC_API_KEY` appears in client bundle, browser devtools, or public code.
- Check: Search for secret variable names in client components and `NEXT_PUBLIC_` variables.
- Fix: Move calls behind Route Handlers/server-only modules. Never prefix private keys with `NEXT_PUBLIC_`.

Schema drift:

- Symptom: Code works locally or in preview but production returns missing-table or missing-column errors.
- Check: Compare `launchpad-dev` and `launchpad-prod` schemas.
- Fix: Use migrations and apply them to both projects.

RLS or permission errors:

- Symptom: Empty reads, `401`, `403`, or Supabase errors despite existing rows.
- Check: Whether the request uses anon key or service role, and whether RLS policies exist.
- Fix: Route writes through server-only service role code for MVP, or add narrow RLS policies for authenticated/anon reads.

MCP tool wiring failure:

- Symptom: Claude says it cannot call a tool, a tool name is missing, or agent output ignores tool data.
- Check: Tool registry, tool names, JSON schemas, and agent loop logs.
- Fix: Keep canonical tool names in one registry and validate every tool input/output.

Serverless/runtime mismatch:

- Symptom: MCP works locally but fails on Vercel, especially if it depends on a long-running local process.
- Check: Whether the code starts a persistent server inside a Vercel function.
- Fix: Use an in-process tool registry for MVP or host MCP as a separate HTTP service.

Route Handler timeouts:

- Symptom: Large PDF/CSV or Claude calls fail after a long wait.
- Check: Vercel function duration, route logs, and Claude response time.
- Fix: Keep demo files small, cap model output, add progress states, and move long work to background jobs later.

File upload limits:

- Symptom: Uploads fail before reaching business logic.
- Check: Request size, body parsing, Vercel logs, and Supabase Storage bucket.
- Fix: For demo, use small files. For production, upload files directly to Supabase Storage via signed URLs, then process from stored file metadata.

Claude/API failures:

- Symptom: `401`, rate limit errors, malformed model output, or intermittent agent failures.
- Check: `ANTHROPIC_API_KEY`, model name, token limits, response validation, and retry behavior.
- Fix: Validate output with schemas, log sanitized errors, show user-friendly failure states, and make retries idempotent.

Audit gaps:

- Symptom: Data changed but audit trail does not show why.
- Check: Every mutation path and every agent proposal path.
- Fix: Centralize writes through functions that require audit metadata.

## Production-Readiness Pointers

These are trade-offs, not a generic checklist. The project is an internal 401(k) onboarding tool, so trust and traceability matter more than flashy automation.

### Security Hardening

For a demo-ready production deploy:

- Use only fictional Acme data.
- Keep `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` in server-only code.
- Do not let browser code write directly to Supabase operational tables.
- Add a simple rate limit or demo gate to expensive AI endpoints if the URL is public.
- Show an environment indicator so preview/prod confusion is obvious.

For long-term production:

- Add real authentication, preferably SSO.
- Add RBAC by plan/client/team.
- Enable RLS with policies tied to authenticated users and plan access.
- Add secret rotation and incident playbooks.
- Consider a Content Security Policy and structured security headers.
- Use a server-only data access layer with safe DTOs so participant/plan data is never over-sent to client components.

Key question to answer: is the demo meant to be publicly accessible to anyone with the URL, or public only in the Vercel sense but shared with a small audience?

### Human-In-The-Loop Reliability

For a demo-ready production deploy:

- Model suggested fixes as records with explicit `pending`, `approved`, `rejected`, `applied`, and `failed` states.
- Disable double-click/retry duplicate approvals with idempotency keys.
- Make `apply_approved_fix` refuse to run unless the fix is already approved.
- Show before/after values in the approval dialog.
- Write audit rows for proposal, approval/rejection, application, and failure.

For long-term production:

- Wrap approval plus apply operations in database transactions.
- Use row locks or optimistic concurrency checks for fixes.
- Make audit logs append-only with database constraints/triggers.
- Add tamper-evident hashing for audit rows.
- Add an outbox/job table so failed side effects can be retried safely.

Key question to answer: should a user approval apply exactly one proposed field change, or can one approval apply a batch of related changes?

### Error Handling And User Feedback

For a demo-ready production deploy:

- Every agent route should return structured errors: `code`, `message`, `retryable`, and `audit_log_id` where possible.
- The UI should show queued/running/succeeded/failed states for each AI action.
- Failed agent runs should be visible in the audit log.
- The assistant should say when data is unavailable instead of guessing.

For long-term production:

- Add tracing across Route Handler -> agent -> tool -> database.
- Capture sanitized server errors in an observability system.
- Add retry policies by error type.
- Add user-visible run history for each upload/reconciliation.

Key question to answer: when an agent partially succeeds, should the user see partial results, or should the whole run be marked failed until rerun?

### Performance And Scalability

For a demo-ready production deploy:

- Keep demo PDFs/CSVs small.
- Parse CSVs server-side with clear row limits.
- Add indexes on audit timestamps, issue status, payroll run IDs, and employee IDs.
- Cap Claude max tokens and use focused prompts/skills.
- Add loading/progress UI for AI calls.

For long-term production:

- Use Supabase Storage signed uploads for files.
- Process large files asynchronously.
- Store raw uploads plus normalized records.
- Add database constraints and bulk insert strategies.
- Cache read-heavy dashboard counts, but do not cache mutable audit or approval state incorrectly.
- Consider queues for reconciliation and assistant workflows that exceed Vercel function comfort.

Key question to answer: what is the largest realistic payroll file and PDF the tool must handle?

### Data Consistency And Silent Failure Prevention

For a demo-ready production deploy:

- Add validation schemas for every agent output before saving.
- Use database constraints for required fields and allowed statuses.
- Ensure every mutation writes an audit row.
- Add negative tests: unapproved fixes cannot apply, duplicate approvals do not double-apply, malformed CSV rows do not silently disappear.
- Use visible counts after import: rows read, rows accepted, rows rejected, rows saved.

For long-term production:

- Use transactions for multi-table changes.
- Add reconciliation run IDs to every derived row.
- Store raw file checksums and import manifests.
- Make imports idempotent by file checksum or upload ID.
- Add reconciliation between audit logs and domain tables to detect orphan changes.

Key question to answer: if a payroll import has 500 rows and row 347 fails validation, should the system reject the whole file or import valid rows with a clear exception report?

## Demo Priority Order

If time is tight, prioritize in this order:

1. Correct environment separation between Preview/dev and Production/prod.
2. Committed schema/migrations for prod.
3. Server-only secrets and no service-role key in browser code.
4. One complete golden path: PDF extraction -> save plan details -> audit log.
5. Participant CSV import with visible row counts.
6. Payroll Run 1 mapping approval.
7. Payroll Run 2 issue detection and one approved fix.
8. Audit trail UI showing all steps.
9. Assistant answers questions using stored data.
10. Error states and logs polished enough that failures are explainable.

Long-term hardening can wait until after demo if the app uses fictional data and limited access, but authentication, RLS, durable jobs, and append-only audit integrity are not optional for real internal 401(k) use.
