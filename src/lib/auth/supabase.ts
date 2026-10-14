import { findOrCreateSupabaseUser } from "@/lib/supabase/users";
import { createLinkAuth } from "./links";
import type { Auth } from "./types";

/**
 * Supabase sign-in (D8): the app's own magic links (links.ts), not Supabase Auth emails.
 * Users are found and created in src/lib/supabase/users.ts.
 */
export function createSupabaseAuth(): Auth {
  return createLinkAuth({ findOrCreateUser: findOrCreateSupabaseUser });
}
