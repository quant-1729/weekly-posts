// GET and POST /p/[token]: the emailed link that confirms a payment ID (change C-10).
// Same rule as docs/email-links.md: GET only shows a page and changes nothing (mail scanners
// open every link); POST acts, with a CSRF nonce bound to this browser's cookie.

import { createHmac, timingSafeEqual } from "node:crypto";
import { isCsrfSecret, newCsrfSecret } from "@/lib/auth/continue";
import { getEnv } from "@/lib/env";
import { LINK_PAGE_HEADERS, type LinkResponse } from "@/lib/links/dispatch";
import { buttonStyle, esc, messagePage, para, renderPage, type LinkPage } from "@/lib/links/page";
import { emailLinkSecret } from "@/lib/links/tokens";
import { PAYMENT_SCHEMES } from "@/lib/qr/payment";
import { paymentCopy as copy } from "./copy";
import { confirmPaymentId, hashToken, peekConfirmation, type ConfirmLookup } from "./index";

export { LINK_PAGE_HEADERS };

export const PAYMENT_CSRF_COOKIE = "pm_pay";

export function paymentCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: getEnv().isProduction, path: "/p", maxAge: 2 * 3600 };
}

export function paymentNonce(token: string, cookieSecret: string): string {
  return createHmac("sha256", emailLinkSecret()).update(`payment-confirm:${hashToken(token)}:${cookieSecret}`).digest("base64url");
}

function nonceMatches(token: string, cookieSecret: string | undefined, nonce: string | undefined): boolean {
  if (!isCsrfSecret(cookieSecret) || !nonce) return false;
  const expected = Buffer.from(paymentNonce(token, cookieSecret));
  const given = Buffer.from(nonce);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function respond(page: LinkPage, cookie?: LinkResponse["cookie"]): LinkResponse {
  return { status: page.status ?? 200, html: renderPage(page), cookie };
}

const p = copy.page;

function problemPage(state: Exclude<ConfirmLookup["state"], "ready">): LinkPage {
  switch (state) {
    case "expired":
      return messagePage(p.expiredTitle, p.expiredBody, 410);
    case "used":
      return messagePage(p.usedTitle, p.usedBody, 410);
    case "replaced":
      return messagePage(p.replacedTitle, p.replacedBody, 410);
    default:
      return messagePage(p.invalidTitle, p.invalidBody, 404);
  }
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#57534e;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:4px 0;font-weight:600;word-break:break-all;">${esc(value)}</td></tr>`;

function confirmPage(found: Extract<ConfirmLookup, { state: "ready" }>, token: string, nonce: string): LinkPage {
  const pay = found.payment;
  const scheme = PAYMENT_SCHEMES[pay.scheme].label;
  const replaces = found.replaces
    ? `<p style="margin:0 0 20px;padding:10px 12px;border-radius:8px;background:#fffbeb;border:1px solid #fcd34d;color:#78350f;">${esc(p.replaces)}<br>${esc(found.replaces.address)} (${esc(found.replaces.payeeName)})</p>`
    : "";
  return {
    title: p.confirmTitle,
    body:
      `${para(p.confirmBody(scheme))}` +
      `<table role="presentation" style="margin:0 0 20px;border-collapse:collapse;">${row(p.businessLabel, found.businessName)}${row(p.idLabel, pay.address)}${row(p.nameLabel, pay.payeeName)}</table>` +
      replaces +
      `<form method="post" action="/p/${esc(token)}" style="margin:0;"><input type="hidden" name="nonce" value="${esc(nonce)}">` +
      `<button type="submit" style="${buttonStyle("primary")}">${esc(p.confirmButton)}</button></form>`,
  };
}

/** GET /p/{token}: shows the ID and a Confirm button. Changes nothing. */
export async function handlePaymentGet(token: string, cookie: string | undefined, now: Date = new Date()): Promise<LinkResponse> {
  const found = await peekConfirmation(token, now);
  if (found.state !== "ready") return respond(problemPage(found.state));
  const secret = isCsrfSecret(cookie) ? cookie : newCsrfSecret();
  return respond(confirmPage(found, token, paymentNonce(token, secret)), { name: PAYMENT_CSRF_COOKIE, value: secret, options: paymentCookieOptions() });
}

/** POST /p/{token}: confirms (single use). Needs this browser's cookie and the nonce from the page. */
export async function handlePaymentPost(token: string, form: FormData, cookie: string | undefined, now: Date = new Date()): Promise<LinkResponse> {
  const nonce = form.get("nonce");
  if (!nonceMatches(token, cookie, typeof nonce === "string" ? nonce : undefined)) {
    return respond(messagePage("This page timed out", "For your safety, open the link in the email again and press Confirm.", 403, false));
  }
  try {
    const done = await confirmPaymentId(token, now);
    if (done.state !== "confirmed") return respond(problemPage(done.state));
    return respond(messagePage(p.doneTitle, `${p.doneBody} (${done.payment.address}, ${done.payment.payeeName})`));
  } catch (e) {
    console.error(`[payments] confirm failed: ${e instanceof Error ? e.message : String(e)}`);
    return respond(messagePage("Something went wrong", "Nothing was changed. Please try the link again in a moment.", 500, false));
  }
}
