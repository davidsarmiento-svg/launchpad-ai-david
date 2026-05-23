# LaunchPad AI — Agent Handoff

This document brings a new agent (or future-you) up to speed on the
LaunchPad AI project: what has been built, what decisions are already
made, what is intentionally deferred, and what to pick up next.

Read in order. Each section is short.

---

## 1. Project in one paragraph

LaunchPad AI is an internal-style dashboard that onboards a fictional
401(k) plan (Acme Robotics) to ForUsAll. It uses Claude agents to
extract plan details from a PDF, ingest a participant census,
reconcile five increasingly messy payroll runs against that census,
surface issues, suggest fixes, and log every action. The
non-negotiable rule: **agents propose changes, humans approve, only
then is data changed**. The full product brief lives in the user's
training docs (`/Users/davidsarmiento/Downloads/AI Training Program/ATP/`)
and the engineering plan is at [docs/deployment-and-production-readiness.md](deployment-and-production-readiness.md).

Stack: **Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4 +
shadcn/ui (`base-nova` style) + Supabase (Postgres + Storage) + Anthropic
Claude SDK + Vercel hosting**.

---

## 2. Read these files first

Before writing any code, read these in this order:

1. [AGENTS.md](../AGENTS.md) — **Critical**. Next.js 16 has breaking
   changes from prior versions. Always consult
   `node_modules/next/dist/docs/` before writing routes, layouts, or
   server code.
2. [docs/deployment-and-production-readiness.md](deployment-and-production-readiness.md)
   — the master plan that drives every phase. Read sections "Recommended
   Deployment Architecture", "Environment Mapping", "Required
   Environment Variables", "Demo Priority Order".
3. [package.json](../package.json) — current dependencies and scripts.
4. [supabase/migrations/](../supabase/migrations/) — the two committed
   schema migrations.
5. [lib/server/env.ts](../lib/server/env.ts) — env var contract; if you
   add a server-required env var, add it here too.
6. [components.json](../components.json) — shadcn config (style is
   `base-nova`, base color `neutral`, alias `@/*`).

---

## 3. Current commit graph

```text
1898058 Add domain schema migration for participants, payroll, and reconciliation
43ff54e Init Supabase + first migration for audit_logs
6a3d519 Server foundation: env validation, Supabase + Anthropic clients, /api/health
c4b7cdb Session 3 scaffold: UI kit, theme, hello API route, deployment guide
08d5864 Hello world
f01795d Initial scaffold: Next.js + shadcn
```

Branch `main` is up to date with `origin/main` at
https://github.com/davidsarmiento-svg/launchpad-ai-david.

> **Uncommitted (Phases 5 + 6 + 7)**:
>
> *Server modules* — `lib/server/{errors,http,audit-log,plans,files,participants,storage,plan-extraction}.ts`,
> `lib/server/agents/{run,skills}.ts`,
> `lib/server/tools/registry.ts`.
>
> *Migrations* — `20260523000000_init_storage_bucket.sql` (already
> applied to launchpad-dev). Prod still un-migrated.
>
> *Route Handlers* — `/api/health` (probes `audit_logs`),
> `/api/plans` (GET + POST), `/api/upload` (multipart, accepts
> `plan_pdf` as of Phase 7), `/api/plans/[id]/extract` (Plan
> Extraction Agent with 60 s max duration).
>
> *UI* — `app/page.tsx` (`force-dynamic`), `app/plans/[id]/page.tsx`,
> `components/{upload-card,upload-card-client,plan-detail-client}.tsx`.
>
> *Skills* — `skills/plan-extraction/SKILL.md`.
>
> Lint + build pass. End-to-end runs against launchpad-dev: upload
> happy + dedupe (Phase 6), extraction against the real
> `mock-plan-document.pdf` returns every expected field, catches all
> four planted gotchas, and writes both `PLAN_CREATED` + `PLAN_DETAILS_EXTRACTED`
> audit rows. See §4.10. Commit before the next session.

---

## 4. What is done

### 4.1 Project scaffold (commits `f01795d`, `08d5864`, `c4b7cdb`)
- Next.js 16 App Router with TypeScript + Tailwind v4 + Turbopack.
- shadcn/ui initialized in `base-nova` style; components installed:
  `button`, `card`, `dialog`, `input`, `table`, `tabs`, `badge`.
  `form` was NOT installed — the `base-nova` registry ships an empty
  stub for it. When a real form is needed, either use
  `react-hook-form` directly or pull the default-style form by URL.
