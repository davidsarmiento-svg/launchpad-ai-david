import "server-only";

import { z, ZodError } from "zod";

import { DataLayerError } from "@/lib/server/errors";

/**
 * Translate any error thrown by a data-access call into a Response.
 *
 *   - ZodError              -> 400 with the field-level issues exposed.
 *   - DataLayerError        -> 500 with the module/operation tag (and
 *                              the message, since we authored it and
 *                              it's safe to surface).
 *   - everything else       -> 500 with a generic message; the real
 *                              cause is logged server-side.
 *
 * Keep this thin -- Route Handlers should be a 3-line shape:
 *   try { ... return Response.json(result) }
 *   catch (err) { return toErrorResponse(err) }
 */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return Response.json(
      {
        error: "validation_failed",
        issues: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  if (err instanceof DataLayerError) {
    console.error(`[${err.module}/${err.operation}]`, err.cause ?? err.message);
    return Response.json(
      {
        error: "data_layer_error",
        module: err.module,
        operation: err.operation,
        message: err.message,
      },
      { status: 500 },
    );
  }

  console.error("[unhandled]", err);
  return Response.json(
    {
      error: "internal_error",
      message: err instanceof Error ? err.message : "unknown error",
    },
    { status: 500 },
  );
}

/**
 * Read and validate a JSON request body. Throws ZodError on invalid
 * input -- the caller's try/catch hands that to toErrorResponse() and
 * the client gets a clean 400.
 */
export async function readJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  return schema.parse(body);
}
