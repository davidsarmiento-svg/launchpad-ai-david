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

### 1.1 Training brief coverage

Yes: the implementation plan follows the original training brief. The
work is intentionally phased around the 8 dashboard modules, 5 agents,
MVP demo flow, and later stretch goals. Current status:

| Training module | Current status | Notes |
|---|---|---|
| Onboarding Home | **Partial** | Home page can create/list plans and upload files, but still needs a true onboarding status overview / dashboard metrics. |
| Plan Details | **MVP done** | PDF upload, Plan Extraction Agent, extracted-field review/edit, approve/reject, and audit rows are implemented. |
| Participant Data | **MVP done** | Census upload/import is implemented; normalized participants render in the plan detail UI. Census data-quality issues currently live in `audit_logs`. |
| Payroll Mapping | **MVP done** | Run 1 mapping agent proposes a mapping; user approves; later matching runs auto-apply the approved mapping. |
| Payroll Runs | **MVP done** | All 5 demo runs upload + auto-map + reconcile end-to-end. |
| Reconciliation Issues | **MVP done (uncommitted)** | Phase 9.1 runner/routes/UI all live; verified end-to-end across all 5 demo CSVs with deterministic safety nets in the runner + boundary guard against self-contradicting issues. See §4.14. |
| Change Logs / Audit Trail | **Partial** | Audit writes are broad and consistent; `listAuditLogs` exists. A dedicated chronological Audit Trail UI is still needed for demo completeness. |
| AI Onboarding Assistant | **Not started** | Planned as Phase 9.2 after reconciliation; will reuse the existing tool registry and data-access layer. |

Agent coverage:

| Agent | Current status | Notes |
|---|---|---|
| Plan Extraction Agent | **Done** | Uses `skills/plan-extraction/SKILL.md`, Claude tool loop, and audited save path. |
| Payroll Mapping Agent | **Done** | Uses `skills/payroll-mapping/SKILL.md`, proposes pending mappings, and requires user approval. |
| Participant Import Agent | **Done** | Uses `skills/participant-import/SKILL.md`; imports normalized participants and flags census issues into audit logs. |
| Payroll Reconciliation Agent | **MVP done (uncommitted)** | Live across all 5 demo runs. Runner does deterministic pre-checks (DUPLICATE_PAY_PERIOD; pre-computed `expected_pretax` / `expected_roth` / `expected_employer_match` per record) before invoking Claude. Tool handler refuses self-contradicting issue proposals at the boundary. See §4.14. |
| Onboarding Assistant Agent | **Not started** | Build last, after reconciliation issues and audit trail are stable. |

MVP coverage:

| Required MVP item | Status |
|---|---|
| Upload plan document and extract basic plan fields | **Done** |
| Upload participant CSV and save normalized records | **Done** |
| Upload Payroll Run 1 and approve column mapping | **Done** |
| Upload Payroll Run 2 and detect basic errors | **Done** — all 5 expected data_quality codes fire (MISSING_EMPLOYEE_ID, MALFORMED_EMAIL, MISSING_GROSS_WAGES, BLANK_EMPLOYMENT_STATUS, DUPLICATE_ROW). |
| Display reconciliation issues with suggested fixes | **Done** — `ReconciliationIssuesCard` renders open + resolved issues with inline Approve / Reject / Mark resolved / Ignore controls. |
| User approval gate before any fix is applied | **Done** — `PATCH /suggested-fixes/[id]` atomically approves + applies under optimistic concurrency; agent never writes to data tables. Verified across `payroll_record.update` (Runs 2/4) and `participant.create_from_payroll` (Run 4 E031). |
| Audit log visible in the dashboard | **Partial**; data layer exists, dedicated UI still missing |
| AI assistant that answers basic questions using tools | **Not started** |

Stretch goals stay secondary:

- Runs 3-5 reconciliation: now covered by Phase 9.1; improve recall
  and false-positive control before treating it as more than demo-ready.
- Home-page charts/metrics: after the core demo path is reliable.
- Assistant chat history: after the assistant itself works.
- PDF export: last, only if the MVP is stable.

Demo-day success now depends on committing Phase 9.1, adding a visible
Audit Trail module, building the Onboarding Assistant, applying prod
migrations, and redeploying the current app to Vercel.

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
4. [supabase/migrations/](../supabase/migrations/) — four committed
   migrations plus the two Phase 9.1 worktree migrations.
5. [lib/server/env.ts](../lib/server/env.ts) — env var contract; if you
   add a server-required env var, add it here too.
6. [components.json](../components.json) — shadcn config (style is
   `base-nova`, base color `neutral`, alias `@/*`).

---

## 3. Current commit graph + worktree

```text
(HEAD)  Phase 9.1: Payroll Reconciliation Agent (UNCOMMITTED)
c8c8916 Phase 9.0: Payroll Mapping Agent
e858218 docs: update handoff for Phases 5/6/7/7.5/8 commits
3dda65a Phase 8: Participant Import Agent
ddaca3f Phase 7.5: extracted-fields approval flow
eb55f79 Phase 7: Plan Extraction Agent end-to-end with tool-use loop
bfca954 Phase 6: multipart upload + Supabase Storage with sha256 dedupe
f07b412 Phase 5: typed data access layer
1898058 Add domain schema migration for participants, payroll, and reconciliation
43ff54e Init Supabase + first migration for audit_logs
6a3d519 Server foundation: env validation, Supabase + Anthropic clients, /api/health
c4b7cdb Session 3 scaffold: UI kit, theme, hello API route, deployment guide
08d5864 Hello world
f01795d Initial scaffold: Next.js + shadcn
```

Branch `main` is **7 commits ahead** of `origin/main` at
https://github.com/davidsarmiento-svg/launchpad-ai-david — push when
ready. Phase 9.1 is present as unstaged/tracked edits plus untracked
new files in the worktree, but it is not yet committed (awaiting
explicit user sign-off; per CLAUDE.md, commits are explicit). All
committed phases have lint + build clean; Phase 9.1 was also verified
with `npm run build`, `npx tsc --noEmit`, and ReadLints clean during
the implementation session.

End-to-end signals against launchpad-dev:

- *Phase 6* — upload happy + dedupe verified via curl.
- *Phase 7* — extraction against `mock-plan-document.pdf` returns every
  expected field, catches all four planted gotchas, writes
  `PLAN_CREATED` + `PLAN_DETAILS_EXTRACTED` audit rows. See §4.10.
- *Phase 7.5* — approve happy path with a `default_deferral_rate
  3% → 4%` edit lands `extraction_status='approved'`,
  `plans.status='active'`, audit row's `before_value`/`after_value`
  carries the diff. Negative cases (404, 400 EIN regex, 400 empty
  reason, 409 already-approved) all return the right status. See §7.6.
