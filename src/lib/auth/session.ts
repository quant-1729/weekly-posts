import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";

/**
 * Session = signed JWT (HS256, AUTH_SECRET) in an httpOnly cookie, valid 30
 * days and renewed (sliding) when it is more than a day old. This file uses
 * only jose and env so the proxy can import it.
 */

export const SESSION_COOKIE = "pm_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_REFRESH_AFTER_SECONDS = 24 * 60 * 60;

export interface SessionPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

function key(): Uint8Array {
  return new TextEncoder().encode(getEnv().authSecret);
}

export async function signSession(
  user: { id: string; email: string },
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_MAX_AGE_SECONDS)
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
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    return { sub: payload.sub, email: payload.email, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

export function needsRefresh(payload: SessionPayload, nowMs: number = Date.now()): boolean {
  return Math.floor(nowMs / 1000) - payload.iat > SESSION_REFRESH_AFTER_SECONDS;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().isProduction,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
