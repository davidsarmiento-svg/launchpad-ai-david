import { getSupabaseServiceRoleClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";

type HealthResponse = {
  status: "ok" | "degraded";
  environment: string;
  timestamp: string;
  duration_ms: number;
  checks: {
    env: CheckStatus;
    supabase: { status: CheckStatus; error: string | null };
    anthropic: { status: "configured" };
  };
};

export async function GET() {
  const startedAt = Date.now();

  let supabaseStatus: CheckStatus = "ok";
  let supabaseError: string | null = null;

  // We ping audit_logs (rather than auth.admin.listUsers) because that
  // table is the spine of the app. A successful HEAD count proves
  // (a) the URL is right, (b) the service-role key is right, AND
  // (c) the migrations are applied -- a truer "the schema is deployed"
  // signal. `head: true` skips returning rows; only the count comes back.
  try {
    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase
      .from("audit_logs")
      .select("*", { count: "exact", head: true });
    if (error) {
      supabaseStatus = "error";
      supabaseError = error.message;
    }
  } catch (err) {
    supabaseStatus = "error";
    supabaseError = err instanceof Error ? err.message : String(err);
  }

  const body: HealthResponse = {
    status: supabaseStatus === "ok" ? "ok" : "degraded",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    checks: {
      env: "ok",
      supabase: { status: supabaseStatus, error: supabaseError },
      anthropic: { status: "configured" },
    },
  };

  return Response.json(body, {
    status: supabaseStatus === "ok" ? 200 : 503,
  });
}
