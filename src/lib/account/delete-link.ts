import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/db";
import { isCsrfSecret, newCsrfSecret } from "@/lib/auth/continue";

/**
 * The emailed "delete my account" link (Req 22).
 *
 * The token is a signed JWT (HS256, AUTH_SECRET): purpose "delete_account", the user id in `uid`,
 * the email, a random jti and a 1-hour expiry. The user id is deliberately NOT in `sub`: a token
 * with `sub` and `email` would pass for a session cookie (see auth/session.ts). The purpose also
 * keeps it from working as a sign-in link, and a sign-in link from working here.
 *
 * Single use: the jti hash is stored in public.used_tokens when the link is emailed and claimed (marked used) by the POST that
 * deletes. If the delete fails the claim is released, so the owner can try the same link again.
 */

export const DELETE_LINK_TTL_SECONDS = 60 * 60;
const PURPOSE = "delete_account";

export { isCsrfSecret, newCsrfSecret };

export interface DeleteLinkPayload {
  uid: string;
  email: string;
  jti: string;
  exp: number;
}

function key(): Uint8Array {
  return new TextEncoder().encode(getEnv().authSecret);
}

export async function signDeleteToken(
  user: { id: string; email: string },
  nowMs: number = Date.now(),
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = crypto.randomUUID();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + DELETE_LINK_TTL_SECONDS;
  const token = await new SignJWT({ uid: user.id, email: user.email, purpose: PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key());
  return { token, jti, expiresAt: new Date(exp * 1000) };
}

/** The payload, or null if the token is missing, forged, expired or not a delete-account token. */
export async function verifyDeleteToken(
  token: string | undefined | null,
  nowMs: number = Date.now(),
): Promise<DeleteLinkPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], currentDate: new Date(nowMs) });
    if (
      payload.purpose !== PURPOSE ||
      typeof payload.uid !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.jti !== "string" ||
      typeof payload.exp !== "number" ||
      payload.sub !== undefined
    ) {
      return null;
    }
    return { uid: payload.uid, email: payload.email, jti: payload.jti, exp: payload.exp };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Single-use store: public.used_tokens (purpose delete_account), through withService, the same
// code on the mock and the Supabase backend. Only a sha256 of the jti is kept, no personal data.
// ---------------------------------------------------------------------------

const PURPOSE_COLUMN = PURPOSE;
/** Rows are kept this long after they expire, then removed when a new delete request is made. */
export const USED_TOKEN_RETENTION_DAYS = 7;

export const jtiHash = (jti: string): string => createHash("sha256").update(jti).digest("hex");

/** Remembers a freshly signed link, so it can be used once. Also clears rows that expired over 7 days ago. */
export async function registerDeleteLink(jti: string, expiresAt: Date): Promise<void> {
  await getDb().withService(async (tx) => {
    await tx.query("delete from public.used_tokens where expires_at < now() - ($1::int * interval '1 day')", [
      USED_TOKEN_RETENTION_DAYS,
    ]);
    await tx.query("insert into public.used_tokens (jti_hash, purpose, expires_at) values ($1, $2, $3)", [
      jtiHash(jti),
      PURPOSE_COLUMN,
      expiresAt.toISOString(),
    ]);
  });
}

/** True when the link was issued by us and has not been used. Changes nothing (GET must not act). */
export async function isDeleteLinkUnused(jti: string): Promise<boolean> {
  const found = await getDb().withService((tx) =>
    tx.query("select 1 from public.used_tokens where jti_hash = $1 and purpose = $2 and used_at is null", [
      jtiHash(jti),
      PURPOSE_COLUMN,
    ]),
  );
  return found.length > 0;
}

/** Marks the link used. One statement, so of two clicks at once only one wins. */
export async function claimDeleteLink(jti: string): Promise<boolean> {
  const won = await getDb().withService((tx) =>
    tx.query(
      "update public.used_tokens set used_at = now() where jti_hash = $1 and purpose = $2 and used_at is null returning jti_hash",
      [jtiHash(jti), PURPOSE_COLUMN],
    ),
  );
  return won.length > 0;
}

/** Gives a claimed link back after a failed delete, so the owner can retry with it. */
export async function releaseDeleteLink(jti: string): Promise<void> {
  await getDb().withService((tx) =>
    tx.query("update public.used_tokens set used_at = null where jti_hash = $1 and purpose = $2", [
      jtiHash(jti),
      PURPOSE_COLUMN,
    ]),
  );
}

// ---------------------------------------------------------------------------
// CSRF, the same pattern as auth/continue.ts: a random cookie plus a form nonce that is an HMAC
// of the jti and that cookie. A cross-site POST has neither. The prefix keeps a nonce made for
// the sign-in page from working here.
// ---------------------------------------------------------------------------

export const DELETE_CSRF_COOKIE = "pm_delete";

export function deleteCsrfCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().isProduction,
    path: "/account/delete",
    maxAge: DELETE_LINK_TTL_SECONDS,
  };
}

export function deleteNonce(jti: string, cookieSecret: string): string {
  return createHmac("sha256", getEnv().authSecret).update(`delete-account:${jti}:${cookieSecret}`).digest("base64url");
}

export function deleteNonceMatches(jti: string, cookieSecret: string | undefined, nonce: string | undefined): boolean {
  if (!isCsrfSecret(cookieSecret) || !nonce) return false;
  const expected = Buffer.from(deleteNonce(jti, cookieSecret));
  const given = Buffer.from(nonce);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
