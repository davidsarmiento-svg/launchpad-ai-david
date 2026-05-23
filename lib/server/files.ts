import "server-only";

import { z } from "zod";

import { DataLayerError } from "@/lib/server/errors";
import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

/**
 * Data access for the `files` upload manifest.
 *
 * The DB-level `unique (plan_id, checksum_sha256)` guarantees that the
 * same physical file inside the same plan only ever gets one row, so
 * re-uploads (clicking "Upload" twice, retrying a failed run) are
 * idempotent. `registerUpload` leans on that constraint instead of a
 * "select then insert" race.
 */

const fileKindValues = [
  "plan_pdf",
  "participant_census",
  "payroll_run",
  "other",
] as const;

export type FileKind = (typeof fileKindValues)[number];

export type FileRow = {
  id: string;
  plan_id: string | null;
  kind: FileKind;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  checksum_sha256: string;
  storage_path: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

const uuid = z.string().uuid();
const sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "must be a 64-char lowercase sha256 hex string");

export const registerUploadInputSchema = z.object({
  /**
   * Optional during the very first plan-PDF upload, which has to land
   * before a `plans` row exists. Required for every other file kind in
   * practice; the route handlers should enforce that.
   */
  plan_id: uuid.optional(),
  kind: z.enum(fileKindValues),
  filename: z.string().min(1),
  mime_type: z.string().min(1).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  checksum_sha256: sha256,
  storage_path: z.string().min(1).optional(),
  uploaded_by: z.string().min(1).optional(),
});

export type RegisterUploadInput = z.infer<typeof registerUploadInputSchema>;

/**
 * Insert a row into `files`, OR return the existing row if the same
 * `(plan_id, checksum_sha256)` pair already exists. The boolean
 * `created` flag tells callers which path was taken so they can skip
 * re-running expensive downstream work (e.g. re-extracting a PDF).
 */
export async function registerUpload(
  input: RegisterUploadInput,
): Promise<{ file: FileRow; created: boolean }> {
  const parsed = registerUploadInputSchema.parse(input);

  if (parsed.plan_id) {
    const existing = await getFileByChecksum({
      plan_id: parsed.plan_id,
      checksum_sha256: parsed.checksum_sha256,
    });
    if (existing) {
      return { file: existing, created: false };
    }
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("files")
    .insert(parsed)
    .select("*")
    .single();

  if (error || !data) {
    throw new DataLayerError({
      module: "files",
      operation: "registerUpload",
      message: error?.message ?? "insert returned no row",
      cause: error,
    });
  }

  return { file: data as FileRow, created: true };
}

export const getFileByChecksumInputSchema = z.object({
  plan_id: uuid,
  checksum_sha256: sha256,
});

export type GetFileByChecksumInput = z.infer<
  typeof getFileByChecksumInputSchema
>;

/**
 * Look up a file by its `(plan_id, checksum)` natural key. Returns
 * `null` when nothing matches.
 */
export async function getFileByChecksum(
  input: GetFileByChecksumInput,
): Promise<FileRow | null> {
  const parsed = getFileByChecksumInputSchema.parse(input);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("plan_id", parsed.plan_id)
    .eq("checksum_sha256", parsed.checksum_sha256)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "files",
      operation: "getFileByChecksum",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as FileRow | null;
}

/**
 * Look up a file by its uuid. Used after upload to fetch metadata for
 * download / agent processing. Returns `null` when not found.
 */
export async function getFileById(id: string): Promise<FileRow | null> {
  uuid.parse(id);

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new DataLayerError({
      module: "files",
      operation: "getFileById",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? null) as FileRow | null;
}

/**
 * List files for a plan, most recently uploaded first. Used by the
 * Plan Details and Audit Trail screens.
 */
export async function listFilesForPlan(
  plan_id: string,
  kind?: FileKind,
): Promise<FileRow[]> {
  uuid.parse(plan_id);
  if (kind !== undefined) z.enum(fileKindValues).parse(kind);

  const supabase = getSupabaseServiceRoleClient();
  let q = supabase
    .from("files")
    .select("*")
    .eq("plan_id", plan_id)
    .order("uploaded_at", { ascending: false });
  if (kind) q = q.eq("kind", kind);

  const { data, error } = await q;
  if (error) {
    throw new DataLayerError({
      module: "files",
      operation: "listFilesForPlan",
      message: error.message,
      cause: error,
    });
  }

  return (data ?? []) as FileRow[];
}
