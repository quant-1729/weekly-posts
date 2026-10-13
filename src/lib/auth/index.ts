import { cache } from "react";
import { getEnv } from "@/lib/env";
import { createMockAuth } from "./mock";
import { createSupabaseAuth } from "./supabase";
import type { Auth, AuthUser } from "./types";

export { AuthError } from "./types";
export type { Auth, AuthUser, AuthErrorCode } from "./types";
export { normalizeEmail } from "./email";

/** Selected by DATA_BACKEND. */
export function getAuth(): Auth {
  return getEnv().dataBackend === "supabase" ? createSupabaseAuth() : createMockAuth();
}

export const requestMagicLink = (email: string, consent: boolean, opts?: { ip?: string }) =>
  getAuth().requestMagicLink(email, consent, opts);
export const checkMagicLink = (token: string) => getAuth().checkMagicLink(token);
export const consumeMagicLink = (token: string) => getAuth().consumeMagicLink(token);
export const signOut = () => getAuth().signOut();

const currentUserCached = cache(() => getAuth().getCurrentUser());
/** Per-request cached, so a layout and its page share one lookup. */
export function getCurrentUser(): Promise<AuthUser | null> {
  return currentUserCached();
}
