import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit-log";
import { toErrorResponse } from "@/lib/server/http";
import { createPayrollRun } from "@/lib/server/payroll-runs";
import { uploadFile } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/**
 * POST /api/upload
 *
 * Multipart upload entry point used by the Upload card on the home
 * page. Expects form fields:
 *   - file        : File   (required)
 *   - plan_id     : uuid   (required, the plan the file belongs to)
 *   - kind        : enum   (required: plan_pdf | participant_census | payroll_run | other)
 *   - uploaded_by : string (optional, defaults to "system_demo_user")
 *
 * Note on `plan_pdf`: this endpoint accepts the upload itself but does
 * NOT trigger extraction. The Plan Extraction Agent runs on a separate
 * call to POST /api/plans/[id]/extract once the file is in Storage.
 * Two-step on purpose -- upload latency and extraction latency have
 * very different shapes (bytes vs. an LLM round-trip with retries).
 *
 * Behavior:
 *   1. Stream the upload through `uploadFile` (sha256 + idempotent
 *      registerUpload + Storage push + back-write storage_path).
 *   2. Write an audit-log row tagged with the actor, action, entity
 *      ids, and a {filename, sha256, size_bytes, created} after_value
 *      so the Audit Trail can show exactly what landed.
 *   3. Return the file row + audit-log id + a `created` flag so the
 *      UI can show "uploaded" vs "already present".
 */

const uploadFormSchema = z.object({
  plan_id: z.string().uuid("plan_id must be a valid uuid"),
  kind: z.enum(["plan_pdf", "participant_census", "payroll_run", "other"]),
  uploaded_by: z.string().min(1).max(255).optional(),
});

export async function POST(request: Request) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch (err) {
      return Response.json(
        {
          error: "invalid_request",
          message: `expected multipart/form-data: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        { status: 400 },
      );
    }

    const fileEntry = form.get("file");
    if (!(fileEntry instanceof File)) {
      return Response.json(
        {
          error: "invalid_request",
          message: "missing form field 'file'",
        },
        { status: 400 },
      );
    }

    const fields = uploadFormSchema.parse({
      plan_id: form.get("plan_id"),
      kind: form.get("kind"),
      uploaded_by: form.get("uploaded_by") ?? undefined,
    });

    const bytes = new Uint8Array(await fileEntry.arrayBuffer());

    const { file, created } = await uploadFile({
      plan_id: fields.plan_id,
      kind: fields.kind,
      filename: fileEntry.name,
      mime_type: fileEntry.type || undefined,
      uploaded_by: fields.uploaded_by ?? "system_demo_user",
      bytes,
    });

    const audit = await writeAuditLog({
      actor_type: "user",
      actor_name: fields.uploaded_by ?? "system_demo_user",
      action: created ? "FILE_UPLOADED" : "FILE_UPLOAD_DEDUPED",
      entity_type: "file",
      entity_id: file.id,
      after_value: {
        plan_id: file.plan_id,
        filename: file.filename,
        kind: file.kind,
        size_bytes: file.size_bytes,
        sha256: file.checksum_sha256,
        storage_path: file.storage_path,
        created,
      },
      reason: created
        ? "New file uploaded via POST /api/upload"
        : "Re-upload of identical bytes - returned existing files row",
    });

    // Payroll uploads need a `payroll_runs` row to anchor the mapping
    // and reconciliation pipeline. We only create one on the fresh-
    // upload path: createPayrollRun is itself idempotent on
    // source_file_id, but writing the PAYROLL_RUN_CREATED audit row
    // only when `runCreated === true` keeps the audit ledger free of
    // noise on dedupe re-uploads.
    let payroll_run_id: string | undefined;
    let payroll_run_created: boolean | undefined;
    if (file.kind === "payroll_run" && file.plan_id) {
      const { run, created: runCreated } = await createPayrollRun({
        plan_id: file.plan_id,
        source_file_id: file.id,
      });
      payroll_run_id = run.id;
      payroll_run_created = runCreated;

      if (runCreated) {
        await writeAuditLog({
          actor_type: "user",
          actor_name: fields.uploaded_by ?? "system_demo_user",
          action: "PAYROLL_RUN_CREATED",
          entity_type: "payroll_run",
          entity_id: run.id,
          payroll_run_id: run.id,
          after_value: {
            plan_id: run.plan_id,
            source_file_id: run.source_file_id,
            status: run.status,
          },
          reason:
            "payroll_runs row created on payroll_run upload via POST /api/upload",
        });
      }
    }

    return Response.json(
      {
        file,
        created,
        audit_log_id: audit.id,
        ...(payroll_run_id ? { payroll_run_id, payroll_run_created } : {}),
      },
      { status: created ? 201 : 200 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