- *Phase 8* — clean 30-row `participant-census.csv` import lands 30
  rows in `participants` (rates as decimals, ISO dates, boolean
  beneficiary), `PARTICIPANTS_IMPORTED` audit per run, idempotent
  re-run. Negative `wrong_file_kind` returns 400. See §7.7.
- *Phase 9.0* — Payroll Mapping Agent against the 3 demo CSVs:
  run 1 (`payroll_run_01_mapping_clean.csv`) flows through the agent
  path (`end_turn` after 2 iterations, single `propose_payroll_mapping`
  call, 25 records ingested on approval); runs 2 and 3 auto-apply the
  approved mapping with no agent call. All four 400/409 negatives
  return correct status. See §4.13.

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
  supabase, anthropic } }`. Probes Supabase via a HEAD/count query
  against `audit_logs` — proves URL + service-role key are correct
  and that the core schema is deployed, without burning Anthropic
  tokens. Returns 503 when Supabase is unreachable.

### 4.5 Supabase project + migrations (commits `43ff54e`, `1898058`, `bfca954`, Phase 9.0; Phase 9.1 worktree)
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
- Migration 3 — `supabase/migrations/20260522180000_payroll_mapping_rejected_status.sql`
  (Phase 9.0). Single-line `ALTER … CHECK` adds `'rejected'` to
  `payroll_mappings.status` so the Payroll Mapping Agent's pending
  proposals can be rejected with a reason without overloading the
  `'superseded'` semantic. Applied to launchpad-dev via
  `supabase db push --include-all` (the timestamp predates the
  already-applied `20260523000000_init_storage_bucket.sql`, so
  `--include-all` was required to insert out of historical order).
- Migration 4 — `supabase/migrations/20260523000000_init_storage_bucket.sql`
  (Phase 6 — created later than the migration filename suggests).
  Creates the private `launchpad-files` bucket (50 MiB cap). See §4.9.
- Migration 5 — `supabase/migrations/20260523120000_reconciliation_issues_plan_scope.sql`
  (Phase 9.1 worktree). Relaxes `reconciliation_issues.payroll_run_id`,
  adds `plan_id`, and adds a `CHECK` so every issue is scoped to either
  a payroll run or a plan.
- Migration 6 — `supabase/migrations/20260523140000_reconciliation_issues_related_issue.sql`
  (Phase 9.1 worktree). Adds `related_issue_id` for regression links
  between reconciliation issues.

### 4.6 Documentation
- [docs/deployment-and-production-readiness.md](deployment-and-production-readiness.md)
  — engineering plan and deployment/readiness rubric.
- This file.

### 4.7 Migrations applied to launchpad-dev (Phase 4 closeout)
- `supabase login` + `supabase link --project-ref zlrstvvepnrqssupwjzm`
  + `supabase db push` succeeded for the initial migrations. The later
  Phase 9.0 and 9.1 migrations were also applied to `launchpad-dev` as
  documented in §4.5 and §4.14. Prod is still **un-migrated**.
- `/api/health` now probes `audit_logs` via `select count(*)` (HEAD
  request) instead of `auth.admin.listUsers`. A 200 response now
  proves the schema is deployed, not just that the service-role key
  is valid. Verified locally with `curl 127.0.0.1:3000/api/health`
  → `{"status":"ok",...}`.

### 4.8 Phase 5 — typed data access layer (commit `f07b412`)
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

### 4.9 Phase 6 — file upload + Supabase Storage (commit `bfca954`)

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
  allowed as of Phase 7; during Phase 6 it was temporarily rejected
  while the PDF extraction flow was not built yet. Writes a
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

### 4.10 Phase 7 — Plan Extraction Agent (commit `eb55f79`)

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
| All 24 fields | filled per `expected-extracted-plan-data.json` | match | including `null`s where the document doesn't say |
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

### 4.13 Phase 9.0 — Payroll Mapping Agent (this commit)

Second agent + first one that auto-applies after first human approval.
Operator uploads a payroll CSV, clicks **Map run**, the agent proposes
a column→canonical-field mapping, operator approves (or rejects with a
reason), and the approval atomically ingests the run's
`payroll_records` rows. Subsequent CSVs with the same header columns
**auto-apply** the approved mapping — no agent call, no human gate.

**New schema migration:**

- `supabase/migrations/20260522180000_payroll_mapping_rejected_status.sql`
  — adds `'rejected'` to the `payroll_mappings.status` CHECK so reject
  doesn't have to overload `'superseded'`. Applied to launchpad-dev.

**New shared module** (no `server-only`, importable by client UI):

- `lib/server/payroll-mapping.ts` — single source of truth for the
  proposal shape. Exports `CANONICAL_PAYROLL_FIELDS` (11 names matching
  `payroll_records` columns 1:1), `payrollMappingProposalSchema` (Zod,
  canonical-keyed, value = CSV column or `null`),
  `payrollMappingProposalJsonSchema` (hand-mirrored JSON Schema for
  Claude's `tools[].input_schema`), `payrollMappingFieldUiHints` (used
  by the editable card), plus four helpers:
  `toStorageMapping(proposal)`, `fromStorageMapping(storage)`,
  `csvHeaderCoversMapping(header, storageMapping)`, and
  `applyMappingToRow(row, storageMapping)`. The DAL persists in
  storage shape (`{ csv_column: canonical }`); the agent + UI work in
  canonical-keyed shape; conversion happens at the boundary.

**New DAL** (both `server-only`):

- `lib/server/payroll-mappings.ts` — `proposeMapping`, `getMapping`,
  `getLatestApprovedMapping`, `getLatestPendingMappingForPlan`,
  `listMappingsForPlan`, `approveMapping`, `rejectMapping`. Approve
  clones the Phase 7.5 pattern: pre-read → `NotFoundError`/wrong-status
  `ConflictError`; atomic `.eq('id', id).eq('status', 'pending')`
  UPDATE → `'approved'` with `.maybeSingle()`; `!data` →
  `ConflictError`. Pre-step supersedes any prior `'approved'` row.
  **Two-step approve isn't transactional** — worst case is a brief
  window with two `'approved'` rows; demo-scoped, future RPC if real
  concurrency lands.
- `lib/server/payroll-runs.ts` — `createPayrollRun` (idempotent on
  `source_file_id`), `getPayrollRun`, `getPayrollRunByFileId`,
  `listPayrollRunsForPlan`, `applyMappingToRun`. `applyMappingToRun`
  bulk-upserts `payroll_records` on `(payroll_run_id, row_number)`
  then flips the run's `status: 'uploaded' → 'mapped'` atomically.
- `lib/server/payroll-ingest.ts` — shared `parseMoney`, `parseIsoDate`,
  `parseCsvHeaderAndRows`, `buildIngestRecord` helpers used by both
  the auto-apply branch of `/map` and the optional-ingest branch of
  `/payroll-mappings/[id]` approve.

**New tools in the registry:**

- `propose_payroll_mapping(plan_id, name, mapping, reason)` — INSERTs
  a `payroll_mappings` row at `status='pending'`, writes
  `PAYROLL_MAPPING_PROPOSED` audit. `suggested_by` is hard-locked to
  `ctx.actor_name` (the runner-supplied actor); the model cannot
  forge attribution.
- `flag_mapping_issue(source_file_id, csv_column, severity,
  issue_code, description, sample_values?, candidate_canonical_fields?)`
  — writes a `PAYROLL_MAPPING_ISSUE` audit row (`actor_type='agent'`
  locked). Mirrors `flag_participant_issue` from Phase 8 for
  ambiguous candidates, unknown columns, and missing required fields.

**Skill:** `skills/payroll-mapping/SKILL.md` — role, 11-row canonical
field table, conflict rules (null-don't-guess, more-specific candidate
wins, flag-don't-drop unknown columns, missing-required is `'high'`
severity, case-sensitive verbatim header copies), tool definitions,
output contract ("emit exactly one `propose_payroll_mapping`, then
zero+ `flag_mapping_issue`, then stop").

**New routes:**

- `POST /api/plans/[id]/payroll-runs/[run_id]/map` (`maxDuration=60`).
  Two paths in one route:
  1. **Auto-apply.** If `getLatestApprovedMapping(plan_id)` exists
     AND `csvHeaderCoversMapping(header, approved.mapping)` is true,
     skip the agent entirely. Translate rows via the approved mapping
     and `applyMappingToRun(...)`. Response: `{ auto_applied: true,
     mapping_id, mapping_name, record_count, run }`. Audit row
     `PAYROLL_RUN_MAPPED` with `actor_type='system'`.
  2. **Agent.** Else, run `runAgent({ skill: 'payroll-mapping' })`
     with the CSV header + first 5 data rows in a single text block.
     Default `max_tokens=4096` is fine — the tool input is an
     ~11-key scalar object, well under 1 KB. (Intentional contrast
     with Phase 8, where `save_participants` bulk input forces 16k.)
     Response: `{ auto_applied: false, mapping_id, stop_reason,
     iterations, tool_calls }`. Failure path: `PAYROLL_MAPPING_FAILED`
     audit + 500 with full `tool_calls` log.
  3. **409 short-circuit.** Before running the agent, the route
     returns 409 `pending_mapping_exists` if there's already a pending
     mapping for the plan — one pending proposal at a time per plan.
- `PATCH /api/plans/[id]/payroll-mappings/[mapping_id]` (approve).
  Body: `{ proposal?, approver_name, reason?, ingest_run_id? }`. Calls
  `approveMapping(...)`; if `ingest_run_id` is supplied AND that run
  is still `'uploaded'` AND its CSV header covers the approved
  mapping, the route also runs the deterministic ingest in the same
  request (couples approval to first ingest). Writes
  `PAYROLL_MAPPING_APPROVED` (+ optional `PAYROLL_RUN_MAPPED`) audit
  rows with `before` / `after` mapping payloads.
- `POST /api/plans/[id]/payroll-mappings/[mapping_id]/reject`. Body:
  `{ reviewer_name, reason }`. Reason is required (min length 1).
  Writes `PAYROLL_MAPPING_REJECTED` audit.

**Upload route extension:**

- `app/api/upload/route.ts` — when `kind='payroll_run'`, auto-creates
  the `payroll_runs` row at `status='uploaded'` via
  `createPayrollRun(...)` after the file lands in Storage. Response
  gains `payroll_run_id` + `payroll_run_created` fields. Writes
  `PAYROLL_RUN_CREATED` audit row when the run row is newly inserted.

**New UI** (additions to `components/plan-detail-client.tsx` +
`app/plans/[id]/page.tsx`):

- Server page now fetches `payrollRuns`, `pendingMapping`,
  `approvedMapping` in parallel via `Promise.all` and passes them to
  `<PlanDetailClient>`.
- `<PayrollRunsTable>` — `<Table>` of payroll runs with filename,
  uploaded date, status badge, current mapping name, record count,
  and **Map run** action (shown only for `status='uploaded'`).
- `<ProposedMappingCard>` — editable form (clone of
  `<ExtractedFieldsCard>`). One row per canonical field with a text
  `<Input>` for the CSV column name plus an inline "Not in CSV"
  checkbox (drives `null`). Includes an "Apply to run" dropdown
  listing uploaded-state runs (auto-selects the most recent). Approve
  posts PATCH with `ingest_run_id` so the same click that approves
  the mapping also ingests the run. Reject opens the standard
  shadcn `<Dialog>` requiring a reason. Remounts on a new mapping via
  `key={mapping.id}`.
- `<ApprovedMappingCard>` — read-only summary of the latest approved
  mapping with a `<details>` showing all 11 canonical → CSV column
  pairs.
- `<LatestRunCard>` gained a third `kind: 'map'` arm with two
  rendering modes: auto-applied (single-row "Auto-applied mapping
  {name} ({N} records ingested)" with a green badge, no tool_calls)
  and agent path (familiar per-iteration tool-call timeline plus a
  summary line of successful `propose_payroll_mapping` /
  `flag_mapping_issue` calls).

**Decision: one pending mapping per plan.** Avoids the operator
having to choose between competing pending proposals. If a proposal
is stale, reject it first; then re-run mapping to get a fresh
proposal.

**Decision: header coverage, not header equality.** `csvHeaderCoversMapping`
is true if every CSV-column key in the approved mapping appears in the
upload's header. Extra columns in the new CSV are ignored at ingest.
This matches the demo intent: all 5 payroll CSVs share the same wire
format, so all 5 auto-apply after the first approval. New columns in
a future payroll wouldn't break the path.

**Watch-out: actor_type='system'.** The auto-apply branch attributes
the `PAYROLL_RUN_MAPPED` audit to `actor_type='system'` (no human or
agent in the loop, just deterministic translation); the manual approve
+ ingest attributes the same action to `actor_type='user'` with
`actor_name = approver_name`. `actor_type='agent'` is reserved for
the propose step. Future dashboards that filter audits by actor should
expect three values, not two.

**Verification (against launchpad-dev, 3 demo CSVs, 9/9 PASS):**

| Case | Result |
|---|---|
| Upload `payroll_run_01_mapping_clean.csv` | 201; `files` row + `payroll_runs` row at status=uploaded; `payroll_run_created:true`; `PAYROLL_RUN_CREATED` audit |
| Map run 1 (no approved mapping yet) | 200; agent path; `end_turn` after 2 iterations; 1 `propose_payroll_mapping` ok:true; mapping at status=pending |
| Approve mapping with `ingest_run_id=run_1` | 200; mapping status=approved; 25 `payroll_records` rows; run status=mapped; `PAYROLL_MAPPING_APPROVED` + `PAYROLL_RUN_MAPPED` audit rows with before/after diff |
| Upload + map `payroll_run_02_data_quality_errors.csv` | 200; `auto_applied:true`; same mapping_id; 26 records ingested; no agent call |
| Upload + map `payroll_run_03_contribution_errors.csv` | 200; auto-applied; 25 records ingested |
| Re-map a `mapped` run | 409 `run_not_uploadable` |
| Approve already-approved mapping | 409 conflict |
| Reject with empty reason | 400 with Zod issue |
| Approve with proposal missing required `employee_id` | 400 (Zod runs before DAL status check) |

**Captured demo uuids** (for follow-up debug):

```
PLAN          = 2823bef0-c782-41bf-a368-8991c09e3b03
MAPPING_ID_1  = b0964e49-0172-41b0-9e07-757c7e38a19c   (approved)
RUN_ID_1      = 65f6c077-40a8-4908-b164-80e0bb8bf36a   (run_01, 25 rows)
RUN_ID_2      = d5f9232a-41da-48d7-a920-7581495c5989   (run_02, 26 rows)
RUN_ID_3      = ea519684-6400-43c7-83c5-d7b6752b36f7   (run_03, 25 rows)
```

**Historical deferred item, now resolved in Phase 9.1:** the
`reconciliation_issues` migration (relax `payroll_run_id` to nullable,
add optional `plan_id` + `CHECK`) from §7.7 landed as the Phase 9.1
worktree migration `20260523120000_reconciliation_issues_plan_scope.sql`.

### 4.14 Phase 9.1 — Payroll Reconciliation Agent (this worktree, UNCOMMITTED)

Reads mapped payroll records, compares them against the census +
plan + prior runs, persists `reconciliation_issues` with optional
`suggested_fixes`, and waits for human approval before any
data-table mutation. Implements the four detection categories the
demo CSVs target: `data_quality` (Run 2), `contribution` (Run 3),
and `participant_match` + `roster_drift` (Runs 4 & 5). Run-level
cross-run patterns such as `DUPLICATE_PAY_PERIOD` and
`REGRESSION_OF_PRIOR_ISSUE` are issue codes inside that same category
set, not a separate DB category. **Non-negotiable held end-to-end**:
the agent only writes to `reconciliation_issues` + `suggested_fixes`
(proposals); approving a fix in the UI runs the same DAL the agent
cannot reach, with `actor_type='user'` (approval) +
`actor_type='system'` (apply) audit rows.

**New schema migrations:**

- `supabase/migrations/20260523120000_reconciliation_issues_plan_scope.sql`
  — relaxes `reconciliation_issues.payroll_run_id` to nullable, adds
  `plan_id uuid` (FK to `plans`), adds `CHECK (payroll_run_id IS NOT
  NULL OR plan_id IS NOT NULL)`, plus an index on `(plan_id, status)`.
  This unblocks plan-scoped issues (already flagged in §7.7).
  Applied to launchpad-dev via REST API (sandbox-friendly path).
- `supabase/migrations/20260523140000_reconciliation_issues_related_issue.sql`
  — adds `related_issue_id uuid references reconciliation_issues(id) on
  delete set null` + index `idx_reconciliation_issues_related_issue`.
  Lets `REGRESSION_OF_PRIOR_ISSUE` rows link back to the prior-run
  issue they recur from. Applied to launchpad-dev.

**New shared module** (no `server-only`, importable by client UI):

- `lib/server/reconciliation.ts` (~660 lines) — single source of
  truth for the agent's output shape. Exports `RECONCILIATION_CATEGORIES`
  (4 values: `data_quality`, `contribution`, `participant_match`,
  `roster_drift`), `RECONCILIATION_ISSUE_CODES` (22 total, grouped by
  detection family), Zod schemas
  (`reconciliationIssueInputSchema`, `proposedChangesSchema`,
  `suggestedFixInputSchema`), hand-mirrored JSON schemas
  (`reconciliationIssueJsonSchema`, `suggestedFixJsonSchema`) for
  Claude tool input, `RECONCILIATION_TOLERANCES` constants (1 cent
  for money, 25 bps for rate-vs-amount), and helpers
  `expectedDeferralAmount(rate, gross)`,
  `canParseEmployerMatchFormula(matchFormulaText)`, and
  `expectedEmployerMatch({matchFormulaText, rate, gross})`. The match
  helper parses six common phrasings of "100% of first X%, 50% of
  next Y%" via a tolerant regex; returns null on unparseable text.
  Boundary verified: Acme 5%/$2000 → exactly 80.

**New DAL modules** (both `server-only`):

- `lib/server/reconciliation-issues.ts` — `createReconciliationIssue`,
  `getReconciliationIssue`, `listIssuesForRun`, `listIssuesForPlan`
  (paginated), `listPriorIssuesForPlan` (for runner context),
  `updateIssueStatus`, `setIssueStatusResolvedByApplier` (used by
  the fix-apply pipeline to atomically close an issue when its fix
  lands). Persists `related_issue_id` (Phase 9.1 column).
- `lib/server/suggested-fixes.ts` — `createSuggestedFix`,
  `getSuggestedFix`, `listSuggestedFixesForIssue`,
  `listSuggestedFixesForRun`, `approveSuggestedFix`,
  `rejectSuggestedFix`, `markSuggestedFixApplied`,
  `markSuggestedFixFailed`. Approve/reject/apply/fail are all
  atomic CHECK-constrained updates; `ConflictError` on wrong-status
  attempts.
- `lib/server/fix-appliers.ts` — type-discriminated apply pipeline
  with three handlers: `payroll_record.update`,
  `participant.create_from_payroll`, `participant.update`. Each
  re-reads the target row, compares to `proposed_changes.from` for
  **optimistic concurrency**, and bails with a structured
  `apply_failed` reason (`row_not_found`, `from_mismatch`, etc.) on
  drift. Writes a `FIELD_UPDATED` audit row per applied change with
  `before` / `after` values.
- `lib/server/payroll-runs.ts` (extension) — added
  `listPayrollRecordsForRun(payroll_run_id)`, ordered by
  `row_number`. Used by the runner to build the agent's per-record
  context payload.

**New tools in the registry** (`lib/server/tools/registry.ts`):

- `propose_reconciliation_issue(plan_id, payroll_run_id,
  payroll_record_id?, issue, suggested_fix?)` — inserts the issue
  at `status='open'` (and inline suggested fix at `status='pending'`
  when provided). Writes `ISSUE_CREATED` + optional `FIX_SUGGESTED`
  audit rows. `actor_type='agent'` is hard-locked. **Boundary
  guard**: before insert, the handler scans
  `input.issue.agent_explanation` for self-contradicting phrases
  ("no issue to emit", "does not trigger", "no drift detected",
  etc.); on match, returns `{ok:false, error:
  'self_contradicting_explanation: …'}` so the model can move on
  without polluting the DB. This is the last-line backstop for the
  skill's anti-pattern #9.
- `flag_reconciliation_observation(plan_id, payroll_run_id, code,
  description)` — for audit-only notes that don't rise to an issue
  (e.g., "Run 1 is clean, no exceptions detected"). Writes a
  `RECONCILIATION_OBSERVATION` audit row, no table mutation.

**New runner** (`lib/server/reconciliation-runner.ts`, ~520 lines):

Orchestrates a single reconciliation pass:

1. **Context gather**: loads plan + active participants (census) +
   current-run records + prior runs' YTD-summary records + prior
   unresolved issues for this plan. All in parallel via
   `Promise.all`.
2. **Per-record projection**: for each current-run record,
   pre-computes and injects `expected_pretax`,
   `expected_roth`, `expected_employer_match` (null when inputs
   are missing or the match formula is unparseable). This kills
   the entire class of agent-side math hallucination — the model
   reads expected values rather than computing them.
3. **System pre-checks (deterministic)**: before the agent runs,
   the runner detects `DUPLICATE_PAY_PERIOD` by exact-equality
   comparison of current vs prior run pay dates. Each match writes
   a `reconciliation_issues` row with `actor_type='system'`,
   `actor_name='reconciliation-runner'`, audit-trailed via
   `ISSUE_CREATED`. The created issues are passed to the agent as
   `system_detected_issues[]` so it does not duplicate them. The
   runner also writes an audit-only `RECONCILIATION_OBSERVATION`
   warning when a non-empty employer-match formula is present but
   unparseable, because that disables employer-match amount checks.
4. **Agent invocation**: runs the `payroll-reconciliation` skill
   with both `propose_reconciliation_issue` and
   `flag_reconciliation_observation` tools wired. `max_tokens`
   bumped to 16k (per the §7.7 watch-out on bulk-row tool input).
5. **Post-agent**: on `stop_reason='end_turn'`, atomically flips
   `payroll_runs.status: 'mapped' → 'reconciled'` and writes a
   `RECONCILIATION_COMPLETED` audit row with the issue count. On
   failure, writes `RECONCILIATION_FAILED` and leaves run status
   unchanged (operator can retry).

**New skill** (`skills/payroll-reconciliation/SKILL.md`, ~310 lines):

Documents the agent's role, the four detection categories with
per-code triggers, severities, and "when to fix" guidance,
tolerances, the two tools, anti-patterns (with #9 being the
self-contradiction rule the boundary guard enforces), and the
**pre-computed expected values** subsection ("use these; do NOT
compute them yourself") and the **system-detected issues**
subsection ("DUPLICATE_PAY_PERIOD is system-detected; do NOT
re-emit").

**New API routes:**

- `POST /api/plans/[id]/payroll-runs/[run_id]/reconcile`
  (`maxDuration=120`). Pre-flight: 404 unknown plan/run, 409
  `run_not_reconcilable` if status ≠ `'mapped'`. On success:
  returns `{stop_reason, iterations, final_status, issue_count,
  tool_calls}`. On runner exception: writes
  `RECONCILIATION_FAILED` audit and returns 500.
- `PATCH /api/plans/[id]/suggested-fixes/[fix_id]`. Atomically
  approves the fix (DAL throws `ConflictError` on wrong status →
  409), then immediately applies via the fix-appliers pipeline.
  On apply success: marks fix `applied`, marks parent issue
  `resolved`, audit rows `FIX_APPROVED` + `FIX_APPLIED`. On
  optimistic-concurrency mismatch: marks fix `failed`, audit row
  `FIX_APPLY_FAILED`, returns 200 with `{applied:false, reason}`
  (the row state is intentionally consistent — failed fixes are a
  recoverable workflow, not a 5xx).
- `POST /api/plans/[id]/suggested-fixes/[fix_id]/reject`. Body
  requires `reviewer_name` + `reason` (min length 1). Atomic
  update to `status='rejected'`; audit `FIX_REJECTED`.
- `PATCH /api/plans/[id]/reconciliation-issues/[issue_id]`. For
  issues without an inline fix (or whose fix the user wants to
  bypass). Allows manual `'resolved'` or `'ignored'`; audit rows
  `ISSUE_RESOLVED` / `ISSUE_IGNORED` with required reason.

**New UI** (`components/plan-detail-client.tsx` +
`app/plans/[id]/page.tsx`):

- Server page fetches `reconciliationIssues` (open + recently
  resolved) and `suggestedFixes` (pending) for the plan in
  parallel with the existing payroll-run / mapping queries.
- `<PayrollRunsTable>` gains a **Reconcile** button on
  `status='mapped'` rows.
- `<LatestRunCard>` gained a fourth `kind: 'reconcile'` arm that
  renders the agent's per-iteration tool-call timeline with
  per-issue resolution counts at the top.
- `<ReconciliationIssuesCard>` — new component grouped by status
  with inline Approve / Reject / Mark resolved / Ignore controls.
  Approve hits the PATCH route directly; rejects open a `<Dialog>`
  requiring a reason. Failed-apply rows expose the apply error
  inline.

**Decision: system-detected vs agent-detected, by category.**

| Category | Detected by |
|---|---|
| `data_quality` (Run 2) | Agent — model is great at pattern-spotting blanks / malformed strings / duplicates. |
| `contribution` (Run 3) | Agent — but consumes runner-injected `expected_*` fields (no agent-side math). |
| `participant_match` (Run 4) | Agent — requires fuzzy reasoning (name drift, email drift, ID typos). |
| `roster_drift` (Run 4/5, employee-scoped) | Agent. |
| `cross-run / DUPLICATE_PAY_PERIOD` (Run 5) | **System (runner pre-check)** — trivial exact-equality check; the agent kept missing it. |
| `cross-run / REGRESSION_OF_PRIOR_ISSUE` | Agent — requires "is this the same issue?" judgment. |

**Decision: tool-handler boundary guard for self-contradiction.**

The skill's anti-pattern #9 ("if your explanation says no issue,
don't emit") was honored ~60% of the time even after three prompt
iterations. We moved enforcement to the tool handler: the model
still gets the rule in the skill (for upstream behavior), but the
handler scans the explanation for a fixed phrase list and rejects
the insert with a clear tool-error message. Per the architecture
doc, this is consistent with "agents propose, system gates" — the
system now also gates whether a proposal is internally consistent
before persistence.

**Decision: `max_tokens=16000`.** Same rationale as Phase 8 — the
context payload is bulk-row JSON, often ~10 KB+. The default 4096
silently truncates with `stop_reason='max_tokens'` and an empty
tool-call log.

**Decision: `payroll_runs.pay_date` is inferred during ingest.**

`applyMappingToRun` now back-fills `payroll_runs.pay_date` from the
first parsed payroll record date while flipping the run to `mapped`.
This keeps both the manual mapping-approval ingest path and the
auto-apply path compatible with the DUPLICATE_PAY_PERIOD pre-check
without manual database patching. If a CSV has no parseable pay date,
the run-level date remains null and cross-run duplicate detection
will naturally no-op for that run.

**Verification (against launchpad-dev, all 5 demo CSVs):**

Final round results after deterministic safety nets + boundary
guard (issue counts vary per run due to expected agent
non-determinism; the assertions test code presence + absence, not
exact counts):

| Run | Codes verified present | Verified absent | Notes |
|---|---|---|---|
| 1 (clean) `65f6c077` | (none) | EMPLOYER_MATCH_WRONG_AMOUNT, MISSING_FROM_PAYROLL | 0 false positives; agent emits 1 `RECONCILIATION_OBSERVATION` audit-only note. Down from 4 false positives pre-safety-nets. |
| 2 (data_quality) `d5f9232a` | MISSING_EMPLOYEE_ID, MALFORMED_EMAIL, MISSING_GROSS_WAGES, BLANK_EMPLOYMENT_STATUS, DUPLICATE_ROW | — | All 5 expected codes; 0 false positives. |
| 3 (contribution) `ea519684` | RATE_AS_DOLLARS, CONTRIBUTION_EXCEEDS_GROSS, NEGATIVE_CONTRIBUTION, MATCH_WITHOUT_DEFERRAL | EMPLOYER_MATCH_WRONG_AMOUNT (false-positive class) | LOAN_REPAY_WITHOUT_LOAN missed this round (agent variability). |
| 4 (participant_match) `7007bce4` | IDENTITY_EMAIL_DRIFT, IDENTITY_NAME_DRIFT, EMPLOYEE_NOT_IN_CENSUS, TERMINATED_STILL_PAID, INELIGIBLE_PARTICIPANT_PAID, EMPLOYEE_ID_TYPO, MISSING_FROM_PAYROLL | — | All 4 demo-day-critical codes (E014/E031/E026/E030) fire. |
| 5 (complex) `8169eff7` | DUPLICATE_PAY_PERIOD (system), IDENTITY_NAME_DRIFT, EMPLOYEE_NOT_IN_CENSUS | — | DUPLICATE_PAY_PERIOD landed as a `actor_type='system'` ISSUE_CREATED row, confirming the deterministic pre-check works. 0 self-contradicting issues persisted (down from 4 pre-guard). |

Apply-pipeline E2E (also verified in earlier round):

| Case | Result |
|---|---|
| Approve `payroll_record.update` fix (Run 2 email correction) | 200; `applied:true`; row's email updated; FIX_APPROVED + FIX_APPLIED + FIELD_UPDATED audit chain; parent issue → `'resolved'` |
| Approve `participant.create_from_payroll` fix (E031 Cameron Reed) | 200; new participants row; same audit chain |
| Approve a fix whose `from` value has drifted | 200 with `{applied:false, reason:'from_mismatch'}`; fix status → `'failed'`; FIX_APPLY_FAILED audit (no silent overwrite) |
| Approve already-approved fix | 409 ConflictError |
| Reject with empty reason | 400 with Zod issue |
| Manually mark issue resolved (no fix) | 200; ISSUE_RESOLVED audit |

**Captured demo uuids** (in addition to Phase 9.0's):

```
RUN_ID_4      = 7007bce4-b5a1-4366-a6b6-a1e3f41073c2   (run_04, 26 rows)
RUN_ID_5      = 8169eff7-f6a8-42c4-b98f-660c4c541399   (run_05, 26 rows)
```

**Known limitations** (Phase 9.1 ships with these; iterate next):

1. Agent occasionally under-emits (Run 3 missed LOAN_REPAY_WITHOUT_LOAN
   this round). Recall is the dominant remaining quality vector.
2. `related_issue_id` is wired (schema, DAL, JSON Schema, Zod) but
   the agent rarely supplies it, even when its prose describes the
   linkage. Backfill via a post-pass or strengthen the skill again.
3. `EMPLOYER_MATCH_WRONG_AMOUNT` is only emittable when the runner
   could compute `expected_employer_match`. If the plan's
   `extracted_fields.employer_match` text is unparseable, the runner
   writes a `RECONCILIATION_OBSERVATION` audit row with
   `status='warning'` before invoking the agent. The check still
   no-ops for amount mismatches because the system cannot derive a
   trustworthy expected value.
4. `actor_type` audit rows in Phase 9.1 are now `agent` (issue
   proposals), `system` (DUPLICATE_PAY_PERIOD pre-check + every
   apply), or `user` (approve / reject / manual resolve). Any
   future dashboard that filters by actor must expect all three.

**Architecture-doc alignment** (training brief
`/Users/davidsarmiento/Downloads/AI Training Program/ATP/07-session-4-ai-architecture.md`):

The non-negotiable rule "agents never silently change data" is held
end-to-end. The 4-step audit flow (ISSUE_CREATED → FIX_SUGGESTED →
FIX_APPROVED → FIX_APPLIED) is implemented exactly as specified;
extended with FIX_REJECTED + FIX_APPLY_FAILED for failure paths.
Divergences from the doc that pre-date Phase 9.1: no custom MCP
server (see §6.1; we use Anthropic native tool-use instead), no
foundation skills (`api-endpoint-pattern`, `clean-code`, etc.), and
tool naming differs from the doc's `reconcile_payroll_run` /
`apply_approved_fix` conventions. These are intentional MVP
shortcuts; revisit if the project ever needs to expose tools to
external MCP clients.

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
| `reconciliation_issues` | Detected problems | category: data_quality / contribution / participant_match / roster_drift; `payroll_run_id` nullable + `plan_id` nullable + `CHECK (one-of)` (Phase 9.1); `related_issue_id` self-FK for regressions (Phase 9.1) |
| `suggested_fixes` | Human-in-the-loop fix proposals | status: pending/approved/rejected/applied/failed; DB-level CHECKs enforce decision metadata at each transition |

The four `reconciliation_issues.category` values map 1:1 to the
planted error families in the demo payroll CSVs (see §6.5). Cross-run
findings are represented as issue codes (`DUPLICATE_PAY_PERIOD`,
`REGRESSION_OF_PRIOR_ISSUE`) inside that same category model rather
than a fifth DB category.

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

The Acme plan PDF has landed at
`~/Downloads/AI Training Program/files needed/mock-plan-document.pdf`,
with `expected-extracted-plan-data.json` as the answer key. The
24-field shape is codified in `lib/server/plan-extraction.ts`, while
`plans.extracted_fields` remains `jsonb` so the table can tolerate
future plan-document variants without a migration for every field.

### 6.6 `form` shadcn component is not installed
In the `base-nova` registry it's an empty stub. When a real form is
needed, either use `react-hook-form` directly or pull the default-style
form by URL: `npx shadcn@latest add https://ui.shadcn.com/r/styles/default/form.json`.

