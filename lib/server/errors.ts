import "server-only";

/**
 * Thrown by data-access modules in `lib/server/` when a Supabase call
 * returns an error. Wrapping these gives Route Handlers a single,
 * stable error type to translate to HTTP responses, and keeps the raw
 * Supabase / PostgREST error shape from leaking out of the data layer.
 *
 * Inputs validated by Zod throw `ZodError` directly. Callers that need
 * to distinguish "the request was malformed" from "the DB write failed"
 * should check `err instanceof DataLayerError` vs `err instanceof
 * z.ZodError`.
 */
export class DataLayerError extends Error {
  readonly module: string;
  readonly operation: string;
  readonly cause: unknown;

  constructor(args: {
    module: string;
    operation: string;
    message: string;
    cause?: unknown;
  }) {
    super(`[${args.module}/${args.operation}] ${args.message}`);
    this.name = "DataLayerError";
    this.module = args.module;
    this.operation = args.operation;
    this.cause = args.cause;
  }
}
