"use client";

import Link from "next/link";
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
import { Input } from "@/components/ui/input";

/**
 * Client half of the Phase 6 upload demo. The server half
 * (`components/upload-card.tsx`) loads the initial plan list so we
 * don't violate React 19's "no setState in effect" rule with a mount
 * fetch. New plans created via "Create demo plan" are appended to
 * client state without refetching -- the response from POST /api/plans
 * is authoritative.
 */

export type UploadCardPlan = {
  id: string;
  employer_name: string;
  plan_name: string | null;
  plan_year: number | null;
  status: string;
  created_at: string;
};

type UploadResponse = {
  file: {
    id: string;
    plan_id: string | null;
    kind: string;
    filename: string;
    size_bytes: number | null;
    checksum_sha256: string;
    storage_path: string | null;
  };
  created: boolean;
  audit_log_id: string;
};

type UploadKind =
  | "plan_pdf"
  | "participant_census"
  | "payroll_run"
  | "other";

export function UploadCardClient({
  initialPlans,
}: {
  initialPlans: UploadCardPlan[];
}) {
  const [plans, setPlans] = useState<UploadCardPlan[]>(initialPlans);
  const [planId, setPlanId] = useState<string>(initialPlans[0]?.id ?? "");
  const [kind, setKind] = useState<UploadKind>("participant_census");
  const [file, setFile] = useState<File | null>(null);

  const [creatingPlan, setCreatingPlan] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);

  async function handleCreateDemoPlan() {
    setCreatingPlan(true);
    setError(null);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employer_name: "Acme Robotics",
          plan_name: "Acme Robotics 401(k) Plan",
          plan_year: 2026,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `POST /api/plans -> ${res.status}`);
      }
      const data = (await res.json()) as { plan: UploadCardPlan };
      setPlans((prev) => [data.plan, ...prev]);
      setPlanId(data.plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
    } finally {
      setCreatingPlan(false);
    }
  }

  async function handleUpload() {
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    if (!planId) {
      setError("Pick (or create) a plan first.");
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("plan_id", planId);
      form.set("kind", kind);

      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as
        | UploadResponse
        | { message?: string; error?: string };
      if (!res.ok) {
        const msg =
          ("message" in body && body.message) ||
          ("error" in body && body.error) ||
          `POST /api/upload -> ${res.status}`;
        throw new Error(msg);
      }
      setResult(body as UploadResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Upload a file</CardTitle>
        <CardDescription>
          End-to-end Phase 6 demo: pick a plan, drop a CSV, watch it land
          in <span className="font-mono">launchpad-files</span> with a row
          in <span className="font-mono">files</span> and an entry in{" "}
          <span className="font-mono">audit_logs</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Plan
          </label>
          <div className="flex gap-2">
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              disabled={plans.length === 0}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {plans.length === 0 && <option value="">No plans yet</option>}
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.employer_name} — {p.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              onClick={handleCreateDemoPlan}
              disabled={creatingPlan}
            >
              {creatingPlan ? "Creating…" : "Create demo plan"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            File kind
          </label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as UploadKind)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="plan_pdf">plan_pdf</option>
            <option value="participant_census">participant_census</option>
            <option value="payroll_run">payroll_run</option>
            <option value="other">other</option>
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            File
          </label>
          <Input
            type="file"
            accept={
              kind === "plan_pdf"
                ? ".pdf,application/pdf"
                : ".csv,text/csv,application/csv"
            }
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <Button
          type="button"
          onClick={handleUpload}
          disabled={uploading || !file || !planId}
        >
          {uploading ? "Uploading…" : "Upload"}
        </Button>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Error: <span className="font-mono">{error}</span>
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2 rounded-md border border-foreground/10 bg-muted/40 p-3 text-xs">
            <div className="flex items-center gap-2">
              <Badge variant={result.created ? "default" : "secondary"}>
                {result.created ? "uploaded" : "deduped"}
              </Badge>
              <span className="font-mono">{result.file.filename}</span>
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono">
              <dt className="text-muted-foreground">file_id</dt>
              <dd className="truncate">{result.file.id}</dd>
              <dt className="text-muted-foreground">sha256</dt>
              <dd className="truncate">{result.file.checksum_sha256}</dd>
              <dt className="text-muted-foreground">size</dt>
              <dd>{result.file.size_bytes ?? "—"} bytes</dd>
              <dt className="text-muted-foreground">storage_path</dt>
              <dd className="truncate">{result.file.storage_path ?? "—"}</dd>
              <dt className="text-muted-foreground">audit_log_id</dt>
              <dd className="truncate">{result.audit_log_id}</dd>
            </dl>
            {result.file.plan_id && (
              <Link
                href={`/plans/${result.file.plan_id}`}
                className="self-start text-xs underline"
              >
                Open plan detail →
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