---

## 7. Immediate next steps

### 7.1 Apply migrations to launchpad-dev (DONE)
`supabase login` + `supabase link --project-ref zlrstvvepnrqssupwjzm`
+ `supabase db push` was run for the committed migrations, and the
Phase 9.1 worktree migrations were applied later as documented in
§4.14. `/api/health` probes `audit_logs` and was verified locally.
No further dev-schema action unless a new migration is added.

### 7.2 Apply migrations to launchpad-prod (BEFORE demo day, not now)
Apply all six current migrations against the prod project ref. Do this
only after the prod schema review is signed off — once a table exists
in prod, adding a NOT NULL column or dropping a column is painful.

### 7.3 Phase 5 — typed data access layer (DONE, commit `f07b412`)
See §4.8 for the modules that landed: `errors.ts`, `audit-log.ts`,
`plans.ts`, `files.ts`, `participants.ts`. Lint + build are clean.

Historical deferrals from this phase are now mostly resolved:
`payroll_mappings.ts`, `payroll_runs.ts`, `reconciliation_issues.ts`,
`suggested_fixes.ts`, and `lib/server/http.ts` exist in later phases.
`listAuditLogs({entity_type, entity_id})` remains the generic audit-log
reader.

### 7.4 Phase 6 — file upload + Supabase Storage (DONE, commit `bfca954`)
See §4.9 for what shipped. Bucket migration applied to launchpad-dev;
upload route exercised end-to-end including the dedupe path. The
`UploadCard` on the home page is the visible demo surface.

