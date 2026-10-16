import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { APP_NAME } from "@/lib/app";
import { getEnv } from "@/lib/env";
import { fill, s } from "@/lib/i18n/strings";

/**
 * The "Continue" step of the magic link (docs/email-links.md section 1).
 *
 * Mail scanners and link previewers open every link in an email, so GET /auth/callback
 * only shows a page with one button. The button POSTs the token back, and only that POST
 * signs the owner in.
 *
 * CSRF: the page sets a random cookie (httpOnly, SameSite=Lax, only sent to
 * /auth/callback) and the form carries a nonce that is an HMAC of the token's jti and
 * that cookie. A POST from another site has neither the cookie nor a valid nonce, so it
 * cannot sign the owner in as someone else. The jti itself is unguessable and single-use.
 */

export const CSRF_COOKIE = "pm_continue";
export const CSRF_COOKIE_MAX_AGE_SECONDS = 15 * 60;

/** Cookie value: 32 random bytes, base64url. */
export function newCsrfSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function isCsrfSecret(v: string | undefined): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

export function csrfCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().isProduction,
    path: "/auth/callback",
    maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
  };
}

/** The form nonce for this token and this browser's cookie. */
export function continueNonce(jti: string, cookieSecret: string): string {
  return createHmac("sha256", getEnv().authSecret).update(`magic-continue:${jti}:${cookieSecret}`).digest("base64url");
}

export function nonceMatches(jti: string, cookieSecret: string | undefined, nonce: string | undefined): boolean {
  if (!isCsrfSecret(cookieSecret) || !nonce) return false;
  const expected = Buffer.from(continueNonce(jti, cookieSecret));
  const given = Buffer.from(nonce);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The small page behind the emailed link: a heading and one button. No script. */
export function continuePageHtml(args: { token: string; nonce: string }): string {
  const c = s.login.continuePage;
  const title = esc(fill(c.title, { appName: APP_NAME }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>@media (min-width:768px){body{background:#fbfaf9 !important}main{max-width:560px !important;min-height:0 !important;margin:10vh auto !important;padding:40px 48px !important;background:#ffffff;border:1px solid rgba(0,0,0,0.05);box-shadow:0 1px 3px rgba(0,0,0,0.04);border-radius:16px}}</style>
</head>
<body style="margin:0;background:#fbfaf9;color:#1d1d1c;font-family:Onest,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
<main style="box-sizing:border-box;max-width:480px;min-height:100vh;margin:0 auto;padding:32px 20px;display:flex;flex-direction:column;justify-content:center;">
<p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#1d1d1c;">${esc(APP_NAME)}</p>
<h1 style="margin:16px 0 8px;font-size:20px;line-height:28px;font-weight:500;">${title}</h1>
<p style="margin:0 0 24px;color:#554f4c;">${esc(c.body)}</p>
<form method="post" action="/auth/callback">
<input type="hidden" name="token" value="${esc(args.token)}">
<input type="hidden" name="nonce" value="${esc(args.nonce)}">
<button type="submit" style="width:100%;border:0;border-radius:9999px;background:#1d1d1c;color:#ffffff;font-size:16px;font-weight:500;padding:12px 16px;cursor:pointer;">${esc(c.button)}</button>
</form>
</main>
</body>
</html>`;
}
