import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Supabase client with the service role key: Auth admin API (create and delete users) and
 * Storage. SERVER ONLY. The key comes from SUPABASE_SERVICE_ROLE_KEY, which has no
 * NEXT_PUBLIC_ prefix, so Next never sends it to the browser; never import this file from
 * a client component. Nothing is persisted: no session, no token refresh.
 */

const g = globalThis as unknown as { __postmitraSupabaseAdmin?: SupabaseClient };

export function getSupabaseAdmin(): SupabaseClient {
  if (!g.__postmitraSupabaseAdmin) {
    const { supabaseUrl, supabaseServiceRoleKey } = getEnv();
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when DATA_BACKEND is supabase.",
      );
    }
    g.__postmitraSupabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return g.__postmitraSupabaseAdmin;
}