Historical carry-over is resolved: Phase 7 added `plan_pdf` upload
support and `POST /api/plans/[id]/extract`. Prod migration work remains
covered by §7.2.

### 7.5 Phase 7 — Plan Extraction Agent (DONE, commit `eb55f79`)
See §4.10 for what shipped. End-to-end works against the real Acme
PDF; all four planted gotchas handled correctly. Skill file is the
prompt; tweak `skills/plan-extraction/SKILL.md` to iterate.

### 7.6 Phase 7.5 — Plan approval flow (DONE, commit `ddaca3f`)

Shipped. Operator can now edit the agent's extracted fields, approve
(→ `extraction_status='approved'`, `plans.status='active'`), or reject
with a required reason (→ `extraction_status='failed'`).

- `lib/server/plans.ts#approveExtractedFields` /
  `rejectExtractedFields` — atomic UPDATE filtered on
  `extraction_status='in_review'` so a stale tab can't double-flip.
  Re-runs `extractedPlanFieldsSchema` on the human edits.
- `lib/server/errors.ts` — `NotFoundError` + `ConflictError` subclasses
  of `DataLayerError`; `lib/server/http.ts` now translates them to 404
  / 409 (instance check ordering matters since they extend
  `DataLayerError`).
- `lib/server/plan-extraction.ts` — dropped `import "server-only"`
  (the schema is pure data + Zod; safe to import in client form). Added
  `extractedPlanFieldUiHints` map (`kind`/`nullable`/`hint` per field)
  so the UI rendering and the agent spec stay one diff away.
