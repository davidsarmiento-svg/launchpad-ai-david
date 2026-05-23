import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/server/env";

let cachedServiceRoleClient: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses Row Level Security and must only
 * ever be used from server code (Route Handlers, Server Components, server
 * actions). The `server-only` import above will fail the build if this
 * module is ever pulled into a Client Component.
 */
export function getSupabaseServiceRoleClient(): SupabaseClient {
  if (!cachedServiceRoleClient) {
    cachedServiceRoleClient = createClient(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }
  return cachedServiceRoleClient;
}
