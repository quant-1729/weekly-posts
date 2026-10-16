import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  needsRefresh,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/auth/session";
import { PATHNAME_HEADER, isPublicPath } from "@/lib/auth/public-paths";
import { isDevToolsEnabled } from "@/lib/env";

/**
 * Optimistic route guard. It only checks the session cookie's signature and
 * expiry (no database), and renews the cookie when it is over a day old so a
 * returning owner stays signed in for 30 days from last use. Pages and routes
 * still check the user themselves.
 *
 * Everything is protected except a public list, so a new page is private by
 * default. Signed-out users go to /login (API routes get a 401 instead);
 * signed-in users on /login are sent on by the login page itself (it checks the database: a signed-out or
 * revoked device still holds a validly signed cookie, and redirecting that from here would loop).
 *
 * Public: /login, /auth/callback and /auth/invalid (email sign-in), /dev/outbox (non-production only), /a/*, /s/*, /r/*, /e/* and /i/* (no-login links; /e/* pages act on POST only), /api/email/* (one-click unsubscribe), /api/files/* (it checks
 * membership itself), /api/whatsapp/* (webhook, checks its signature), Next
 * internals and static files (excluded by the matcher below).
 */

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Developer-only pages do not exist in production or on Vercel: a plain 404, signed in or not.
  if ((pathname === "/dev" || pathname.startsWith("/dev/")) && !isDevToolsEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, code: "signed_out" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Tell server components which page this is (a layout cannot see the path).
  // Set here, so a value sent by the client is always overwritten.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (session && needsRefresh(session)) {
    response.cookies.set(
      SESSION_COOKIE,
      await signSession({ id: session.sub, email: session.email, sid: session.sid }),
      sessionCookieOptions(),
    );
  }
  return response;
}

export const config = {
  // Skip Next internals and files with an extension (static assets).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
