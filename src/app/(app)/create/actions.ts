"use server";

import { getCurrentUser } from "@/lib/auth";
import { requireBrandMember } from "@/lib/brand/current";
import { briefFromText, describeBriefTextError, type BriefFromTextResult } from "@/lib/briefs/from-text";
import { describeBriefError, type BriefFailure } from "@/lib/briefs/messages";
import { saveBriefFromEditor } from "@/lib/briefs/save";
import type { Brief } from "@/lib/briefs/types";
import { s } from "@/lib/i18n/strings";
import { checkQrUrl } from "@/lib/qr";
import { UspLimitError, UspNotFoundError, UspValidationError } from "@/lib/usps/errors";
import { createUsp, setUspConfirmed } from "@/lib/usps/service";
import type { Usp } from "@/lib/usps/types";

/**
 * Server actions of the brief editor (Details step). Each checks the signed-in user first; the
 * library functions then check brand membership and validate every field again.
 */

const str = (v: unknown) => (typeof v === "string" ? v : "");
const signedOut: BriefFailure = { ok: false, code: "generic", message: s.errors.signedOut };

export type SaveResult = { ok: true; brief: Brief; qrError: string | null } | BriefFailure;

/**
 * Autosave (`status` "draft") and "Next" (`status` "ready"). `briefId` null creates the brief.
 * "ready" is refused with the list of missing items when the brief is incomplete.
 */
export async function saveBriefAction(brandId: string, briefId: string | null, input: unknown, status: "draft" | "ready" = "draft"): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  try {
    const out = await saveBriefFromEditor(user.id, str(brandId), briefId === null ? null : str(briefId), (input ?? {}) as object, {
      status: status === "ready" ? "ready" : "draft",
    });
    return { ok: true, ...out };
  } catch (e) {
    return describeBriefError(e);
  }
}

export type DescribeResult = ({ ok: true } & { result: BriefFromTextResult }) | { ok: false; code: string; message: string };

/** "Describe your post": typed text, or the transcript of a voice note. Never saves anything. */
export async function describePostAction(brandId: string, text: string): Promise<DescribeResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "generic", message: s.errors.signedOut };
  try {
    return { ok: true, result: await briefFromText({ userId: user.id, brandId: str(brandId), text: str(text) }) };
  } catch (e) {
    const known = describeBriefTextError(e);
    if (known) return { ok: false, ...known };
    console.error("[create] describe failed", e);
    return { ok: false, code: "generic", message: s.errors.generic };
  }
}

export type LinkCheckResult = { ok: true; url: string } | { ok: false; message: string };

/** Checks a QR link (public https address that resolves) before it is saved. */
export async function checkQrLinkAction(brandId: string, url: string): Promise<LinkCheckResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.errors.signedOut };
  try {
    await requireBrandMember(user.id, str(brandId));
  } catch {
    return { ok: false, message: s.brandV2.notFound };
  }
  const check = await checkQrUrl(str(url));
  if (check.ok) return { ok: true, url: check.url };
  const t = s.create.qr.errors as Record<string, string>;
  return { ok: false, message: t[check.reason] ?? t.generic };
}

// --- Selling points, from inside the editor -------------------------------------------------
//
// These do what the Brand page actions do, but WITHOUT `revalidatePath`. Revalidating makes Next
// re-render the current page from the server; the editor (which lives at /create and then
// /create/{id}) would be rebuilt from the saved draft and lose the owner's selection made a moment
// earlier (the new point stayed on "None"). The Brand page is dynamic, so it needs no revalidation.

export type UspResult = { ok: true; usp: Usp } | { ok: false; message: string; fieldErrors?: Record<string, string> };

function uspFailure(e: unknown): UspResult {
  const u = s.usps.errors as Record<string, string>;
  if (e instanceof UspValidationError) {
    const text = (code: string) => u[code] ?? (code.includes(" ") ? code : u.invalid);
    return { ok: false, message: u.invalid, fieldErrors: Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, text(v)])) };
  }
  if (e instanceof UspNotFoundError) return { ok: false, message: u.not_found };
  if (e instanceof UspLimitError) return { ok: false, message: u.limit };
  console.error("[create] selling point failed", e);
  return { ok: false, message: s.errors.generic };
}

/** Saves a new selling point to the library (from the inline form, or an accepted suggestion). */
export async function addUspAction(brandId: string, input: unknown): Promise<UspResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.errors.signedOut };
  try {
    return { ok: true, usp: await createUsp(user.id, str(brandId), input) };
  } catch (e) {
    return uspFailure(e);
  }
}

/** The owner ticks "Confirm" on a claim that needs it. */
export async function confirmUspHereAction(brandId: string, id: string): Promise<UspResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.errors.signedOut };
  try {
    return { ok: true, usp: await setUspConfirmed(user.id, str(brandId), str(id), true) };
  } catch (e) {
    return uspFailure(e);
  }
}