- `app/api/plans/[id]/extracted-fields/route.ts` (PATCH approve) and
  `.../reject/route.ts` (POST reject) — thin handlers that wrap the
  DAL and write audit rows with structured before/after pairs.
- `components/plan-detail-client.tsx` — `<ExtractedFieldsCard>` with
  type-aware inputs (text/textarea/number/integer/checkbox) when
  `in_review`, read-only otherwise. The card uses a `key` prop on the
  parent so a fresh extraction remounts the form (React-19-correct
  alternative to `setState`-in-`useEffect`). Reject button opens a
  `<Dialog>` requiring a reason.

Plan-status assumption: approve flips `plans.status` to `'active'`.
Today this is the only onboarding gate. Once Payroll Reconciliation
lands its own gates, revisit the docstring on
`approveExtractedFields` — it may need to land on `'in_review'`
instead until those gates also clear.

Verification:

| Case | Result |
|---|---|
| Approve happy (3% → 4% edit) | 200; status=approved, plans.status=active; audit before/after diff |
| Approve unknown plan id | 404 NotFoundError |
| Approve already-approved plan | 409 ConflictError |
| Approve with bad EIN regex | 400 with structured Zod issue |
| Reject with empty reason | 400 with structured Zod issue |

### 7.7 Phase 8 — Participant Import Agent (DONE, commit `3dda65a`)

