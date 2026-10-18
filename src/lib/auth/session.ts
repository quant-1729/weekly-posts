import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";

/**
 * Session = signed JWT (HS256, AUTH_SECRET) in an httpOnly cookie, valid 30
 * days and renewed (sliding) when it is more than a day old. The token carries `sid`, the id of the
 * user_sessions row made at sign-in; a renewal keeps the same sid. A token without a valid sid (signed
 * before sessions existed) counts as signed out everywhere, the proxy included. This file uses
 * only jose and env so the proxy can import it.
 *
 * A demo session (docs/15-demo-login.md) carries `demo: true` and lasts 12 hours; it is never renewed. The claim is a
 * hint for the proxy only: the truth is user_sessions.demo, which getCurrentUser() reads.
 */

export const SESSION_COOKIE = "pm_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_REFRESH_AFTER_SECONDS = 24 * 60 * 60;
/** A demo session (the judges' sign-in) lasts 12 hours and is not renewed. */
export const DEMO_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  sub: string;
  email: string;
  /** user_sessions.id of this sign-in. */
  sid: string;
  /** True for a session started from /demo. */
  demo: boolean;
  iat: number;
  exp: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function key(): Uint8Array {
  return new TextEncoder().encode(getEnv().authSecret);
}

export async function signSession(
  user: { id: string; email: string; sid: string; demo?: boolean },
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ email: user.email, sid: user.sid, ...(user.demo ? { demo: true } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (user.demo ? DEMO_SESSION_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS))
    .sign(key());
}

/** Returns the payload, or null if the token is missing, forged or expired. */
export async function verifySession(
  token: string | undefined | null,
  nowMs: number = Date.now(),
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
      currentDate: new Date(nowMs),
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.sid !== "string" ||
      !UUID_RE.test(payload.sid) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    return { sub: payload.sub, email: payload.email, sid: payload.sid, demo: payload.demo === true, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

export function needsRefresh(payload: SessionPayload, nowMs: number = Date.now()): boolean {
  if (payload.demo) return false; // a demo session ends 12 hours after sign-in
  return Math.floor(nowMs / 1000) - payload.iat > SESSION_REFRESH_AFTER_SECONDS;
}

export function sessionCookieOptions(opts: { demo?: boolean } = {}) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().isProduction,
    path: "/",
    maxAge: opts.demo ? DEMO_SESSION_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS,
  };
}
