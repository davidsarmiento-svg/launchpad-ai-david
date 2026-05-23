import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { DataLayerError } from "@/lib/server/errors";
import {
  type FileKind,
  type FileRow,
  getFileById,
  registerUpload,
} from "@/lib/server/files";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Storage adapter for the single `launchpad-files` bucket.
 *
 * Key layout:   plans/{plan_id}/{file_id}/{filename}
 *
 * Why a uuid segment between `plan_id` and the filename:
 *   - Two uploads with the same filename but different bytes get a
 *     different sha256, so registerUpload() returns different file
 *     rows -> different file_id segment -> no collision.
 *   - The path embeds the row's PK so deleting a plan can rip every
 *     object under `plans/{plan_id}/` and leave no orphans.
 *
 * Auth model: this module only ever runs server-side via the service
 * role, which bypasses Storage's `storage.objects` RLS. We deliberately
 * do not add any storage.objects policies so anon callers stay locked
 * out (matches `lib/server/supabase.ts`).
 */

export const BUCKET = "launchpad-files";

/**
 * Default lifetime for signed download URLs (1 hour). Keep this short
 * so a URL accidentally pasted into chat goes stale quickly.
 */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Hard cap on the upload size. The bucket itself enforces 50 MiB via
 * `file_size_limit`; we enforce the same value here so a Route Handler
 * can reject early with a clean 413 instead of bouncing off Storage.
 */
const MAX_UPLOAD_BYTES = 52_428_800;

const uuid = z.string().uuid();

const fileKind = z.enum([
  "plan_pdf",
  "participant_census",
  "payroll_run",
  "other",
]);

export const uploadFileInputSchema = z.object({
  /**
   * Optional only to allow the first plan-PDF upload (which bootstraps
   * a plans row). Every other code path should pass a plan_id; the
   * Route Handler enforces that.
   */
  plan_id: uuid.optional(),
  kind: fileKind,
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((s) => !s.includes("/") && !s.includes("\\"), {
      message: "filename must not contain path separators",
    }),
  mime_type: z.string().min(1).max(255).optional(),
  uploaded_by: z.string().min(1).max(255).optional(),
  /**
   * Raw bytes for the file. Accept Uint8Array (works in any runtime)
   * or Node Buffer; both are subclasses of Uint8Array so the upload
   * path treats them identically.
   */
  bytes: z.custom<Uint8Array>(
    (val) => val instanceof Uint8Array,
    "bytes must be a Uint8Array (or Node Buffer)",
  ),
});

export type UploadFileInput = z.input<typeof uploadFileInputSchema>;

