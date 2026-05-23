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
 * One shared "latest agent run" timeline that updates whether the
 * operator just ran extraction or import. The `kind` field drives the
 * card title so the operator always knows which run they're looking at.
 */
type LatestRun =
  | { kind: "extract"; data: ExtractResponse }
  | { kind: "import"; data: ImportResponse };

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
}: {
  plan: PlanDetailPlan;
  files: PlanDetailFile[];
  participants: PlanDetailParticipant[];
}) {
  const router = useRouter();
  // `running` holds the file_id whose agent run is currently in flight,
  // shared across both Run extraction and Run import buttons so we can
  // disable every other button while one is working.
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

      <ParticipantsCard participants={participants} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Latest agent run card (shared between extract + import).
// ---------------------------------------------------------------------------

function LatestRunCard({ run }: { run: LatestRun }) {
  const title =
    run.kind === "extract" ? "Latest extraction run" : "Latest import run";
  const calls = run.data.tool_calls;
  const extraSummary =
    run.kind === "import"
      ? ` · save_participants ok: ${run.data.save_calls}` +
        ` · flag_participant_issue ok: ${run.data.flag_calls}`
      : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          stop_reason:{" "}
          <span className="font-mono">{run.data.stop_reason ?? "—"}</span>
          {" · "}iterations:{" "}
          <span className="font-mono">{run.data.iterations}</span>
          {" · "}
          {calls.length} tool call{calls.length === 1 ? "" : "s"}
          {extraSummary}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {calls.map((c) => (
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
