"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PlanOnboardingSummary } from "@/lib/server/plan-onboarding-summaries";

type UploadKind =
  | "plan_pdf"
  | "participant_census"
  | "payroll_run"
  | "other";

export function UploadPanel({
  plans,
  onPlanCreated,
}: {
  plans: PlanOnboardingSummary[];
  onPlanCreated?: (plan: PlanOnboardingSummary) => void;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [kind, setKind] = useState<UploadKind>("plan_pdf");
  const [file, setFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
      onPlanCreated?.(summary);
      setPlanId(summary.id);
      setMessage("Demo plan created.");
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
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("plan_id", planId);
      form.append("kind", kind);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Upload failed");
      setMessage(
        `${body.created ? "Uploaded" : "Deduped"}: ${body.file.filename}`,
      );
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="rounded-[1.25rem] border-[#E5E7EB] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-[#07133F]">Quick upload</CardTitle>
        <CardDescription className="text-[#64748B]">
          Attach files to a plan before working in each module. All agent
          changes require your approval.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleUpload} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCreatePlan}
              disabled={creating}
              className="border-[#E5E7EB]"
            >
              {creating ? "Creating…" : "New demo plan"}
            </Button>
          </div>

          <select
            className="h-10 rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            required
          >
            <option value="" disabled>
              Select plan…
            </option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.employer_name}
              </option>
            ))}
          </select>

          <select
            className="h-10 rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as UploadKind)}
          >
            <option value="plan_pdf">Plan PDF</option>
            <option value="participant_census">Participant census</option>
            <option value="payroll_run">Payroll run CSV</option>
          </select>

          <Input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-xl border-[#E5E7EB]"
            required
          />

          <Button
            type="submit"
            disabled={uploading || !planId || !file}
            className="bg-[#4F46E5] hover:bg-[#4338CA]"
          >
            {uploading ? "Uploading…" : "Upload file"}
          </Button>

          {message && (
            <p className="text-sm text-[#0F766E]">{message}</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
