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
import { ONBOARDING_HOME } from "@/lib/plan-dashboard-sections";
import type { PlanOnboardingSummary } from "@/lib/server/plan-onboarding-summaries";

type UploadKind =
  | "plan_pdf"
  | "participant_census"
  | "payroll_run"
  | "other";

type UploadResponse = {
  file: { id: string; filename: string; kind: string };
  created: boolean;
  audit_log_id: string;
};

function statusBadge(status: string) {
  if (status === "approved" || status === "active") return "default" as const;
  if (status === "failed") return "destructive" as const;
  return "secondary" as const;
}

export function OnboardingHomeClient({
  initialSummaries,
}: {
  initialSummaries: PlanOnboardingSummary[];
}) {
  const [summaries, setSummaries] =
    useState<PlanOnboardingSummary[]>(initialSummaries);
  const [planId, setPlanId] = useState<string>(initialSummaries[0]?.id ?? "");
  const [kind, setKind] = useState<UploadKind>("plan_pdf");
  const [file, setFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);

  async function handleCreatePlan() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employer_name: "Acme Robotics",
          plan_name: "Acme Robotics 401(k) Plan",
          plan_year: new Date().getFullYear(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Failed to create plan");
      const summary: PlanOnboardingSummary = {
        id: body.plan.id,
        employer_name: body.plan.employer_name,
        plan_name: body.plan.plan_name,
        plan_year: body.plan.plan_year,
        status: body.plan.status,
        extraction_status: body.plan.extraction_status ?? "pending",
        created_at: body.plan.created_at,
        participant_count: 0,
        payroll_run_count: 0,
        runs_mapped: 0,
        runs_reconciled: 0,
        open_issues: 0,
        has_pending_mapping: false,
      };
      setSummaries((prev) => [summary, ...prev]);
      setPlanId(summary.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !planId) return;
    setUploading(true);
    setError(null);
    setUploadResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("plan_id", planId);
      form.append("kind", kind);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Upload failed");
      setUploadResult(body);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">LaunchPad AI</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {ONBOARDING_HOME.label}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          {ONBOARDING_HOME.description} Select a plan to open its seven
          workflow sections — plan details, participants, mapping, runs,
          issues, audit trail, and assistant.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Plans in onboarding</h2>
            <Button
              type="button"
              variant="outline"
              onClick={handleCreatePlan}
              disabled={creating}
            >
              {creating ? "Creating…" : "New demo plan"}
            </Button>
          </div>

          {summaries.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No plans yet. Create a demo plan to start the Acme onboarding
                flow.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {summaries.map((plan) => (
                <Card key={plan.id} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">
                          {plan.employer_name}
                        </CardTitle>
                        <CardDescription>
                          {plan.plan_name ?? "401(k) plan"}
                          {plan.plan_year ? ` · ${plan.plan_year}` : ""}
                        </CardDescription>
                      </div>
                      <Badge variant={statusBadge(plan.extraction_status)}>
                        {plan.extraction_status.replace("_", " ")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Participants</dt>
                        <dd className="font-medium">{plan.participant_count}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Payroll runs</dt>
                        <dd className="font-medium">
                          {plan.runs_reconciled}/{plan.payroll_run_count}{" "}
                          reconciled
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Open issues</dt>
                        <dd className="font-medium">{plan.open_issues}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Mapping</dt>
                        <dd className="font-medium">
                          {plan.has_pending_mapping
                            ? "Needs review"
                            : plan.runs_mapped > 0
                              ? "Approved"
                              : "Not started"}
                        </dd>
                      </div>
                    </dl>
                    <Link
                      href={`/plans/${plan.id}/plan-details`}
                      className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Open plan dashboard
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle>Upload a file</CardTitle>
            <CardDescription>
              Attach documents to a plan before working in its sections.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Plan</span>
                <select
                  className="h-9 rounded-md border bg-background px-3"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a plan…
                  </option>
                  {summaries.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.employer_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">File type</span>
                <select
                  className="h-9 rounded-md border bg-background px-3"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as UploadKind)}
                >
                  <option value="plan_pdf">Plan PDF</option>
                  <option value="participant_census">Participant census</option>
                  <option value="payroll_run">Payroll run CSV</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">File</span>
                <Input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
              </label>

              <Button type="submit" disabled={uploading || !planId || !file}>
                {uploading ? "Uploading…" : "Upload"}
              </Button>

              {uploadResult && (
                <p className="text-sm text-muted-foreground">
                  {uploadResult.created ? "Uploaded" : "Deduped"}:{" "}
                  <span className="font-mono">{uploadResult.file.filename}</span>
                </p>
              )}
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
