import { createHash, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { s } from "@/lib/i18n/strings";

/**
 * The judges' demo sign-in (docs/15-demo-login.md). The demo exists only when both DEMO_LOGIN_EMAIL and
 * DEMO_ACCESS_CODE are set. Actions that must not run in a demo session call `refuseInDemo` (or `isDemoUser`)
 * on the server, in the action or route itself; hiding a button is never the only guard.
 */

/** Most wrong or right tries one network (IP hash) gets in a window. */
export const DEMO_ATTEMPTS = 10;
export const DEMO_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** The demo's two settings, or null when either is empty (the page says "not available" and the route answers 404). */
export function demoConfig(): { email: string; accessCode: string } | null {
  const { email, accessCode } = getEnv().demo;
  return email && accessCode ? { email, accessCode } : null;
}

/** Compares in constant time: both sides are hashed to the same length first, so length does not leak either. */
export function codeMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** True when the signed-in user (from getCurrentUser()) is in a demo session. */
export function isDemoUser(user: { demo?: boolean } | null | undefined): boolean {
  return user?.demo === true;
}

/** What a refused action tells the owner. */
export const DEMO_REFUSED = s.demo.refused;

/** The refusal message when this user is in a demo session, else null. Use as: `if (refuseInDemo(user)) return { ok: false, ... }`. */
export function refuseInDemo(user: { demo?: boolean } | null | undefined): string | null {
  return isDemoUser(user) ? DEMO_REFUSED : null;
}