Shipped. Reads a participant census CSV, normalizes (rates as decimals,
ISO dates, enum values, boolean beneficiary), upserts via
`importParticipants`. Census-time data-quality issues land in
`audit_logs` with `action=PARTICIPANT_DATA_QUALITY_ISSUE` —
deliberately **not** in `reconciliation_issues` (see decision below).

- `skills/participant-import/SKILL.md` — schema table cites
  `participantInputSchema`; conflict rules cover blank required
  fields, malformed emails, ambiguous bare-number rates, duplicate
  `(plan_id, employee_id)`, unknown enums, unparseable dates,
  beneficiary normalization.
- `lib/server/tools/registry.ts` — `save_participants` (extends
  `importParticipantsInputSchema` with optional `reason`, writes a
  `PARTICIPANTS_IMPORTED` audit row) and `flag_participant_issue`
  (structured `audit_logs` row with `field_name`, `employee_id`,
  `severity` → `status`, before/after carrying actual/expected). Both
  lock `actor_type=agent` with the runner-supplied `actor_name` so
  the model can't forge attribution.
- `app/api/plans/[id]/participants/import/route.ts` —
  `maxDuration=60`, `max_tokens=16000` (see watch-out below). Decodes
  CSV as UTF-8 text and embeds in a single text block (CSVs are text;
  no `document` attachment). Failure path mirrors the extract route:
  `PARTICIPANT_IMPORT_FAILED` audit + 500 with full `tool_calls`.
