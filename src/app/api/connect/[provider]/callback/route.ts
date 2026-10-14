import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appUrl } from "@/lib/connections/config";
import { FB_PENDING_COOKIE, FB_PENDING_TTL_SECONDS } from "@/lib/connections/facebook";
import { finishConnect } from "@/lib/connections/oauth";
import { CONNECT_NONCE_COOKIE } from "@/lib/connections/state";
import { PROVIDERS, type Provider } from "@/lib/queue/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Where Meta sends the owner back (redirect URI). finishConnect proves the state, the nonce cookie, the signed-in
 * user and brand ownership before it stores anything. Nothing about the token reaches the browser; the answer is a
 * redirect to /connections with a short result code.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!(PROVIDERS as readonly string[]).includes(provider)) return new NextResponse("Not found", { status: 404 });
  const go = (path: string) => NextResponse.redirect(new URL(path, appUrl()));

  const user = await getCurrentUser();
  if (!user) return go("/login");

  const q = req.nextUrl.searchParams;
  const out = await finishConnect({
    provider: provider as Provider,
    userId: user.id,
    code: q.get("code"),
    state: q.get("state"),
    nonceCookie: req.cookies.get(CONNECT_NONCE_COOKIE)?.value ?? null,
    denied: q.has("error") || q.has("error_reason"),
  });

  const res = !out.ok
    ? go(`/connections?connect_error=${out.code}`)
    : out.next === "pick_page"
      ? go("/connections/facebook")
      : go(`/connections?connected=${out.provider}`);
  res.cookies.set(CONNECT_NONCE_COOKIE, "", { path: "/api/connect", maxAge: 0 });
  if (out.ok && out.next === "pick_page") {
    res.cookies.set(FB_PENDING_COOKIE, out.pending, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/connections",
      maxAge: FB_PENDING_TTL_SECONDS,
    });
  }
  return res;
}
