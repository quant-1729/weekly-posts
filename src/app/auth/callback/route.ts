import { NextResponse, type NextRequest } from "next/server";
import { AuthError, checkMagicLink, consumeMagicLink } from "@/lib/auth";
import {
  CSRF_COOKIE,
  continueNonce,
  continuePageHtml,
  csrfCookieOptions,
  isCsrfSecret,
  newCsrfSecret,
  nonceMatches,
} from "@/lib/auth/continue";
import { verifyMagicToken } from "@/lib/auth/magic-link";

export const dynamic = "force-dynamic";

/**
 * The emailed sign-in link, in two steps (docs/email-links.md section 1).
 *
 * GET shows "Continue to {app}" with one button and changes nothing, so a mail scanner
 * that opens the link first does not use it up. The button POSTs the token here; only
 * the POST consumes the single-use id, starts the 30-day session and redirects (303) to /.
 * A bad, expired or used token, on GET or POST, goes to /auth/invalid. The token is never
 * kept in a redirect, and responses are not cached or sent as a Referer.
 */

function harden(res: NextResponse): NextResponse {
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function invalid(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/invalid";
  url.search = "";
  return harden(NextResponse.redirect(url, 303));
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  let payload = null;
  try {
    payload = token && (await checkMagicLink(token)) ? await verifyMagicToken(token) : null;
  } catch (e) {
    if (!(e instanceof AuthError)) console.error("[auth] callback check", e);
  }
  if (!token || !payload) return invalid(request);

  // Two tabs from the same browser share one cookie, so both forms stay valid.
  const existing = request.cookies.get(CSRF_COOKIE)?.value;
  const secret = isCsrfSecret(existing) ? existing : newCsrfSecret();
  const res = harden(
    new NextResponse(continuePageHtml({ token, nonce: continueNonce(payload.jti, secret) }), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // The only button on this page must not be framed and clicked by another site.
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'; form-action 'self'",
      },
    }),
  );
  res.cookies.set(CSRF_COOKIE, secret, csrfCookieOptions());
  return res;
}

export async function POST(request: NextRequest) {
  let token: string | undefined;
  let nonce: string | undefined;
  try {
    const form = await request.formData();
    const t = form.get("token");
    const n = form.get("nonce");
    token = typeof t === "string" ? t : undefined;
    nonce = typeof n === "string" ? n : undefined;
  } catch {
    return invalid(request);
  }
  const payload = await verifyMagicToken(token);
  if (!token || !payload) return invalid(request);
  // Not from our own page in this browser: refuse before the link is used up.
  if (!nonceMatches(payload.jti, request.cookies.get(CSRF_COOKIE)?.value, nonce)) return invalid(request);

  try {
    await consumeMagicLink(token);
  } catch (e) {
    if (!(e instanceof AuthError)) console.error("[auth] callback", e);
    return invalid(request);
  }
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  const res = harden(NextResponse.redirect(url, 303));
  res.cookies.delete({ name: CSRF_COOKIE, path: "/auth/callback" });
  return res;
}
