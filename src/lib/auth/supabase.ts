import type { Auth } from "./types";

/**
 * Not connected yet. When it is: requestMagicLink will call
 * supabase.auth.signInWithOtp({ email, options: { emailRedirectTo:
 * `${APP_URL}/auth/callback`, shouldCreateUser: true } }), and the callback will
 * exchange the code/token_hash for a session. Supabase sends that email itself,
 * so src/lib/email is not used for sign-in on this backend.
 */
export function createSupabaseAuth(): Auth {
  throw new Error("Supabase backend not configured yet");
}
