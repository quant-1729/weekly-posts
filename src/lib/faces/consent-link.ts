// GET and POST /f/[token]: the emailed link that confirms the owner's consent to use their own face (F-6).
// Same rule as the payment link (src/lib/payments/confirm-link.ts) and docs/email-links.md: GET only shows a page and
// changes nothing (mail scanners open every link); POST acts, with a CSRF nonce bound to this browser's cookie.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isCsrfSecret, newCsrfSecret } from '@/lib/auth/continue';
import { getEnv } from '@/lib/env';
import { s } from '@/lib/i18n/strings';
import { LINK_PAGE_HEADERS, type LinkResponse } from '@/lib/links/dispatch';
import { buttonStyle, esc, messagePage, para, renderPage, type LinkPage } from '@/lib/links/page';
import { emailLinkSecret } from '@/lib/links/tokens';
import { hashToken } from '@/lib/payments';
import { confirmFaceConsent, peekFaceConsent, type ConsentLookup } from './consent';

export { LINK_PAGE_HEADERS };

export const FACE_CSRF_COOKIE = 'pm_face';

export function faceCookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: getEnv().isProduction, path: '/f', maxAge: 2 * 3600 };
}

export function faceNonce(token: string, cookieSecret: string): string {
  return createHmac('sha256', emailLinkSecret()).update(`face-consent:${hashToken(token)}:${cookieSecret}`).digest('base64url');
}

function nonceMatches(token: string, cookieSecret: string | undefined, nonce: string | undefined): boolean {
  if (!isCsrfSecret(cookieSecret) || !nonce) return false;
  const expected = Buffer.from(faceNonce(token, cookieSecret));
  const given = Buffer.from(nonce);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function respond(page: LinkPage, cookie?: LinkResponse['cookie']): LinkResponse {
  return { status: page.status ?? 200, html: renderPage(page), cookie };
}

const p = s.faces.consent.page;

function problemPage(state: Exclude<ConsentLookup['state'], 'ready'>): LinkPage {
  switch (state) {
    case 'expired':
      return messagePage(p.expiredTitle, p.expiredBody, 410);
    case 'used':
      return messagePage(p.usedTitle, p.usedBody, 410);
    default:
      return messagePage(p.invalidTitle, p.invalidBody, 404);
  }
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#57534e;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:4px 0;font-weight:600;word-break:break-word;">${esc(value)}</td></tr>`;

function confirmPage(found: Extract<ConsentLookup, { state: 'ready' }>, token: string, nonce: string): LinkPage {
  return {
    title: p.confirmTitle,
    body:
      `${para(p.confirmBody)}` +
      `<table role="presentation" style="margin:0 0 20px;border-collapse:collapse;">${row(p.businessLabel, found.businessName)}${row(p.faceLabel, found.faceName)}${row(p.consentLabel, s.faces.card.owner.consentText)}</table>` +
      `<form method="post" action="/f/${esc(token)}" style="margin:0;"><input type="hidden" name="nonce" value="${esc(nonce)}">` +
      `<button type="submit" style="${buttonStyle('primary')}">${esc(p.confirmButton)}</button></form>`,
  };
}

/** GET /f/{token}: shows the consent and a Confirm button. Changes nothing. */
export async function handleFaceGet(token: string, cookie: string | undefined, now: Date = new Date()): Promise<LinkResponse> {
  const found = await peekFaceConsent(token, now);
  if (found.state !== 'ready') return respond(problemPage(found.state));
  const secret = isCsrfSecret(cookie) ? cookie : newCsrfSecret();
  return respond(confirmPage(found, token, faceNonce(token, secret)), { name: FACE_CSRF_COOKIE, value: secret, options: faceCookieOptions() });
}

/** POST /f/{token}: confirms (single use). Needs this browser's cookie and the nonce from the page. */
export async function handleFacePost(token: string, form: FormData, cookie: string | undefined, now: Date = new Date()): Promise<LinkResponse> {
  const nonce = form.get('nonce');
  if (!nonceMatches(token, cookie, typeof nonce === 'string' ? nonce : undefined)) {
    return respond(messagePage('This page timed out', 'For your safety, open the link in the email again and press Confirm.', 403, false));
  }
  try {
    const done = await confirmFaceConsent(token, now);
    if (done.state !== 'confirmed') return respond(problemPage(done.state));
    return respond(messagePage(p.doneTitle, p.doneBody));
  } catch (e) {
    console.error(`[faces] consent confirm failed: ${e instanceof Error ? e.message : String(e)}`);
    return respond(messagePage('Something went wrong', 'Nothing was changed. Please try the link again in a moment.', 500, false));
  }
}
