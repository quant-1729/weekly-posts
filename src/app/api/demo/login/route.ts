import { NextResponse, type NextRequest } from "next/server";
import { startDemoSession } from "@/lib/auth";
import { takeAll } from "@/lib/auth/rate-limit";
import { DEMO_ATTEMPTS, DEMO_ATTEMPT_WINDOW_MS, codeMatches, demoConfig } from "@/lib/demo";
import { clientIpFromHeaders, hashIp } from "@/lib/sessions";
import { publicUrl } from "@/lib/links/public-url";

export const dynamic = "force-dynamic";

/**
 * The judges' demo sign-in (docs/15-demo-login.md). POST `code` (a form field or JSON). Empty settings: 404.
 * Every try counts against a limit of 10 per network (IP hash) per 15 minutes. A wrong code gets one generic answer.
 * The right code starts a 12-hour demo session for the existing DEMO_LOGIN_EMAIL account (never creating one) and
 * redirects (303) to /home. A browser form gets redirects (errors go back to /demo?error=...); a JSON caller gets JSON.
 *
 * The limiter is in memory (src/lib/auth/rate-limit.ts), so on Cloud Run it counts per instance; the code is long
 * and shared only with the judges, and this stops casual guessing.
 */

const MAX_CODE_LENGTH = 200;

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export async function POST(request: NextRequest) {
  const config = demoConfig();
  if (!config) return noStore(new NextResponse("Not found", { status: 404 }));

  const json = (request.headers.get("content-type") ?? "").includes("application/json");
  const fail = (code: "invalid" | "rate_limited" | "not_available", status: number) => {
    if (json) return noStore(NextResponse.json({ ok: false, code }, { status }));
    const url = publicUrl(request);
    url.pathname = "/demo";
    url.search = `?error=${code}`;
    return noStore(NextResponse.redirect(url, 303));
  };

  const ip = hashIp(clientIpFromHeaders(request.headers)) ?? "unknown";
  if (!takeAll([{ key: `demo-login:${ip}`, limit: DEMO_ATTEMPTS, windowMs: DEMO_ATTEMPT_WINDOW_MS }])) return fail("rate_limited", 429);

  let given: unknown;
  try {
    if (json) given = ((await request.json()) as { code?: unknown } | null)?.code;
    else given = (await request.formData()).get("code");
  } catch {
    return fail("invalid", 401);
  }
  if (typeof given !== "string" || given.length === 0 || given.length > MAX_CODE_LENGTH || !codeMatches(given, config.accessCode)) {
    return fail("invalid", 401);
  }

  let user;
  try {
    user = await startDemoSession(config.email);
  } catch (e) {
    console.error("[demo] could not start the session", e instanceof Error ? e.name : "error");
    return fail("not_available", 503);
  }
  if (!user) return fail("not_available", 503);

  if (json) return noStore(NextResponse.json({ ok: true, redirect: "/home" }));
  const url = publicUrl(request);
  url.pathname = "/home";
  url.search = "";
  return noStore(NextResponse.redirect(url, 303));
}
