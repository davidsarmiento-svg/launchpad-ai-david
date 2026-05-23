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

  try {
    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase.auth.admin.listUsers({ perPage: 1 });
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
