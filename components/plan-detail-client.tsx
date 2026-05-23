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

/**
 * Plan detail screen.
 *
 * What it does:
 *   - Shows plan identity + extraction status.
 *   - Lists every file attached to the plan, with a "Run extraction"
 *     button next to plan_pdf files.
 *   - Renders `extracted_fields` as a readable table once the agent
 *     has run, plus the per-iteration tool-call timeline so the
 *     operator can see exactly what the agent did. The agent records
 *     contradictions in the audit-log `reason`; we surface a hint
 *     pointing operators at the Audit Trail (Phase 8) for the full
 *     story.
 *
 * What it deliberately does NOT do yet:
 *   - Edit + Save extracted_fields. That belongs in a follow-up slice
 *     once the human approval workflow is designed end-to-end.
 *   - Approve / reject (`extraction_status: 'approved' | 'failed'`).
 *     Ditto.
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

type ExtractResponse = {
  plan?: PlanDetailPlan;
  stop_reason: string | null;
  iterations: number;
  tool_calls: Array<{
    iteration: number;
    tool_use_id: string;
    name: string;
    input: unknown;
    result: { ok: true; data: unknown } | { ok: false; error: string };
  }>;
};

type ExtractError = {
  error: string;
  message?: string;
  stop_reason?: string | null;
  iterations?: number;
  tool_calls?: ExtractResponse["tool_calls"];
};

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
}: {
  plan: PlanDetailPlan;
  files: PlanDetailFile[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [error, setError] = useState<ExtractError | string | null>(null);

  const planPdfs = files.filter((f) => f.kind === "plan_pdf");

  async function handleExtract(file_id: string) {
    setRunning(file_id);
    setResult(null);
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
        setResult(body as ExtractResponse);
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

  const extractedEntries = Object.entries(plan.extracted_fields ?? {}).filter(
    ([k]) => !k.startsWith("_"),
  );

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
            Extraction Agent.
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

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Latest agent run</CardTitle>
            <CardDescription>
              stop_reason:{" "}
              <span className="font-mono">{result.stop_reason ?? "—"}</span>
              {" · "}iterations:{" "}
              <span className="font-mono">{result.iterations}</span>
              {" · "}
              {result.tool_calls.length} tool call
              {result.tool_calls.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {result.tool_calls.map((c) => (
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
      )}

      <Card>
        <CardHeader>
          <CardTitle>Extracted plan details</CardTitle>
          <CardDescription>
            {extractedEntries.length === 0 ? (
              <>Nothing extracted yet — run the agent on a plan_pdf.</>
            ) : (
              <>
                Last updated{" "}
                <span className="font-mono">
                  {plan.extracted_at
                    ? new Date(plan.extracted_at).toLocaleString()
                    : "—"}
                </span>
                . Edit + approve is part of the next slice — for now the
                operator reviews here and approves via the database.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {extractedEntries.length > 0 && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              {extractedEntries.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="font-mono text-muted-foreground">{key}</dt>
                  <dd className="font-mono break-all">
                    {value === null
                      ? "null"
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </>
  );
}
