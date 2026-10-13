"use server";

import { headers } from "next/headers";
import { AuthError, normalizeEmail, requestMagicLink } from "@/lib/auth";

export type ActionResult = { ok: true; email: string } | { ok: false; error: string };

function toError(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  console.error("[auth]", e);
  return { ok: false, error: "generic" };
}

async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
}

/**
 * Emails a sign-in link. The answer is the same whether or not the address has
 * an account, so it cannot be used to find out who is signed up.
 */
export async function requestLinkAction(email: string, consent: boolean): Promise<ActionResult> {
  if (consent !== true) return { ok: false, error: "consent_required" };
  try {
    await requestMagicLink(email, consent, { ip: await clientIp() });
    return { ok: true, email: normalizeEmail(email) ?? email };
  } catch (e) {
    return toError(e);
  }
}
