"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CANONICAL_PAYROLL_FIELDS,
  type CanonicalPayrollField,
  fromStorageMapping,
  type PayrollMappingProposal,
  payrollMappingFieldUiHints,
  type PayrollStorageMapping,
} from "@/lib/server/payroll-mapping";
import {
  type ExtractedPlanFields,
  extractedPlanFieldUiHints,
} from "@/lib/server/plan-extraction";

/**
 * Plan detail screen.
 *
 * What it does:
 *   - Shows plan identity + extraction status.
 *   - Lists every file attached to the plan, with a "Run extraction"
 *     button next to plan_pdf files.
 *   - Renders `extracted_fields` as a readable table once the agent
 *     has run, plus the per-iteration tool-call timeline so the
 *     operator can see exactly what the agent did.
 *   - When extraction_status='in_review', the table becomes an
 *     editable form. Approve PATCHes /api/plans/[id]/extracted-fields
 *     with the (possibly edited) values; Reject POSTs to the .../reject
 *     subroute with a required reason. Both write audit rows whose
 *     before/after pair captures any human edits.
 */

export type PlanDetailPlan = {
  id: string;
  employer_name: string;
  plan_name: string | null;
  plan_year: number | null;
  status: string;
  extraction_status: "pending" | "in_review" | "approved" | "failed";
  extracted_at: string | null;
  extracted_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PlanDetailFile = {
  id: string;
  filename: string;
  kind: string;
  size_bytes: number | null;
  uploaded_at: string;
};

/**
 * Subset of `ParticipantRow` the Participants table card renders.
 * Keeping the shape narrow here means the Server Component can do the
 * row -> view mapping in one place and the client doesn't import
 * `server-only` modules.
 */
export type PlanDetailParticipant = {
  id: string;
  employee_id: string;
  participant_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  eligibility_status: string | null;
  /** numeric(5,4) round-tripped as string by supabase-js. */
  current_deferral_rate: string;
  /** numeric(12,2) round-tripped as string by supabase-js. */
  account_balance: string;
  employment_status: string | null;
};

/**
 * Narrowing of `PayrollRunRow` from `lib/server/payroll-runs.ts`. We
 * mirror only the fields the client renders so the server module
 * (which uses `server-only`) is never pulled into the client bundle
 * via a transitive type re-export.
 */
export type PlanDetailPayrollRun = {
  id: string;
  plan_id: string;
  source_file_id: string | null;
  mapping_id: string | null;
  label: string | null;
  pay_date: string | null;
  status: "uploaded" | "mapped" | "validated" | "reconciled" | "failed";
  row_count: number;
  uploaded_at: string;
  mapped_at: string | null;
};

/**
 * Narrowing of `PayrollMappingRow` from `lib/server/payroll-mappings.ts`.
 * `mapping` is the CSV-keyed storage shape; the mapping card converts
 * it to canonical-keyed proposal form for the editable inputs.
 */
export type PlanDetailPayrollMapping = {
  id: string;
  plan_id: string;
  name: string;
  mapping: PayrollStorageMapping;
  suggested_by: string | null;
  suggested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  status: "pending" | "approved" | "superseded" | "rejected";
};

type AgentToolCall = {
  iteration: number;
  tool_use_id: string;
  name: string;
  input: unknown;
  result: { ok: true; data: unknown } | { ok: false; error: string };
};

type ExtractResponse = {
  plan?: PlanDetailPlan;
  stop_reason: string | null;
  iterations: number;
  tool_calls: Array<AgentToolCall>;
};

type ExtractError = {
  error: string;
  message?: string;
  stop_reason?: string | null;
  iterations?: number;
  tool_calls?: ExtractResponse["tool_calls"];
};

type ImportResponse = {
  plan_id: string;
  file: { id: string; filename: string; kind: string };
  save_calls: number;
  flag_calls: number;
  stop_reason: string | null;
  iterations: number;
  tool_calls: Array<AgentToolCall>;
};

/**
 * Response payload for `POST /api/plans/[id]/payroll-runs/[run_id]/map`.
 *
 * Two arms:
 *   - `auto_applied: true` — the route found an existing approved
 *     mapping whose columns cover this CSV header and applied it
 *     directly. No agent invocation, no pending mapping to review.
 *   - `auto_applied: false` — the Payroll Mapping Agent ran, emitted
 *     a new pending mapping (`mapping_id`), and surfaced its tool-call
 *     timeline for the operator to inspect before approving.
 */
type MapResponse =
  | {
      run_id: string;
      plan_id: string;
      auto_applied: true;
      mapping_id: string;
      mapping_name: string;
      record_count: number;
    }
  | {
      run_id: string;
      plan_id: string;
      auto_applied: false;
      mapping_id: string;
      stop_reason: string | null;
      iterations: number;
      tool_calls: Array<AgentToolCall>;
    };

/**
 * One shared "latest agent run" timeline that updates whether the
 * operator just ran extraction, import, or mapping. The `kind` field
 * drives the card title so the operator always knows which run they're
 * looking at.
 */
type LatestRun =
  | { kind: "extract"; data: ExtractResponse }
  | { kind: "import"; data: ImportResponse }
  | { kind: "map"; data: MapResponse };

const STATUS_VARIANT: Record<
  PlanDetailPlan["extraction_status"],
  "secondary" | "default" | "destructive"
> = {
  pending: "secondary",
  in_review: "default",
  approved: "default",
  failed: "destructive",
};

export function PlanDetailClient({
  plan,
  files,
  participants,
  payrollRuns,
  pendingMapping,
  approvedMapping,
}: {
  plan: PlanDetailPlan;
  files: PlanDetailFile[];
  participants: PlanDetailParticipant[];
  payrollRuns: PlanDetailPayrollRun[];
  pendingMapping: PlanDetailPayrollMapping | null;
  approvedMapping: PlanDetailPayrollMapping | null;
}) {
  const router = useRouter();
  // `running` holds the file_id or run_id whose agent run is currently
  // in flight, shared across Run extraction, Run import, and Map run
  // buttons so we can disable every other button while one is working.
  // file_ids and run_ids are both uuids drawn from disjoint tables, so
  // a single string is unambiguous.
  const [running, setRunning] = useState<string | null>(null);
  const [latest, setLatest] = useState<LatestRun | null>(null);
  const [error, setError] = useState<ExtractError | string | null>(null);

  const planPdfs = files.filter((f) => f.kind === "plan_pdf");

  async function handleExtract(file_id: string) {
    setRunning(file_id);
    setLatest(null);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${plan.id}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_id }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | ExtractResponse
        | ExtractError;
      if (!res.ok) {
        setError(body as ExtractError);
      } else {
        setLatest({ kind: "extract", data: body as ExtractResponse });
        // Refresh server-rendered plan/file data so the new
        // `extraction_status` + `extracted_fields` show up.
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setRunning(null);
    }
  }

  async function handleImport(file_id: string) {
    setRunning(file_id);
    setLatest(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/plans/${plan.id}/participants/import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as
        | ImportResponse
        | ExtractError;
      if (!res.ok) {
        setError(body as ExtractError);
      } else {
        setLatest({ kind: "import", data: body as ImportResponse });
        // Refresh server-rendered participants list so the table fills in.
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setRunning(null);
    }
  }

  async function handleMap(run_id: string) {
    setRunning(run_id);
    setLatest(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/plans/${plan.id}/payroll-runs/${run_id}/map`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = (await res.json().catch(() => ({}))) as
        | MapResponse
        | ExtractError;
      if (!res.ok) {
        setError(body as ExtractError);
      } else {
        setLatest({ kind: "map", data: body as MapResponse });
        // Refresh so the runs table picks up the new status / mapping_id
        // and the pending-mapping card appears (or disappears, in the
        // auto-applied case).
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mapping failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Back to home
        </Link>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {plan.employer_name}
          </h1>
          <Badge variant={STATUS_VARIANT[plan.extraction_status]}>
            {plan.extraction_status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Plan id:{" "}
          <span className="font-mono">{plan.id}</span>
          {plan.plan_year ? ` · plan year ${plan.plan_year}` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            Every artifact uploaded for this plan. Click{" "}
            <span className="font-mono">Run extraction</span> on a{" "}
            <span className="font-mono">plan_pdf</span> to invoke the Plan
            Extraction Agent, or{" "}
            <span className="font-mono">Run import</span> on a{" "}
            <span className="font-mono">participant_census</span> to invoke
            the Participant Import Agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {files.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No files yet. Upload one from the home page.
            </p>
          )}
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-4 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-mono">{f.filename}</span>
                <span className="text-xs text-muted-foreground">
                  {f.kind} · {f.size_bytes ?? "—"} bytes ·{" "}
                  {new Date(f.uploaded_at).toLocaleString()}
                </span>
              </div>
              {f.kind === "plan_pdf" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleExtract(f.id)}
                  disabled={running !== null}
                >
                  {running === f.id ? "Extracting…" : "Run extraction"}
                </Button>
              )}
              {f.kind === "participant_census" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleImport(f.id)}
                  disabled={running !== null}
                >
                  {running === f.id ? "Importing…" : "Run import"}
                </Button>
              )}
            </div>
          ))}
          {planPdfs.length === 0 && files.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Upload a <span className="font-mono">plan_pdf</span> from the
              home page to enable extraction.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardHeader>
            <CardTitle>Extraction error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs">
              {typeof error === "string"
                ? error
                : JSON.stringify(error, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {latest && <LatestRunCard run={latest} />}

      {/*
        `key` makes the form remount whenever a new extraction lands.
        That re-runs `useState(toFormState(...))` with the fresh agent
        output instead of keeping the previous form values around -- the
        React-19-correct way to re-seed state on prop change without
        useEffect (avoids `react-hooks/set-state-in-effect`).
      */}
      <ExtractedFieldsCard
        key={`${plan.id}:${plan.extraction_status}:${plan.extracted_at ?? "_"}`}
        plan={plan}
      />

      {pendingMapping && (
        // Same re-mount-on-id trick as ExtractedFieldsCard: whenever the
        // pending row's identity changes (new agent proposal landed, or
        // the prior one was approved/rejected and a new one appeared),
        // wipe form state so we never show stale CSV column values
        // bound to a different mapping row.
        <ProposedMappingCard
          key={pendingMapping.id}
          plan={plan}
          files={files}
          mapping={pendingMapping}
          payrollRuns={payrollRuns}
        />
      )}

      <PayrollRunsTable
        plan={plan}
        files={files}
        payrollRuns={payrollRuns}
        pendingMapping={pendingMapping}
        approvedMapping={approvedMapping}
        running={running}
        onMap={handleMap}
      />

      {approvedMapping && (
        <ApprovedMappingCard mapping={approvedMapping} />
      )}

      <ParticipantsCard participants={participants} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Latest agent run card (shared between extract + import).
// ---------------------------------------------------------------------------

function LatestRunCard({ run }: { run: LatestRun }) {
  // The auto-applied mapping path skips the agent entirely, so it
  // has no tool_calls timeline. Render a single-row summary instead
  // of the empty tool-call list the other arms would produce. Done as
  // a typed-narrowing early return so the rest of this function can
  // assume the agent-timeline fields are present.
  if (run.kind === "map" && run.data.auto_applied) {
    const { mapping_name, record_count } = run.data;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Latest mapping run</CardTitle>
          <CardDescription>
            Auto-applied a previously-approved mapping; no agent
            invocation was needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="default">Auto-applied</Badge>
            <span>
              Auto-applied mapping{" "}
              <span className="font-mono">{mapping_name}</span> (
              {record_count} record{record_count === 1 ? "" : "s"} ingested)
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Pull the agent-timeline fields off the narrowed union. The auto-
  // applied map arm was handled above, so map(false), extract, and
  // import all carry stop_reason/iterations/tool_calls.
  const { title, stop_reason, iterations, tool_calls, extraSummary } =
    runTimelineFields(run);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          stop_reason:{" "}
          <span className="font-mono">{stop_reason ?? "—"}</span>
          {" · "}iterations:{" "}
          <span className="font-mono">{iterations}</span>
          {" · "}
          {tool_calls.length} tool call{tool_calls.length === 1 ? "" : "s"}
          {extraSummary}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {tool_calls.map((c) => (
          <details
            key={c.tool_use_id}
            className="rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 text-xs"
          >
            <summary className="cursor-pointer">
              <Badge
                variant={c.result.ok ? "default" : "destructive"}
                className="mr-2"
              >
                {c.result.ok ? "ok" : "error"}
              </Badge>
              <span className="font-mono">{c.name}</span>
              <span className="text-muted-foreground">
                {" "}
                (iter {c.iteration})
              </span>
            </summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(
                c.result.ok
                  ? { input: c.input, output: c.result.data }
                  : { input: c.input, error: c.result.error },
                null,
                2,
              )}
            </pre>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Centralizes the "card chrome" projection for the three agent-timeline
 * arms (extract, import, map-non-auto-applied). Each arm contributes a
 * card title, an optional summary fragment, and its tool-call list.
 *
 * The auto_applied map arm is intentionally rejected at runtime: the
 * caller handles it with an early-return render and shouldn't reach
 * this helper. Throwing surfaces the contract violation immediately
 * rather than silently producing "0 tool calls" UI.
 */
function runTimelineFields(run: LatestRun): {
  title: string;
  stop_reason: string | null;
  iterations: number;
  tool_calls: AgentToolCall[];
  extraSummary: string;
} {
  if (run.kind === "extract") {
    return {
      title: "Latest extraction run",
      stop_reason: run.data.stop_reason,
      iterations: run.data.iterations,
      tool_calls: run.data.tool_calls,
      extraSummary: "",
    };
  }
  if (run.kind === "import") {
    return {
      title: "Latest import run",
      stop_reason: run.data.stop_reason,
      iterations: run.data.iterations,
      tool_calls: run.data.tool_calls,
      extraSummary:
        ` · save_participants ok: ${run.data.save_calls}` +
        ` · flag_participant_issue ok: ${run.data.flag_calls}`,
    };
  }
  // run.kind === "map" — auto_applied:true was handled by the caller.
  if (run.data.auto_applied) {
    throw new Error(
      "runTimelineFields invoked on auto-applied map arm; caller should early-return",
    );
  }
  // Count ok results per tool name. flag_mapping_issue may legitimately
  // never appear (clean mapping), but we still surface its 0 count so
  // the operator can tell "agent ran and saw no issues" apart from
  // "agent ran but didn't even consider issues".
  let proposeOk = 0;
  let flagOk = 0;
  for (const c of run.data.tool_calls) {
    if (!c.result.ok) continue;
    if (c.name === "propose_payroll_mapping") proposeOk += 1;
    else if (c.name === "flag_mapping_issue") flagOk += 1;
  }
  return {
    title: "Latest mapping run",
    stop_reason: run.data.stop_reason,
    iterations: run.data.iterations,
    tool_calls: run.data.tool_calls,
    extraSummary:
      ` · propose_payroll_mapping ok: ${proposeOk}` +
      ` · flag_mapping_issue ok: ${flagOk}`,
  };
}

// ---------------------------------------------------------------------------
// Participants card.
// ---------------------------------------------------------------------------

const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatRate(rate: string | number): string {
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function formatMoney(amount: string | number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return CURRENCY_FORMAT.format(n);
}

function ParticipantsCard({
  participants,
}: {
  participants: PlanDetailParticipant[];
}) {
  const count = participants.length;
  const description =
    count === 0
      ? "No participants imported yet."
      : count === 200
        ? `Showing first 200 (table capped for performance).`
        : `${count} participant${count === 1 ? "" : "s"}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Participants</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">
            No participants imported yet — upload a{" "}
            <span className="font-mono">participant_census</span> and click
            Run import.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>employee_id</TableHead>
                <TableHead>name</TableHead>
                <TableHead>email</TableHead>
                <TableHead>eligibility_status</TableHead>
                <TableHead className="text-right">
                  current_deferral_rate
                </TableHead>
                <TableHead className="text-right">account_balance</TableHead>
                <TableHead>employment_status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.employee_id}</TableCell>
                  <TableCell>
                    {p.first_name} {p.last_name}
                  </TableCell>
                  <TableCell className="font-mono">
                    {p.email ?? (
                      <span className="text-muted-foreground">null</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.eligibility_status ?? (
                      <span className="text-muted-foreground">null</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatRate(p.current_deferral_rate)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMoney(p.account_balance)}
                  </TableCell>
                  <TableCell>
                    {p.employment_status ?? (
                      <span className="text-muted-foreground">null</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Extracted-fields card (editable when in_review, read-only otherwise).
// ---------------------------------------------------------------------------

const FIELD_KEYS = Object.keys(extractedPlanFieldUiHints) as Array<
  keyof ExtractedPlanFields
>;

/**
 * Coerce a parsed extracted_fields blob (which has been through Zod on
 * the way in but still arrives as Record<string, unknown> from the
 * server payload) into typed form state. Missing fields fall back to
 * empty values so the form renders without a crash even if a future
 * schema change lands fields that the existing row doesn't yet have.
 */
function toFormState(
  fields: Record<string, unknown>,
): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const key of FIELD_KEYS) {
    const hint = extractedPlanFieldUiHints[key];
    const v = fields[key];
    if (hint.kind === "boolean") {
      out[key] = typeof v === "boolean" ? v : false;
    } else if (v === null || v === undefined) {
      out[key] = hint.nullable ? null : "";
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

/**
 * Coerce form state back into the shape the API expects. Empty
 * nullable text/number fields become `null`; numeric strings parse
 * back to numbers. The server re-runs `extractedPlanFieldsSchema` so
 * any coercion mistake here surfaces as a 400 with a Zod issue, not
 * silent corruption.
 */
function fromFormState(
  state: Record<string, string | boolean | null>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    const hint = extractedPlanFieldUiHints[key];
    const v = state[key];
    if (hint.kind === "boolean") {
      out[key] = Boolean(v);
    } else if (hint.kind === "integer" || hint.kind === "number") {
      if (v === "" || v === null || v === undefined) {
        out[key] = hint.nullable ? null : 0;
      } else {
        const n =
          hint.kind === "integer" ? parseInt(String(v), 10) : Number(v);
        out[key] = Number.isFinite(n) ? n : null;
      }
    } else {
      // text | textarea
      if (v === "" || v === null || v === undefined) {
        out[key] = hint.nullable ? null : "";
      } else {
        out[key] = String(v);
      }
    }
  }
  return out;
}

function ExtractedFieldsCard({ plan }: { plan: PlanDetailPlan }) {
  const router = useRouter();
  const isInReview = plan.extraction_status === "in_review";

  const [state, setState] = useState<Record<string, string | boolean | null>>(
    () => toFormState(plan.extracted_fields ?? {}),
  );
  const [approver, setApprover] = useState("system_demo_user");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const hasFields = Object.keys(plan.extracted_fields ?? {}).length > 0;

  async function handleApprove() {
    setSubmitting("approve");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/plans/${plan.id}/extracted-fields`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          extracted_fields: fromFormState(state),
          approver_name: approver,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        issues?: Array<{ path: string; message: string }>;
      };
      if (!res.ok) {
        const issues = body.issues
          ?.map((i) => `${i.path}: ${i.message}`)
          .join("; ");
        throw new Error(
          issues ?? body.message ?? body.error ?? `PATCH ${res.status}`,
        );
      }
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleReject() {
    setSubmitting("reject");
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/plans/${plan.id}/extracted-fields/reject`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            approver_name: approver,
            reason: rejectReason,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(
          body.message ?? body.error ?? `POST ${res.status}`,
        );
      }
      setRejectOpen(false);
      setRejectReason("");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Rejection failed");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Extracted plan details</CardTitle>
        <CardDescription>
          {!hasFields ? (
            <>Nothing extracted yet — run the agent on a plan_pdf.</>
          ) : isInReview ? (
            <>
              Agent extracted{" "}
              <span className="font-mono">
                {plan.extracted_at
                  ? new Date(plan.extracted_at).toLocaleString()
                  : "—"}
              </span>
              . Edit any field, then Approve to lock it in or Reject to
              flag the run as failed.
            </>
          ) : (
            <>
              Last updated{" "}
              <span className="font-mono">
                {plan.extracted_at
                  ? new Date(plan.extracted_at).toLocaleString()
                  : "—"}
              </span>
              . Status: <span className="font-mono">{plan.extraction_status}</span>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasFields && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-3 text-sm">
            {FIELD_KEYS.map((key) => {
              const hint = extractedPlanFieldUiHints[key];
              const value = state[key];
              return (
                <div key={key} className="contents">
                  <dt className="flex flex-col font-mono text-muted-foreground">
                    <span>{key}</span>
                    {hint.hint && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {hint.hint}
                      </span>
                    )}
                  </dt>
                  <dd className="font-mono break-words">
                    {isInReview ? (
                      <FieldInput
                        fieldKey={key}
                        kind={hint.kind}
                        value={value}
                        onChange={(v) =>
                          setState((s) => ({ ...s, [key]: v }))
                        }
                      />
                    ) : (
                      <ReadOnlyValue
                        kind={hint.kind}
                        value={value}
                      />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        {hasFields && isInReview && (
          <div className="flex flex-col gap-3 rounded-md border border-foreground/10 bg-muted/40 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
                Approver name
                <Input
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  className="font-mono"
                />
              </label>
              <div className="flex gap-2 self-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRejectOpen(true)}
                  disabled={submitting !== null}
                >
                  Reject
                </Button>
                <Button
                  type="button"
                  onClick={handleApprove}
                  disabled={
                    submitting !== null || approver.trim().length === 0
                  }
                >
                  {submitting === "approve" ? "Approving…" : "Approve"}
                </Button>
              </div>
            </div>
            {errorMsg && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {errorMsg}
              </p>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject extracted plan details</DialogTitle>
            <DialogDescription>
              The plan row will be flipped to{" "}
              <span className="font-mono">extraction_status=failed</span> and
              this reason will be written to the audit log.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Why is this rejection? e.g. wrong document, agent missed Section 3."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          {errorMsg && (
            <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={submitting === "reject"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReject}
              disabled={
                submitting === "reject" || rejectReason.trim().length === 0
              }
            >
              {submitting === "reject" ? "Rejecting…" : "Confirm reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FieldInput({
  fieldKey,
  kind,
  value,
  onChange,
}: {
  fieldKey: string;
  kind: "text" | "textarea" | "number" | "integer" | "boolean";
  value: string | boolean | null;
  onChange: (next: string | boolean) => void;
}) {
  if (kind === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="font-mono">{value === true ? "true" : "false"}</span>
      </label>
    );
  }

  // For every non-boolean kind the form state is always string | null;
  // narrow here so the textarea / Input value props get a string.
  const textValue = typeof value === "string" ? value : "";

  if (kind === "textarea") {
    return (
      <textarea
        className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
        value={textValue}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <Input
      type={kind === "number" || kind === "integer" ? "number" : "text"}
      step={kind === "integer" ? 1 : kind === "number" ? "any" : undefined}
      value={textValue}
      onChange={(e) => onChange(e.target.value)}
      className="font-mono"
      data-field={fieldKey}
    />
  );
}

function ReadOnlyValue({
  kind,
  value,
}: {
  kind: "text" | "textarea" | "number" | "integer" | "boolean";
  value: string | boolean | null;
}) {
  if (value === null || value === "") {
    return <span className="text-muted-foreground">null</span>;
  }
  if (kind === "boolean") {
    return <>{value === true ? "true" : "false"}</>;
  }
  return <>{String(value)}</>;
}

// ---------------------------------------------------------------------------
// Payroll runs table.
// ---------------------------------------------------------------------------

const RUN_STATUS_VARIANT: Record<
  PlanDetailPayrollRun["status"],
  "secondary" | "default" | "destructive" | "outline"
> = {
  uploaded: "secondary",
  mapped: "default",
  validated: "default",
  reconciled: "default",
  failed: "destructive",
};

function PayrollRunsTable({
  plan,
  files,
  payrollRuns,
  pendingMapping,
  approvedMapping,
  running,
  onMap,
}: {
  plan: PlanDetailPlan;
  files: PlanDetailFile[];
  payrollRuns: PlanDetailPayrollRun[];
  pendingMapping: PlanDetailPayrollMapping | null;
  approvedMapping: PlanDetailPayrollMapping | null;
  running: string | null;
  onMap: (run_id: string) => void;
}) {
  // Drop the unused `plan` param onto a void expression so the lint
  // rule for unused args doesn't fire while keeping the prop in the
  // signature -- callers pass it for future status badges keyed on
  // the plan's own state.
  void plan;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll runs</CardTitle>
        <CardDescription>
          One row per uploaded payroll CSV. Click{" "}
          <span className="font-mono">Map run</span> on an{" "}
          <span className="font-mono">uploaded</span> run to invoke the
          Payroll Mapping Agent (or auto-apply a previously-approved
          mapping when its columns cover this CSV).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {payrollRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payroll runs yet. Upload a CSV with{" "}
            <span className="font-mono">kind=payroll_run</span>.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mapping</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollRuns.map((run) => {
                const file = files.find((f) => f.id === run.source_file_id);
                const filename = file?.filename ?? "—";
                const mappingName =
                  run.mapping_id &&
                  (run.mapping_id === approvedMapping?.id
                    ? approvedMapping.name
                    : run.mapping_id === pendingMapping?.id
                      ? pendingMapping.name
                      : null);
                const isThisRunning = running === run.id;
                const canMap = run.status === "uploaded";
                return (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono">{filename}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(run.uploaded_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={RUN_STATUS_VARIANT[run.status]}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {mappingName ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {run.row_count}
                    </TableCell>
                    <TableCell className="text-right">
                      {canMap ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onMap(run.id)}
                          disabled={running !== null}
                        >
                          {isThisRunning ? "Mapping…" : "Map run"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Proposed (pending) payroll mapping card.
// ---------------------------------------------------------------------------

type ProposalFormField = { value: string; absent: boolean };
type ProposalFormState = Record<CanonicalPayrollField, ProposalFormField>;

/**
 * Convert a canonical-keyed proposal into editable form state. A
 * `null` value (agent / human decided no CSV column maps) shows as
 * `absent: true` with an empty input that disables on render.
 */
function proposalToFormState(
  proposal: PayrollMappingProposal,
): ProposalFormState {
  const out = {} as ProposalFormState;
  for (const field of CANONICAL_PAYROLL_FIELDS) {
    const v = proposal[field];
    out[field] = v === null
      ? { value: "", absent: true }
      : { value: v, absent: false };
  }
  return out;
}

/**
 * Inverse of `proposalToFormState`. Throws if any non-absent field
 * has a blank value -- callers should call `validateFormState` first
 * to surface that as a user-facing error rather than catching here.
 */
function formStateToProposal(
  state: ProposalFormState,
): PayrollMappingProposal {
  const out = {} as Record<CanonicalPayrollField, string | null>;
  for (const field of CANONICAL_PAYROLL_FIELDS) {
    const cell = state[field];
    if (cell.absent) {
      out[field] = null;
    } else {
      const trimmed = cell.value.trim();
      if (trimmed.length === 0) {
        // Defensive: should have been caught by validateFormState.
        throw new Error(
          `Field ${field} is marked present but value is blank`,
        );
      }
      out[field] = trimmed;
    }
  }
  return out as PayrollMappingProposal;
}

/**
 * Return the list of canonical field names whose form cell is
 * present (not absent) but has a blank value. Empty list means the
 * form is safe to submit.
 */
function validateFormState(state: ProposalFormState): CanonicalPayrollField[] {
  const issues: CanonicalPayrollField[] = [];
  for (const field of CANONICAL_PAYROLL_FIELDS) {
    const cell = state[field];
    if (!cell.absent && cell.value.trim().length === 0) {
      issues.push(field);
    }
  }
  return issues;
}

type ApproveMappingResponse = {
  mapping?: PlanDetailPayrollMapping;
  audit_log_id?: string;
  ingest_skipped?: boolean;
  ingest_skip_reason?: string;
  run?: PlanDetailPayrollRun;
  record_count?: number;
};

function ProposedMappingCard({
  plan,
  files,
  mapping,
  payrollRuns,
}: {
  plan: PlanDetailPlan;
  files: PlanDetailFile[];
  mapping: PlanDetailPayrollMapping;
  payrollRuns: PlanDetailPayrollRun[];
}) {
  const router = useRouter();

  // Round-trip storage -> proposal once on mount via the parent's
  // `key={mapping.id}` remount, so a fresh agent suggestion replaces
  // any prior in-progress edits cleanly.
  const [formState, setFormState] = useState<ProposalFormState>(() =>
    proposalToFormState(fromStorageMapping(mapping.mapping)),
  );
  const [approver, setApprover] = useState("system_demo_user");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Only `uploaded` runs are valid ingest targets; the approve route
  // ignores everything else and would return ingest_skipped.
  const uploadableRuns = payrollRuns.filter((r) => r.status === "uploaded");
  const [selectedRunId, setSelectedRunId] = useState<string>(() => {
    // listPayrollRunsForPlan returns most-recently-uploaded first, so
    // the first uploadable run is also the most recent.
    return uploadableRuns[0]?.id ?? "";
  });

  async function handleApprove() {
    setSubmitting("approve");
    setErrorMsg(null);
    setSuccessMsg(null);

    const issues = validateFormState(formState);
    if (issues.length > 0) {
      setErrorMsg(
        `Field${issues.length === 1 ? "" : "s"} marked present but blank: ${issues.join(", ")}. Check "Not in CSV" if no column maps.`,
      );
      setSubmitting(null);
      return;
    }

    try {
      const proposal = formStateToProposal(formState);
      const body: Record<string, unknown> = {
        proposal,
        approver_name: approver,
      };
      if (reason.trim().length > 0) body.reason = reason.trim();
      if (selectedRunId) body.ingest_run_id = selectedRunId;

      const res = await fetch(
        `/api/plans/${plan.id}/payroll-mappings/${mapping.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const responseBody = (await res.json().catch(() => ({}))) as
        | ApproveMappingResponse
        | { error?: string; message?: string };
      if (!res.ok) {
        const e = responseBody as { error?: string; message?: string };
        throw new Error(e.message ?? e.error ?? `PATCH ${res.status}`);
      }
      const ok = responseBody as ApproveMappingResponse;
      const summary =
        ok.record_count !== undefined && ok.record_count !== null
          ? `${ok.record_count} record${ok.record_count === 1 ? "" : "s"} ingested.`
          : ok.ingest_skipped
            ? `Ingest skipped: ${ok.ingest_skip_reason ?? "no reason given"}.`
            : "No run to ingest.";
      setSuccessMsg(`Approved. ${summary}`);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleReject() {
    setSubmitting("reject");
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(
        `/api/plans/${plan.id}/payroll-mappings/${mapping.id}/reject`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reviewer_name: approver,
            reason: rejectReason,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? `POST ${res.status}`);
      }
      setRejectOpen(false);
      setRejectReason("");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Rejection failed");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending payroll mapping</CardTitle>
        <CardDescription>
          <span className="font-mono">{mapping.name}</span> · suggested by{" "}
          <span className="font-mono">{mapping.suggested_by ?? "—"}</span> at{" "}
          <span className="font-mono">
            {new Date(mapping.suggested_at).toLocaleString()}
          </span>
          . Edit the CSV column for any field below, then Approve to ingest
          the selected run, or Reject to discard this proposal.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-3 text-sm">
          {CANONICAL_PAYROLL_FIELDS.map((field) => {
            const hint = payrollMappingFieldUiHints[field];
            const cell = formState[field];
            return (
              <div key={field} className="contents">
                <dt className="flex flex-col text-muted-foreground">
                  <span className="font-mono">{hint.label}</span>
                  {hint.hint && (
                    <span className="text-[10px] text-muted-foreground/60">
                      {hint.hint}
                    </span>
                  )}
                </dt>
                <dd className="flex flex-col gap-1 font-mono">
                  <Input
                    type="text"
                    value={cell.value}
                    placeholder={cell.absent ? "(not in CSV)" : "CSV column"}
                    disabled={cell.absent || submitting !== null}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        [field]: { ...s[field], value: e.target.value },
                      }))
                    }
                    className="font-mono"
                    data-field={field}
                  />
                  <label className="inline-flex items-center gap-2 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={cell.absent}
                      disabled={submitting !== null}
                      onChange={(e) =>
                        setFormState((s) => ({
                          ...s,
                          [field]: {
                            value: e.target.checked ? "" : s[field].value,
                            absent: e.target.checked,
                          },
                        }))
                      }
                    />
                    Not in CSV
                  </label>
                </dd>
              </div>
            );
          })}
        </dl>

        <div className="flex flex-col gap-3 rounded-md border border-foreground/10 bg-muted/40 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Approver name
              <Input
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
                disabled={submitting !== null}
                className="font-mono"
              />
            </label>
            {uploadableRuns.length > 0 && (
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
                Apply to run
                <select
                  value={selectedRunId}
                  disabled={submitting !== null}
                  onChange={(e) => setSelectedRunId(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm font-mono"
                >
                  {uploadableRuns.map((r) => {
                    const file = files.find(
                      (f) => f.id === r.source_file_id,
                    );
                    const label = file?.filename ?? `${r.id.slice(0, 8)}…`;
                    return (
                      <option key={r.id} value={r.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Reason (optional, ≤ 2000 chars)
            <textarea
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting !== null}
              placeholder="Optional note for the audit log, e.g. 'Cleaned up 401k column name'."
              className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(true)}
              disabled={
                submitting !== null || approver.trim().length === 0
              }
            >
              Reject
            </Button>
            <Button
              type="button"
              onClick={handleApprove}
              disabled={
                submitting !== null || approver.trim().length === 0
              }
            >
              {submitting === "approve" ? "Approving…" : "Approve"}
            </Button>
          </div>

          {errorMsg && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {errorMsg}
            </p>
          )}
          {successMsg && (
            <p className="text-xs text-green-700 dark:text-green-400">
              {successMsg}
            </p>
          )}
        </div>
      </CardContent>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject payroll mapping</DialogTitle>
            <DialogDescription>
              The pending mapping will be flipped to{" "}
              <span className="font-mono">status=rejected</span> and the
              reason will be written to the audit log. The Payroll
              Mapping Agent can be re-run to produce a fresh proposal.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Why is this rejection? e.g. wrong columns picked, agent guessed pay_date as gross_wages."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          {errorMsg && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {errorMsg}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={submitting === "reject"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReject}
              disabled={
                submitting === "reject" || rejectReason.trim().length === 0
              }
            >
              {submitting === "reject" ? "Rejecting…" : "Confirm reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Approved payroll mapping card (read-only summary of the current mapping).
// ---------------------------------------------------------------------------

function ApprovedMappingCard({
  mapping,
}: {
  mapping: PlanDetailPayrollMapping;
}) {
  // Render in canonical-field order so two mappings for the same
  // plan visually diff field-by-field instead of by header alphabetic
  // order. Storage shape is CSV-keyed, so invert here.
  const proposal = fromStorageMapping(mapping.mapping);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approved payroll mapping</CardTitle>
        <CardDescription>
          <span className="font-mono">{mapping.name}</span> · approved by{" "}
          <span className="font-mono">{mapping.approved_by ?? "—"}</span> at{" "}
          <span className="font-mono">
            {mapping.approved_at
              ? new Date(mapping.approved_at).toLocaleString()
              : "—"}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Show CSV column → canonical field pairs
          </summary>
          <dl className="mt-2 grid grid-cols-[max-content_max-content_1fr] gap-x-3 gap-y-1 font-mono">
            {CANONICAL_PAYROLL_FIELDS.map((field) => {
              const csv = proposal[field];
              return (
                <div key={field} className="contents">
                  <dt>{field}</dt>
                  <dd className="text-muted-foreground">←</dd>
                  <dd>
                    {csv ?? <span className="text-muted-foreground">—</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </details>
      </CardContent>
    </Card>
  );
}
