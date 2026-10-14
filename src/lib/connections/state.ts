// The signed `state` that travels through Meta's authorize page and back (C-25). A JWT (HS256) with a key
// derived from AUTH_SECRET and a label of its own, so it can never be accepted as a session or a sign-in
// link. It carries the brand, the signed-in user, the provider and a random nonce; the same nonce is set in
// an httpOnly cookie when the owner starts, and the callback needs both (so a link someone else started
// does not connect their account to ours). Expires in 10 minutes.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";
import { PROVIDERS, type Provider } from "@/lib/queue/types";

export const CONNECT_STATE_TTL_SECONDS = 10 * 60;
export const CONNECT_NONCE_COOKIE = "pm_connect_nonce";
const PURPOSE = "connect";
const LABEL = "weeklyposts/connect-state/v1";

export interface ConnectState {
  brandId: string;
  userId: string;
  provider: Provider;
  nonce: string;
  exp: number;
}

function key(): Uint8Array {
  return new Uint8Array(createHmac("sha256", getEnv().authSecret).update(LABEL).digest());
}

export const newNonce = () => randomBytes(18).toString("base64url");

export async function signConnectState(
  input: { brandId: string; userId: string; provider: Provider; nonce?: string },
  nowMs: number = Date.now(),
): Promise<{ state: string; nonce: string }> {
  const nonce = input.nonce ?? newNonce();
  const iat = Math.floor(nowMs / 1000);
  const state = await new SignJWT({ purpose: PURPOSE, brand: input.brandId, uid: input.userId, provider: input.provider, nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + CONNECT_STATE_TTL_SECONDS)
    .sign(key());
  return { state, nonce };
}

/** The payload, or null when the state is missing, forged, expired or for something else. */
export async function verifyConnectState(state: string | null | undefined, nowMs: number = Date.now()): Promise<ConnectState | null> {
  if (!state || state.length > 2000) return null;
  try {
    const { payload } = await jwtVerify(state, key(), { algorithms: ["HS256"], currentDate: new Date(nowMs) });
    if (
      payload.purpose !== PURPOSE ||
      typeof payload.brand !== "string" ||
      typeof payload.uid !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.exp !== "number" ||
      !(PROVIDERS as readonly string[]).includes(payload.provider as string)
    ) {
      return null;
    }
    return { brandId: payload.brand, userId: payload.uid, provider: payload.provider as Provider, nonce: payload.nonce, exp: payload.exp };
  } catch {
    return null;
  }
}

export function nonceMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
