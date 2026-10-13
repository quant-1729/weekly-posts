import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";

/**
 * Emailed sign-in token: a signed JWT (HS256, AUTH_SECRET) that carries the
 * normalised email, purpose "magic", the owner's consent, a random jti (so the
 * link works once) and a 15-minute expiry. It has no `sub`, so it can never be
 * accepted as a session cookie (see session.ts).
 */

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const PURPOSE = "magic";

export interface MagicLinkPayload {
  email: string;
  consent: true;
  jti: string;
  exp: number;
}

function key(): Uint8Array {
  return new TextEncoder().encode(getEnv().authSecret);
}

export async function signMagicToken(
  email: string,
  nowMs: number = Date.now(),
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = crypto.randomUUID();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + MAGIC_LINK_TTL_SECONDS;
  const token = await new SignJWT({ email, purpose: PURPOSE, consent: true })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key());
  return { token, jti, expiresAt: new Date(exp * 1000) };
}

/** The payload, or null if the token is missing, forged, expired or not a sign-in token. */
export async function verifyMagicToken(
  token: string | undefined | null,
  nowMs: number = Date.now(),
): Promise<MagicLinkPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
      currentDate: new Date(nowMs),
    });
    if (
      payload.purpose !== PURPOSE ||
      payload.consent !== true ||
      typeof payload.email !== "string" ||
      typeof payload.jti !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    return { email: payload.email, consent: true, jti: payload.jti, exp: payload.exp };
  } catch {
    return null;
  }
}