- `app/plans/[id]/page.tsx` + `components/plan-detail-client.tsx` —
  Run import button next to `participant_census` files (mirrors the
  `plan_pdf` button), unified `LatestRunCard` timeline that swaps
  between extract/import runs, and a Participants `<Table>` with
  formatted rate (`%`) and balance (currency) columns.

**Decision: census issues live in `audit_logs` only for now.**
Original plan called for `reconciliation_issues` rows but
`payroll_run_id NOT NULL` would force a schema migration. We chose
maximum optionality — keep census issues browsable via the audit
trail until Phase 9 builds the unified Issues tab and we know the
queries the UI will run. The deferred follow-up:

- New migration: relax `reconciliation_issues.payroll_run_id` to
  nullable, add optional `plan_id`, `CHECK (payroll_run_id IS NOT NULL
  OR plan_id IS NOT NULL)`. Then `flag_participant_issue` writes
  there alongside `audit_logs`.
- Backfill the census-issue audit rows we accumulated this phase into
  the new table (one-shot script, not a migration).

**Watch-out: agent `max_tokens` budget.** The route sets
`max_tokens: 16000` because `save_participants` for a 30-row census
already wants ~5k tokens of structured tool_use input plus reasoning.
The `runAgent` default of 4096 silently fails as
`stop_reason=max_tokens` with an empty `tool_calls` log; the failure
path correctly writes `PARTICIPANT_IMPORT_FAILED` so the operator
sees a useful breadcrumb. **Any future agent whose tool input is
bulk-row JSON should bump `max_tokens` at the route call site** —
the runAgent default is fine for scalar-output agents like plan
extraction. (Phase 9.0's Payroll Mapping Agent intentionally keeps
the default for the same reason: its `propose_payroll_mapping` tool
input is an ~11-key scalar object, well under 1 KB.)

