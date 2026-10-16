import { NextResponse, type NextRequest } from "next/server";

/**
 * Two jobs, no database and no secrets:
 * 1. A per-request nonce and a strict Content-Security-Policy (scripts run only with the nonce).
 * 2. A quick redirect to /login when there is no session cookie at all. This is only a convenience; every page and
 *    server action verifies the signed cookie itself (src/lib/session.ts), so a forged cookie gets nowhere.
 */

const PUBLIC_PATHS = ["/login", "/auth/verify"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const dev = process.env.NODE_ENV !== "production";

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const hasCookie =
    request.cookies.has("__Host-admin_session") || request.cookies.has("admin_session");
  if (!hasCookie && !PUBLIC_PATHS.some((p) => pathname === p)) {
    const res = NextResponse.redirect(new URL("/login", request.url));
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)" }],
};