- tweakcn theme applied via `app/globals.css` (orange + pale blue
  palette). Theme uses Geist fonts (the tweakcn-suggested Outfit /
  Merriweather / Fira Code were swapped back to Geist to match
  `app/layout.tsx`).
- Home page (`app/page.tsx`) has a `HelloButton` client component that
  fetches `/api/hello` and renders the response — the canonical
  "client → route handler → JSON → re-render" pattern that everything
  in the app will use.

### 4.2 Vercel + GitHub (manual setup outside the repo)
- Project linked: `david-sarmiento-s-projects1/launchpad-ai-davidsarmiento`.
- All 8 env vars set in both **Production** and **Preview**:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`. The service-role
  and Anthropic keys are flagged **Sensitive**, so they cannot be
  pulled with `vercel env pull` (see §6.2 for what this means locally).
- Production maps to the `launchpad-prod` Supabase project; Preview
  maps to `launchpad-dev`.
- GitHub auto-connect during `vercel link` failed. Result: pushing to
  `main` does **not** auto-deploy. Production releases require
  `vercel --prod` from the terminal until someone wires the GitHub
  integration in the Vercel dashboard
  (Settings → Git → Connect repository).
- Last production deploy was triggered manually before Phase 2; it
  shows the pre-theme, pre-HelloButton state. **A redeploy is needed
  to show the current `main`.**

### 4.3 Runtime dependencies (commit `6a3d519`)
- `@supabase/supabase-js`, `@anthropic-ai/sdk`, `zod`, `csv-parse`,
  `server-only`.
- `@modelcontextprotocol/sdk` was **intentionally NOT installed**. See
  §6.1 for the rationale; reverse only with explicit reason.

### 4.4 Server foundation (commit `6a3d519`)
- `lib/server/env.ts` — Zod-validated env reader. Throws at module load
  with a self-documenting error if any required var is missing or
  empty. The build fails loud rather than starting up half-broken.
- `lib/server/supabase.ts` — lazily constructs a service-role Supabase
  client. `import "server-only"` makes it impossible to pull into a
  Client Component.
- `lib/server/anthropic.ts` — lazily constructs an Anthropic client.
  Also `server-only`.
- `app/api/health/route.ts` — `GET /api/health` returns
  `{ status, environment, timestamp, duration_ms, checks: { env,
  supabase, anthropic } }`. Probes Supabase via
  `auth.admin.listUsers({ perPage: 1 })` — proves URL + service-role
  key are correct without burning Anthropic tokens. Returns 503 when
  Supabase is unreachable. **Update this to ping `audit_logs` after
  the migration is applied (§7.1).**

### 4.5 Supabase project + migrations (commits `43ff54e`, `1898058`)
- `supabase init` ran, creating `supabase/config.toml` and a
  `supabase/.gitignore`. Project ID: `launchpad-ai`.
- Migration 1 — `supabase/migrations/20260522120000_init_audit_logs.sql`
  (46 lines). Creates `audit_logs` with the Session 3 spec columns plus
  a CHECK on `actor_type`, `NOT NULL` on the spine columns, 4 indexes,
  RLS enabled, inline column comments.
- Migration 2 — `supabase/migrations/20260522130000_init_domain_schema.sql`
  (352 lines). Creates 8 domain tables: `plans`, `files`,
  `participants`, `payroll_mappings`, `payroll_runs`, `payroll_records`,
  `reconciliation_issues`, `suggested_fixes`. Plus a `set_updated_at()`
  trigger function and triggers on `plans` and `participants`.

### 4.6 Documentation
- [docs/deployment-and-production-readiness.md](deployment-and-production-readiness.md)
  — engineering plan (706 lines, authored by the user).
- This file.

### 4.7 Migrations applied to launchpad-dev (Phase 4 closeout)
- `supabase login` + `supabase link --project-ref zlrstvvepnrqssupwjzm`
  + `supabase db push` succeeded. Both migrations are live in the
  `launchpad-dev` Supabase project. (Transcript in terminal 2 of the
  prior session if needed.) Prod is still **un-migrated**.
- `/api/health` now probes `audit_logs` via `select count(*)` (HEAD
  request) instead of `auth.admin.listUsers`. A 200 response now
  proves the schema is deployed, not just that the service-role key
  is valid. Verified locally with `curl 127.0.0.1:3000/api/health`
  → `{"status":"ok",...}`.

### 4.8 Phase 5 — typed data access layer (uncommitted, see §3 note)
All under `lib/server/`, all `import "server-only"`, all Zod-validated
at the boundary. Each module throws `ZodError` on bad input and
`DataLayerError` on Supabase failure so Route Handlers can translate
both to HTTP responses with one `try/catch` shape.

- `errors.ts` — `DataLayerError` wrapper around Supabase errors.
  Keeps PostgREST error shape from leaking out of the data layer.
- `audit-log.ts` — `writeAuditLog({...})` (the universal logger) and
  `listAuditLogs({...})` (capped at 500 rows for the Audit Trail UI).
  Returns the inserted `{id, timestamp}` so callers can thread the
  audit-log id into agent responses, as the deployment plan requires.
- `plans.ts` — `createPlan`, `getPlan`, `listPlans`,
  `updateExtractedFields`. The Plan Extraction Agent will call the
  last one; it sets `extracted_at = now()` automatically.
- `files.ts` — `registerUpload` (idempotent: returns existing row
  when `(plan_id, checksum_sha256)` already exists, with a `created`
  boolean), `getFileByChecksum`, `getFileById`, `listFilesForPlan`.
- `participants.ts` — `importParticipants` (bulk upsert on
  `(plan_id, employee_id)`, max 10k rows), `listParticipants`
  (paginated, searchable by name/id), `getParticipantByEmployeeId`
  (used by the reconciliation matcher).

Conventions to keep when adding more modules:
1. Always validate inputs with a Zod schema exported from the module.
2. Use `maybeSingle()` for "may-not-exist" reads (returns `null`,
   not an error, on zero rows).
3. Numeric columns from Postgres come back as **strings** in
   supabase-js to preserve precision; row types in `participants.ts`
   reflect that. Coerce with `Number()` at the UI/agent boundary, not
   inside the DAL.
4. The DAL never writes to `audit_logs` on the caller's behalf. The
   Route Handler / agent is responsible for `writeAuditLog({...})`
   with actor metadata that this layer cannot know.

### 4.9 Phase 6 — file upload + Supabase Storage (uncommitted, see §3)

The third migration creates the private `launchpad-files` bucket
(50 MiB cap). A non-owner `COMMENT ON storage.buckets` aborts the
migration with `must be owner of table buckets`, so the migration's
header comment is the documentation — don't add `comment on table`
on storage-owned tables.

New code:

- `lib/server/http.ts` — `toErrorResponse(err)` translates `ZodError`
  → 400 with structured `issues`, `DataLayerError` → 500 with the
  module/operation tag, and everything else → generic 500. Plus
  `readJsonBody(request, schema)` for type-safe JSON Route Handlers.
- `lib/server/storage.ts` — `uploadFile({plan_id, kind, filename,
  mime_type, uploaded_by, bytes})`:
  1. sha256 the bytes
  2. `registerUpload(...)` (idempotent on `(plan_id, sha256)`)
  3. fast-return if the row already has `storage_path`
  4. otherwise upload to `plans/{plan_id}/{file_id}/{filename}` and
     back-write `storage_path` (also recovers orphan rows whose
     prior Storage push failed)
  Plus `getSignedDownloadUrl({file_id, ttl_seconds})` (default 1 h).
  Both validate via Zod and throw the same `DataLayerError` shape.
- `app/api/plans/route.ts` — `GET /api/plans` (list 50 most recent)
  and `POST /api/plans` (create a draft plan; writes a
  `PLAN_CREATED` audit row). The POST is the temporary stand-in for
  the Plan-Extraction-Agent-driven creation that arrives in Phase 7.
- `app/api/upload/route.ts` — `POST /api/upload` (multipart form).
  Required fields: `file`, `plan_id`, `kind`. `kind=plan_pdf` is
  rejected so the Phase 7 PDF flow can own that path. Writes a
  `FILE_UPLOADED` (created=true) or `FILE_UPLOAD_DEDUPED`
  (created=false) audit row. Returns
  `{file, created, audit_log_id}`.
- `components/upload-card.tsx` — Server Component that loads the
  initial plan list via `listPlans()` and renders
  `<UploadCardClient initialPlans={...} />`. This split is the
  React-19-correct fix for the `react-hooks/set-state-in-effect`
  lint error you get if you `useEffect(() => { fetch().then(setX) })`
  on mount.
- `components/upload-card-client.tsx` — the interactive client half:
  plan picker (with "Create demo plan" → POST /api/plans), file
  picker, kind select, Upload button, result card showing
  `file_id` / `sha256` / `created` flag / `audit_log_id`.
- `app/page.tsx` — added `export const dynamic = "force-dynamic"`.
  Without this, Next.js 16 prerenders `/` at build time and visitors
  see a stale plan list (also: the build itself tries to call
  Supabase from the build host).

E2E results (against launchpad-dev, exercised via `curl` in Phase 6):

| Case                                  | Result                            |
|---------------------------------------|-----------------------------------|
| `POST /api/plans` happy               | 201 + plan row                    |
| `POST /api/upload` first upload       | 201 + file row + storage object   |
| `POST /api/upload` re-upload (same)   | 200 + same file id, `created:false`, new audit row tagged `FILE_UPLOAD_DEDUPED` |
| `POST /api/upload kind=plan_pdf`      | 400 (kind enum rejects it)        |
| `POST /api/upload` missing `file`     | 400 with `invalid_request`        |
| `POST /api/upload` bad `plan_id`      | 400 with structured Zod issues    |
| `POST /api/plans` missing employer    | 400 with structured Zod issues    |
| `GET /api/health`                     | 200 (still probes `audit_logs`)   |
| `GET /api/plans`                      | 200, returns the 1 row created    |

Storage object verified at
`plans/{plan_id}/{file_id}/phase6-test.csv` via the Storage REST API.
Audit rows for the file id show both `FILE_UPLOADED` and
`FILE_UPLOAD_DEDUPED` entries.

### 4.10 Phase 7 — Plan Extraction Agent (uncommitted, see §3)

The first end-to-end agent. Uploads a 401(k) Summary Plan Description
PDF, hands it to Claude with a tool-use loop, and writes the resulting
fields back to the `plans` row with `extraction_status='in_review'`
for a human to approve.

**New modules:**

- `lib/server/plan-extraction.ts` — single source of truth for the
  extracted-fields shape. Exports both a `extractedPlanFieldsSchema`
  (Zod, for server-side validation) and an
  `extractedPlanFieldsJsonSchema` (hand-rolled JSON Schema, for the
  Anthropic `tools[].input_schema`). They are intentionally
  hand-mirrored rather than auto-derived so a field-add shows up in
  one diff for both sides.
- `lib/server/agents/skills.ts` — `loadSkill(name)`. Reads
  `skills/<name>/SKILL.md` at request time (cached per-process). The
  whole markdown file IS the system prompt — no front-matter, no
  templating. Edit the markdown to tune the agent without code
  changes; restart `next dev` to pick up edits.
- `lib/server/agents/run.ts` — `runAgent({skill, tool_names,
  user_message, actor_name, ...})`. Reusable Claude tool-use loop:
  load the skill, hand Claude a fixed tool set, loop until
  `stop_reason !== 'tool_use'` OR `max_iterations` (default 8).
  Returns `{stop_reason, iterations, final_content, tool_calls[]}`
  where each `tool_calls[]` entry has `{input, result: {ok, data|error}}`
  — the route handler mirrors that into a structured audit trail
  and the UI renders it as an agent timeline.
- `lib/server/tools/registry.ts` — typed registry of tools Claude
  may call. Each entry pairs JSON Schema (for the model), Zod (for
  re-validating model output before any side effect), and an async
  handler. First two tools shipped:
  - `save_plan_details(plan_id, extracted_fields, reason)` → calls
    `updateExtractedFields(...)` and writes a
    `PLAN_DETAILS_EXTRACTED` audit row with the agent's
    contradictions-resolved summary in `reason`. Always sets
    `extraction_status='in_review'`; never `'approved'` (humans
    own that flip).
  - `write_audit_log(action, ...)` — thin wrapper around the
    universal `writeAuditLog`, with `actor_type/actor_name` forced
    to `agent` / the runner-supplied name so the model can't forge
    attribution. For observations that don't fit another tool's
    payload.
- `lib/server/storage.ts#downloadFileBytes(file_id)` — pulls raw
  bytes from Storage server-side (for handing to other APIs that
  shouldn't go through the browser).

**New routes:**

- `POST /api/plans/[id]/extract` (`maxDuration = 60` — Claude + PDF
  round-trip can take 20-30 s). Body: `{file_id}`. Validates that
  the file is a `plan_pdf` belonging to the plan, downloads bytes,
  base64-encodes them, runs the agent. If the agent stops without
  ever calling `save_plan_details`, writes a `PLAN_EXTRACTION_FAILED`
  audit row and returns 500 + the full `tool_calls` log so the
  operator can see what happened.
- `/api/upload` — `kind=plan_pdf` is now allowed (Phase 6 had
  temporarily blocked it). Two-step on purpose: upload puts bytes in
  Storage, extraction is a separate call.

**New UI:**

- `app/plans/[id]/page.tsx` — Server Component, loads plan + files
  via `getPlan` / `listFilesForPlan`, renders
  `<PlanDetailClient ... />`. Returns 404 via `notFound()` for
  unknown plan ids.
- `components/plan-detail-client.tsx` — header with status badge,
  Files list (with "Run extraction" button on every `plan_pdf`),
  extracted-fields table, and a per-iteration tool-call timeline
  (collapsible details) showing exactly what the agent did.
- `components/upload-card-client.tsx` — gained `plan_pdf` in the
  kind dropdown, content-type-aware file accept attribute (.pdf vs
  .csv based on selected kind), and an "Open plan detail →" link in
  the upload-result card.

**Skill:** `skills/plan-extraction/SKILL.md` — field schema (24
fields), conflict-resolution rules (EIN typo, summary-vs-formula
match, pending-amendment date, false Safe Harbor language, 3-months
vs 90-days equivalence, loans fine print), output contract ("emit
exactly one save_plan_details tool call, then stop").

**E2E result (mock-plan-document.pdf vs expected-extracted-plan-data.json):**

| Aspect | Expected | Got | Notes |
|---|---|---|---|
| All 23 fields | filled per `expected-extracted-plan-data.json` | match | including `null`s where the document doesn't say |
| EIN typo | `12-3456789` (Section 1 wins) | ✓ | back-page `12-3456798` ignored |
| Match formula | `100% of first 3% + 50% of next 2%` | ✓ | summary table's "Up to 6%" ignored |
| `max_match_percentage` | `4%` | ✓ | computed from the formula, not from the table |
| Pending 4% deferral | reported as 3% (current) | ✓ | 2027 amendment ignored |
| Safe Harbor | `false` | ✓ | "Safe Harbor matching practices" language not misleading |
| Loans fine print | `1` outstanding + `$50,000` cap | ✓ | both captured |
| Stop / iterations | `end_turn` after 2 turns | ✓ | single `save_plan_details` call |
| Audit rows | `PLAN_CREATED` + `PLAN_DETAILS_EXTRACTED` | ✓ | reason captures every contradiction resolved |

Negative cases also verified: unknown plan id → 404, unknown plan id
on extract → 404, bad file_id uuid → 400 with Zod issue, missing body
→ 400 with Zod issue.

**Model + cost note:** `runAgent` defaults to `claude-sonnet-4-5`. The
demo extraction used ~one PDF input + one tool call ≈ a couple cents
per run on Sonnet 4.5. Swap to a cheaper model by passing `model:`
when this stops being acceptable for the demo budget.

---

## 5. Schema design — quick reference

All money is `numeric(12,2)`. All rates are `numeric(5,4)` (0.0500 = 5%).
All status/category/severity columns are TEXT + CHECK (so values can
evolve via a single ALTER constraint, unlike Postgres enums). RLS is
enabled on every table; the service role bypasses, anon is denied by
default.

| Table | Purpose | Key constraints |
|---|---|---|
| `audit_logs` | Append-only ledger of every user / agent / system action | CHECK actor_type, indexes on timestamp DESC, entity, payroll_run, actor |
| `plans` | One row per onboarding (created on first plan PDF upload) | status: draft/in_review/active/archived |
| `files` | Upload manifest | `(plan_id, checksum_sha256)` unique → idempotent re-uploads |
| `participants` | Normalized census | `(plan_id, employee_id)` unique, `(plan_id, participant_id)` unique |
| `payroll_mappings` | Approved column→field mapping | status: pending/approved/superseded; new versions inserted, not UPDATEd |
| `payroll_runs` | One row per uploaded payroll CSV | status: uploaded/mapped/validated/reconciled/failed |
| `payroll_records` | One row per CSV line | `raw_data jsonb` preserves the original; `(run_id, row_number)` unique |
| `reconciliation_issues` | Detected problems | category: data_quality / contribution / participant_match / roster_drift |
| `suggested_fixes` | Human-in-the-loop fix proposals | status: pending/approved/rejected/applied/failed; DB-level CHECKs enforce decision metadata at each transition |

The four `reconciliation_issues.category` values map 1:1 to the planted
error families in the demo payroll CSVs (see §6.5).

---

## 6. Architectural decisions already made (don't re-litigate without reason)

### 6.1 No MCP SDK for MVP
We do not depend on `@modelcontextprotocol/sdk`. The deployment guide's
own architecture section recommends an in-process tool registry called
from Route Handlers because Vercel serverless cannot host a long-running
stdio MCP server cleanly. Anthropic's own `tools` parameter on the
Messages API handles "Claude calls our TypeScript functions" without
MCP. Add the SDK only if we ever (a) expose tools to Claude Desktop or
another MCP client, or (b) host an external MCP server we want to call
as a client.

### 6.2 Sensitive env vars cannot be pulled to `.env.local`
`SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` are flagged
**Sensitive** in Vercel. `vercel env pull --environment=preview .env.local`
brings down the two `NEXT_PUBLIC_*` vars but leaves the secrets blank.
This is correct security behavior — Sensitive vars are write-only after
creation. To run locally, the developer must paste these two values into
`.env.local` from the Supabase dashboard (launchpad-dev project) and
the Anthropic console. **Never paste the launchpad-prod service role
key locally** — that is the single biggest "you cannot recover from
this at 2am" risk.

We chose this short-term workaround (paste manually) with an
explicit plan to migrate to a secrets manager (Doppler, 1Password CLI)
when (a) a second developer joins or (b) real participant data ever
touches the app. Both events should also trigger rotation of every
secret currently in `.env.local`.

### 6.3 Strict env validation at module load
`lib/server/env.ts` calls `schema.safeParse(process.env)` at import
time and throws on failure. This means **the build fails immediately
if any required var is missing or empty**. Vercel builds are safe
(the platform injects values before build), but local builds require
a populated `.env.local`. This is the desired behavior — silent
fall-through on missing env is how production outages happen.

### 6.4 The Acme plan is NOT seeded; the app creates it on first PDF upload
There is intentionally no `INSERT INTO plans` in the migrations. The
Plan Extraction Agent's first job is to write that row. This mirrors
the real onboarding flow (user uploads a PDF → system creates the
plan record).

### 6.5 Reconciliation error categories are calibrated to the demo CSVs
The user shared 6 files at
`/Users/davidsarmiento/Downloads/AI Training Program/files needed/`.
Their structure drove `reconciliation_issues.category`:

- `participant-census.csv` (30 rows, 14 cols) — the "truth" roster.
  Two parallel IDs (`P0001` and `E001`). Rates as `"5%"` strings.
- `payroll_run_01_mapping_clean.csv` — clean baseline (25 rows). Uses
  a totally different column naming convention (`Emp ID`, `401k Pre Tax`,
  `Roth Amount`, `ER Match`, `Loan Repay`, `Status`) — this is the
  Module 4 mapping challenge.
- `payroll_run_02_data_quality_errors.csv` — blanks, malformed email,
  non-ISO date `5/1/26`, blank Status, **duplicate row** for E012.
  → `category = 'data_quality'`.
- `payroll_run_03_contribution_errors.csv` — amounts inconsistent with
  census rates (e.g., $1250 Roth where census says 0%; $2900 pre-tax
  on $2769 wages; negative -$89.24 contribution).
  → `category = 'contribution'`.
- `payroll_run_04_participant_reconciliation_errors.csv` — first-name
  drift (Mary vs Maria), wrong ID (E107 for E007), email drift, missing
  employees, status mismatches, **new employee not in census**.
  → `category = 'participant_match'` and `'roster_drift'`.
- `payroll_run_05_complex_reconciliation.csv` — combination of all
  above + another new employee.

All payroll CSVs share the wire format `Emp ID, First, Last, Work
Email, Pay Date, Gross Wages, 401k Pre Tax, Roth Amount, ER Match,
Loan Repay, Status`. Mapping JSON for `payroll_mappings.mapping`
will look like:

```json
{
  "Emp ID": "employee_id",
  "First": "first_name",
  "Last": "last_name",
  "Work Email": "email",
  "Pay Date": "pay_date",
  "Gross Wages": "gross_wages",
  "401k Pre Tax": "pretax_deferral_amount",
  "Roth Amount": "roth_amount",
  "ER Match": "employer_match",
  "Loan Repay": "loan_repayment",
  "Status": "employment_status_in_run"
}
```

The plan PDF has not been shared yet, so `plans.extracted_fields` is a
typed-loose `jsonb`. Tighten its schema once the PDF lands.

### 6.6 `form` shadcn component is not installed
In the `base-nova` registry it's an empty stub. When a real form is
needed, either use `react-hook-form` directly or pull the default-style
form by URL: `npx shadcn@latest add https://ui.shadcn.com/r/styles/default/form.json`.

---

## 7. Immediate next steps

### 7.1 Apply the two migrations to launchpad-dev (DONE)
`supabase login` + `supabase link --project-ref zlrstvvepnrqssupwjzm`
+ `supabase db push` was run. Both migrations applied successfully.
`/api/health` was switched to probe `audit_logs` and verified locally.
No further action.

### 7.2 Apply migrations to launchpad-prod (BEFORE demo day, not now)
Same flow against the prod project ref. Do this only after the prod
schema review is signed off — once a table exists in prod, adding a
NOT NULL column or dropping a column is painful.

### 7.3 Phase 5 — typed data access layer (DONE, NOT YET COMMITTED)
See §4.8 for the modules that landed: `errors.ts`, `audit-log.ts`,
`plans.ts`, `files.ts`, `participants.ts`. Lint + build are clean.

Things deliberately deferred to later phases (don't add them yet):
- `payroll_mappings.ts`, `payroll_runs.ts`, `payroll_records.ts`,
  `reconciliation_issues.ts`, `suggested_fixes.ts` — wait until
  Phases 6/7 actually need them so the API shape can be designed
  against a real call site.
- A generic "list audit logs for entity X" helper — already covered
  by `listAuditLogs({entity_type, entity_id})`.
- A shared `RouteHandlerError → Response` translator. Each route can
  do its own `try/catch` for now; pull it into `lib/server/http.ts`
  once a second route needs the same shape.

### 7.4 Phase 6 — file upload + Supabase Storage (DONE, NOT YET COMMITTED)
See §4.9 for what shipped. Bucket migration applied to launchpad-dev;
upload route exercised end-to-end including the dedupe path. The
`UploadCard` on the home page is the visible demo surface.

Carry-over reminders before Phase 7:
- The `launchpad-prod` Supabase project has **none of the three**
  migrations applied. Apply them together when prod is ready (§7.2).
- The Phase 7 PDF flow needs to bootstrap a `plans` row, so it gets
  its own endpoint (suggested: `POST /api/plans/from-pdf` or a
  multipart `POST /api/plans` that detects a file field). Until then,
  use the existing `POST /api/plans` + `POST /api/upload` two-step.

### 7.5 Phase 7 — Plan Extraction Agent (DONE, NOT YET COMMITTED)
See §4.10 for what shipped. End-to-end works against the real Acme
PDF; all four planted gotchas handled correctly. Skill file is the
prompt; tweak `skills/plan-extraction/SKILL.md` to iterate.

### 7.6 Phase 7.5 — Plan approval flow (small follow-up to Phase 7)
The agent leaves the row at `extraction_status='in_review'`. There is
intentionally no UI yet to (a) edit a field the agent got wrong or
(b) flip the row to `'approved'` / `'failed'`. Build that next so the
human-in-the-loop story is complete:

1. Add `lib/server/plans.ts#approveExtractedFields(id, {fields,
   reason, approver_name})` — updates the row to
   `extraction_status='approved'`, writes a `PLAN_DETAILS_APPROVED`
   audit row whose `before_value` is the agent's snapshot and
   `after_value` is the human's (so any edits show up as a diff).
   Symmetrical `rejectExtractedFields(...)` flips to `'failed'`.
2. Add `PATCH /api/plans/[id]/extracted-fields` for approval and
   `POST /api/plans/[id]/extracted-fields/reject` for rejection.
3. In `plan-detail-client.tsx`, swap the read-only table for inline
   editable cells when `extraction_status === 'in_review'`, and add
   Approve / Reject buttons. After approval, also flip `plans.status`
   to `'active'` (or `'in_review'` if the rest of onboarding still
   has open items).

### 7.7 Phase 8 — Participant Import Agent (NEXT-NEXT)
Now that the agent pattern is proven, repeat it for the participant
census CSV:

1. New skill: `skills/participant-import/SKILL.md`.
   Inputs: the CSV bytes + the existing `participant-census.csv`
   structure. Outputs: an array of normalized participant rows.
2. New tools: `save_participants` (wraps `importParticipants`),
   `flag_participant_issue` (writes a `data_quality`
   reconciliation_issues row for things like malformed emails the
   agent spotted in the census itself).
3. New route: `POST /api/plans/[id]/participants/import` taking a
   `file_id` of an already-uploaded `participant_census` file.
4. UI: extend `plan-detail-client.tsx` with a "Run import" button
   next to participant_census files, and a participant table below.

Watch-outs from the demo CSVs:
- Rates come in as `"5%"` strings; the CSV parser (not the data
  layer) converts to `0.05`. The agent should do the conversion in
  its `save_participants` payload, NOT ask the tool to do it.
- The natural key is `(plan_id, employee_id)` — `importParticipants`
  is already an upsert on that key, so re-running the import after a
  fix is safe.

### 7.8 Phase 9 — remaining agents
Payroll Mapping → Payroll Reconciliation → Onboarding Assistant.
Each adds tools to the registry; reuse skills where they overlap.

### 7.6 Phase 8 — remaining agents
After the Plan Extraction Agent ships end to end, repeat the pattern
for: Participant Import → Payroll Mapping → Payroll Reconciliation →
Onboarding Assistant. Each adds tools to the registry; reuse skills
where they overlap (e.g., `skills/audit-logging/SKILL.md` is shared
by all).

### 7.7 Eventually: production deploy alignment
- Reconnect GitHub in the Vercel dashboard so pushes auto-deploy.
- Apply migrations to launchpad-prod.
- Run the smoke tests from
  [docs/deployment-and-production-readiness.md §End-To-End Pre-Launch Checklist](deployment-and-production-readiness.md).
- Turn off Vercel deployment protection if the demo URL should be
  publicly accessible.

---

## 8. Open questions waiting on user input

1. **Authentication**: the MVP does not require auth. Should the
   production demo URL be (a) wide open, (b) gated by a shared password
   in env, or (c) gated by Supabase Auth?
2. **Plan PDF**: ~~not yet shared~~ — resolved. The Acme PDF lives at
   `~/Downloads/AI Training Program/files needed/mock-plan-document.pdf`
   (with `expected-extracted-plan-data.json` as the answer key). The
   24-field shape is now codified in
   `lib/server/plan-extraction.ts` (Zod + JSON Schema, hand-mirrored).
   We kept `plans.extracted_fields` as `jsonb` rather than promoting
   to named columns; revisit if the schema stabilizes across plans.
3. **MCP transport**: is there any scenario where LaunchPad AI tools
   need to be callable from outside the Next.js process (e.g., a
   separate Claude Desktop session)? If yes, reverse §6.1 and add the
   MCP SDK.
4. **Apply suggested-fix semantics**: when the user approves a
   `suggested_fixes` row, does the system apply (a) just the named
   field change, or (b) a batch of related changes recorded in
   `proposed_changes`? The deployment doc flags this as TBD.

---

## 9. Verification checklist for an incoming agent

Before writing any code, confirm:

- [ ] `git status` is clean (or only contains the Phase 5 files from
      §4.8 if not yet committed) and you are on `main`.
- [ ] `git log --oneline -5` matches §3.
- [ ] `npm install` completes without error.
- [ ] `.env.local` contains all four required keys
      (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`). Get the
      service-role key from launchpad-dev's Supabase dashboard, NOT
      launchpad-prod.
- [ ] `npm run lint` is clean.
- [ ] `npm run build` is clean (proves env is correctly set).
- [ ] `npm run dev` starts on http://localhost:3000. (On a sandboxed
      host where `os.networkInterfaces()` fails, pass
      `-- --hostname 127.0.0.1 --port 3000`.)
- [ ] Clicking **Say hi** on the home page returns "API responded: hi".
- [ ] `curl http://localhost:3000/api/health | jq` shows
      `{"status":"ok", "checks":{"supabase":{"status":"ok",...}}}`
      (the supabase check now probes `audit_logs`, so a 200 also
      proves migrations are applied).
- [ ] In Supabase dashboard → Table Editor, all 9 tables from §5 exist.
- [ ] In Supabase dashboard → Storage, the `launchpad-files` bucket
      exists, is private, and has a 50 MiB size limit.
- [ ] The home page Upload card lets you (a) create a demo plan,
      (b) upload a small CSV, and (c) re-upload the same CSV and see
      a `deduped` badge with the same `file_id` but a new
      `audit_log_id`.
- [ ] On the plan-detail page (`/plans/{id}`), uploading
      `mock-plan-document.pdf` as `plan_pdf` and clicking
      **Run extraction** results in `extraction_status='in_review'`
      with all 23 fields populated and a Latest-agent-run card
      showing `save_plan_details` with `ok` badge in iteration 1.
- [ ] `audit_logs` for that plan contains a `PLAN_CREATED` row
      followed by a `PLAN_DETAILS_EXTRACTED` row whose `reason`
      mentions the EIN typo and the 6%/4% match contradiction.

---

## 10. Hard rules — do not break

1. **Agents never silently change data.** Every data mutation must be
   user-approved and must write an `audit_logs` row.
2. **No service-role or Anthropic keys in client code.** Anything in
   `lib/server/` already enforces this with `import "server-only"`.
   Don't add `NEXT_PUBLIC_` prefix to any secret.
3. **Local `.env.local` uses launchpad-dev only.** The prod service
   role key lives in Vercel Production and nowhere else.
4. **Migrations are append-only and committed before applied.** Never
   edit a migration that has been pushed to `main`; write a new one.
5. **Read `node_modules/next/dist/docs/` before writing Next.js code.**
   This is Next.js 16; many APIs differ from training data. See
   [AGENTS.md](../AGENTS.md).
