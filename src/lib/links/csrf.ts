import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { isCsrfSecret } from "@/lib/auth/continue";
import { emailLinkSecret } from "./tokens";

/**
 * CSRF for the /e/ action pages, same idea as the sign-in "Continue" page (src/lib/auth/continue.ts):
 * the GET page sets a random cookie, and the form carries a nonce that is an HMAC of the token's
 * jti and that cookie. A POST from another site (or a scanner that never loaded the page in this
 * browser) has no matching cookie, so it cannot act.
 */

export const LINK_CSRF_COOKIE = "pm_link";
const MAX_AGE_SECONDS = 2 * 3600;

export function linkCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().isProduction,
    path: "/e",
    maxAge: MAX_AGE_SECONDS,
  };
}

export function linkNonce(jti: string, cookieSecret: string): string {
  return createHmac("sha256", emailLinkSecret()).update(`link-action:${jti}:${cookieSecret}`).digest("base64url");
}

export function linkNonceMatches(jti: string, cookieSecret: string | undefined, nonce: string | undefined): boolean {
  if (!isCsrfSecret(cookieSecret) || !nonce) return false;
  const expected = Buffer.from(linkNonce(jti, cookieSecret));
  const given = Buffer.from(nonce);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
