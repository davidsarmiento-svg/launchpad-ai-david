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
(HEAD)  Phase 9.0: Payroll Mapping Agent
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
ready. All seven new commits have lint + build clean.

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
  supabase, anthropic } }`. Probes Supabase via
  `auth.admin.listUsers({ perPage: 1 })` — proves URL + service-role
  key are correct without burning Anthropic tokens. Returns 503 when
  Supabase is unreachable. **Update this to ping `audit_logs` after
  the migration is applied (§7.1).**

### 4.5 Supabase project + migrations (commits `43ff54e`, `1898058`, `bfca954`, Phase 9.0)
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

**Deferred:** the `reconciliation_issues` migration (relax
`payroll_run_id` to nullable, add optional `plan_id` + `CHECK`) from
§7.7 is still untouched. Phase 9.1 (Reconciliation) will need it.

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

### 7.9 Phase 9.1 — Payroll Reconciliation Agent (NEXT)

Per-row validation that consumes the `payroll_records` rows Phase 9.0
ingested. Categories per the demo CSVs in §6.5:
`data_quality` (Run 2), `contribution` (Run 3), `participant_match` +
`roster_drift` (Runs 4 and 5).

Pre-requisite: apply the deferred `reconciliation_issues` migration
described in §7.7 — relax `payroll_run_id` to nullable, add optional
`plan_id`, `CHECK (payroll_run_id IS NOT NULL OR plan_id IS NOT
NULL)`. After the migration lands, `flag_participant_issue` (Phase 8)
and `flag_mapping_issue` (Phase 9.0) can also write rows into
`reconciliation_issues` alongside their audit log entries, and a
one-shot script can backfill the existing `PARTICIPANT_DATA_QUALITY_ISSUE`
and `PAYROLL_MAPPING_ISSUE` audit rows.

### 7.10 Phase 9.2 — Onboarding Assistant
Conversational agent that walks the operator through the full
onboarding flow. Build last; will reuse the skills, tools, and
approval-card patterns from Phases 7/7.5/8/9.0/9.1.

### 7.11 Eventually: production deploy alignment
- Reconnect GitHub in the Vercel dashboard so pushes auto-deploy.
- Apply migrations to launchpad-prod (now four: audit_logs, domain
  schema, storage bucket, payroll_mappings rejected status).
- Push the seven new commits to `origin/main` (`git push`).
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
- [ ] On an approved plan, uploading `payroll_run_01_mapping_clean.csv`
      as `payroll_run` auto-creates a `payroll_runs` row; clicking
      **Map run** lands a pending mapping with all 11 canonical
      fields populated; approving with the suggested run selected
      flips the run to `status='mapped'` with 25 `payroll_records`.
- [ ] Re-uploading any subsequent payroll CSV with the same column
      shape and clicking **Map run** returns `auto_applied: true`
      with no agent call and no human gate.

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