Verification:

| Case | Result |
|---|---|
| Clean 30-row census, happy import | 200; 30 rows; 1 PARTICIPANTS_IMPORTED audit; 0 flags; end_turn after 2 iterations |
| Re-run same import | 200; count stays 30 (idempotent upsert); second audit row |
| `wrong_file_kind` (plan_pdf as census) | 400 |

### 7.8 Phase 9.0 — Payroll Mapping Agent (DONE, this commit)

Shipped. Full details in §4.13. Operator can upload a payroll CSV,
click **Map run**, review/edit/approve the agent's proposed mapping,
and the same approval click ingests the run's `payroll_records`.
Subsequent CSVs with matching headers auto-apply with no agent call.

### 7.9 Phase 9.1 — Payroll Reconciliation Agent (DONE, UNCOMMITTED)

Shipped. Full details in §4.14. End-to-end verified across all 5
demo CSVs with deterministic runner safety nets + boundary guard
against self-contradicting issue proposals. Both pre-requisite
migrations (`reconciliation_issues` nullable run + plan scope; and
`related_issue_id` self-FK) applied to launchpad-dev. The
follow-up to backfill existing `PARTICIPANT_DATA_QUALITY_ISSUE` /
`PAYROLL_MAPPING_ISSUE` audit rows into `reconciliation_issues` is
deferred until the Audit Trail / Issues UI requires it. Known
limitations enumerated in §4.14.

**Immediate carry-over before Phase 9.2:**

1. Apply both Phase 9.1 migrations to launchpad-prod before any
   prod reconciliation work.

### 7.10 Phase 9.2 — Onboarding Assistant (NEXT)

Conversational agent that walks the operator through the full
onboarding flow. Reuses skills, tools, and approval-card patterns
from Phases 7/7.5/8/9.0/9.1. Will introduce read-only tools
(`get_plan_details`, `get_participants`, `list_reconciliation_issues`,
`list_audit_logs`) so the assistant can answer "what changed?"
questions without mutating data. The non-negotiable rule from
§4.14 applies here too: even when the user asks the assistant to
"fix this", the assistant must surface a `suggested_fix` card and
wait for explicit approval before invoking the apply pipeline.

### 7.11 Eventually: production deploy alignment
- Reconnect GitHub in the Vercel dashboard so pushes auto-deploy.
- Commit Phase 9.1 if the current worktree is accepted.
- Apply migrations to launchpad-prod (now six: audit_logs, domain
  schema, storage bucket, payroll_mappings rejected status, Phase 9.1
  plan-scope issue migration, Phase 9.1 related-issue migration).
- Push the seven committed phases plus the Phase 9.1 commit to
  `origin/main` (`git push`) once ready.
- Run the smoke tests from
  [docs/deployment-and-production-readiness.md §End-To-End Pre-Launch Checklist](deployment-and-production-readiness.md).
- Turn off Vercel deployment protection if the demo URL should be
  publicly accessible.

---

## 8. Open questions and resolved decisions

Still open:

1. **Authentication**: the MVP does not require auth. Should the
   production demo URL be (a) wide open, (b) gated by a shared password
   in env, or (c) gated by Supabase Auth?
2. **MCP transport**: is there any scenario where LaunchPad AI tools
   need to be callable from outside the Next.js process (e.g., a
   separate Claude Desktop session)? If yes, reverse §6.1 and add the
   MCP SDK.

Resolved context:

1. **Plan PDF**: the Acme PDF lives at
   `~/Downloads/AI Training Program/files needed/mock-plan-document.pdf`
   (with `expected-extracted-plan-data.json` as the answer key). The
   24-field shape is now codified in
   `lib/server/plan-extraction.ts` (Zod + JSON Schema, hand-mirrored).
   We kept `plans.extracted_fields` as `jsonb` rather than promoting
   to named columns; revisit if the schema stabilizes across plans.
2. **Apply suggested-fix semantics**: resolved in Phase 9.1 as a
   discriminated `proposed_changes` payload. `*.update` fixes may apply
   one or more field changes in one atomic update; create-from-payroll
   fixes create one participant from one payroll row. The applier uses
   optimistic concurrency on every `from` value.

---

## 9. Verification checklist for an incoming agent

Before writing any code, confirm:

- [ ] `git status` is clean, or it contains only the documented Phase
      9.1 worktree files from §4.14 plus this handoff edit, and you are
      on `main`.
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
      with all 24 fields populated and a Latest-agent-run card
      showing `save_plan_details` with `ok` badge in iteration 1.
- [ ] `audit_logs` for that plan contains a `PLAN_CREATED` row
      followed by a `PLAN_DETAILS_EXTRACTED` row whose `reason`
      mentions the EIN typo and the 6%/4% match contradiction.
- [ ] On an approved plan, uploading `payroll_run_01_mapping_clean.csv`
      as `payroll_run` auto-creates a `payroll_runs` row; clicking
      **Map run** lands a pending mapping with all 11 canonical
      fields populated; approving with the suggested run selected
      flips the run to `status='mapped'` with 25 `payroll_records`.
- [ ] Re-uploading any subsequent payroll CSV with the same column
      shape and clicking **Map run** returns `auto_applied: true`
      with no agent call and no human gate.
- [ ] On each mapped payroll run, clicking **Reconcile** returns 200,
      leaves clean runs with no persisted false-positive issues, and
      creates the expected issue codes listed in §4.14 for Runs 2-5.
- [ ] Approving a pending suggested fix applies through the user/system
      audit chain (`FIX_APPROVED`, `FIX_APPLIED`, and `FIELD_UPDATED`
      when a field changes); rejecting requires a reason and writes
      `FIX_REJECTED`.

---

## 10. Hard rules — do not break

1. **Agents never silently change data.** Every data mutation must be
   user-approved and must write an `audit_logs` row.
2. **No service-role or Anthropic keys in client code.** Anything in
   `lib/server/` already enforces this with `import "server-only"`.
   Don't add `NEXT_PUBLIC_` prefix to any secret.
3. **Local `.env.local` uses launchpad-dev only.** The prod service
   role key lives in Vercel Production and nowhere else.
4. **Migrations are append-only.** Never edit a migration that has been
   pushed to `main`; write a new one. Apply migrations to prod only
   after they are committed. During active dev phases, any worktree
   migration applied to `launchpad-dev` must be called out in this
   handoff until committed.
5. **Read `node_modules/next/dist/docs/` before writing Next.js code.**
   This is Next.js 16; many APIs differ from training data. See
   [AGENTS.md](../AGENTS.md).
