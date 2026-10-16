import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authSecret } from "./env";

export const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** HMAC-SHA256 with a purpose label, so a token made for one use can never be accepted for another. */
export function mac(purpose: string, data: string): string {
  return createHmac("sha256", authSecret()).update(`${purpose}\n${data}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const randomId = (bytes = 18) => randomBytes(bytes).toString("base64url");

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Signed, stateless token: base64url(JSON payload) + "." + HMAC. `purpose` is part of the MAC input, not the payload.
 */
export function sign(purpose: string, payload: object): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${mac(purpose, body)}`;
}

/** Returns the payload when the signature is valid, else null. Expiry is checked by the caller. */
export function verify<T extends object>(purpose: string, token: string | undefined | null): T | null {
  if (!token || token.length > 2000) return null;
  const dot = token.indexOf(".");
  if (dot < 1 || token.indexOf(".", dot + 1) !== -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = mac(purpose, body);
  } catch {
    return null;
  }
  if (!safeEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}