export type UploadFileResult = {
  file: FileRow;
  /**
   * True when this call inserted a new files row + uploaded fresh
   * bytes. False when an earlier upload of the exact same bytes
   * (same sha256) already existed for this plan and we returned the
   * existing row. Callers can use this to skip re-running expensive
   * downstream work (e.g. re-extracting a PDF).
   */
  created: boolean;
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function objectPath(args: {
  plan_id: string | null;
  file_id: string;
  filename: string;
}): string {
  const planSegment = args.plan_id ?? "unassigned";
  return `plans/${planSegment}/${args.file_id}/${args.filename}`;
}

/**
 * Upload bytes to Storage and register the file in `public.files`.
 *
 * Idempotency contract:
 *   - Same (plan_id, sha256) twice -> the second call returns the
 *     first row with `created: false`, and does NOT re-upload bytes.
 *   - If a previous call inserted the row but the Storage upload
 *     failed (orphan row with storage_path = null), this call will
 *     finish the work by uploading the bytes and back-writing the path.
 *
 * Throws `ZodError` on bad input, `DataLayerError` on Storage or DB
 * failure. The Route Handler is responsible for translating each into
 * the right HTTP response and for writing the audit log row.
 */
export async function uploadFile(
  input: UploadFileInput,
): Promise<UploadFileResult> {
  const parsed = uploadFileInputSchema.parse(input);

  if (parsed.bytes.byteLength === 0) {
    throw new DataLayerError({
      module: "storage",
      operation: "uploadFile",
      message: "file is empty (0 bytes)",
    });
  }
  if (parsed.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new DataLayerError({
      module: "storage",
      operation: "uploadFile",
      message: `file is ${parsed.bytes.byteLength} bytes, exceeds the ${MAX_UPLOAD_BYTES}-byte limit`,
    });
  }

  const checksum = sha256Hex(parsed.bytes);

  const { file, created } = await registerUpload({
    plan_id: parsed.plan_id,
    kind: parsed.kind,
    filename: parsed.filename,
    mime_type: parsed.mime_type,
    size_bytes: parsed.bytes.byteLength,
    checksum_sha256: checksum,
    uploaded_by: parsed.uploaded_by,
  });

  // Fast path: row + bytes both already there. Trust the prior upload.
  if (!created && file.storage_path) {
    return { file, created: false };
  }

  // Either a brand-new row, OR an orphan row whose previous Storage
  // upload failed. Either way, push bytes and ensure storage_path is
  // populated.
  const path = objectPath({
    plan_id: file.plan_id,
    file_id: file.id,
    filename: file.filename,
  });

  const supabase = getSupabaseServiceRoleClient();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, parsed.bytes, {
      contentType: parsed.mime_type ?? "application/octet-stream",
      // `upsert: true` lets us safely recover the orphan-row case
      // without first checking whether an object already lives at this
      // path. For the brand-new-row case the path is guaranteed unique
      // (it embeds the file uuid), so upsert is a no-op.
      upsert: true,
    });

  if (uploadError) {
    throw new DataLayerError({
      module: "storage",
      operation: "uploadFile",
      message: `Storage upload failed: ${uploadError.message}`,
      cause: uploadError,
    });
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from("files")
    .update({ storage_path: path })
    .eq("id", file.id)
    .select("*")
    .single();

  if (updateError || !updatedRow) {
    throw new DataLayerError({
      module: "storage",
      operation: "uploadFile",
      message:
        updateError?.message ??
        "files row update returned no row after Storage upload",
      cause: updateError,
    });
  }

  return { file: updatedRow as FileRow, created };
}

export const getSignedDownloadUrlInputSchema = z.object({
  file_id: uuid,
  ttl_seconds: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 7)
    .default(DEFAULT_SIGNED_URL_TTL_SECONDS),
});

export type GetSignedDownloadUrlInput = z.input<
  typeof getSignedDownloadUrlInputSchema
>;

/**
 * Mint a short-lived signed URL the browser can use to download the
 * file directly from Storage (so the Next.js process doesn't have to
 * proxy bytes). Throws if the file row is missing or has no
 * storage_path yet (i.e. the upload never finished).
 */
export async function getSignedDownloadUrl(
  input: GetSignedDownloadUrlInput,
): Promise<{ url: string; expires_at: string }> {
  const parsed = getSignedDownloadUrlInputSchema.parse(input);

  const row = await getFileById(parsed.file_id);
  if (!row) {
    throw new DataLayerError({
      module: "storage",
      operation: "getSignedDownloadUrl",
      message: `no files row with id ${parsed.file_id}`,
    });
  }
  if (!row.storage_path) {
    throw new DataLayerError({
      module: "storage",
      operation: "getSignedDownloadUrl",
      message: `file ${parsed.file_id} has no storage_path - upload incomplete`,
    });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, parsed.ttl_seconds);

  if (error || !data?.signedUrl) {
    throw new DataLayerError({
      module: "storage",
      operation: "getSignedDownloadUrl",
      message: error?.message ?? "Storage returned no signed URL",
      cause: error,
    });
  }

  return {
    url: data.signedUrl,
    expires_at: new Date(
      Date.now() + parsed.ttl_seconds * 1000,
    ).toISOString(),
  };
}

export type { FileKind, FileRow };
