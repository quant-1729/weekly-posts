import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDemoUser } from "@/lib/demo";
import { getCurrentBrand } from "@/lib/brand/current";
import { appUrl } from "@/lib/connections/config";
import { startConnect } from "@/lib/connections/oauth";
import { CONNECT_NONCE_COOKIE, CONNECT_STATE_TTL_SECONDS } from "@/lib/connections/state";
import { ConnectionError } from "@/lib/connections/types";
import { PROVIDERS, type Provider } from "@/lib/queue/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts "Connect Instagram" / "Connect Facebook" (C-25) for the signed-in owner's current brand: checks that Meta is
 * set up, that tokens can be stored and that the user owns the brand, then sends them to Meta with a signed state.
 * The matching nonce goes in an httpOnly cookie, and the callback needs both.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!(PROVIDERS as readonly string[]).includes(provider)) return new NextResponse("Not found", { status: 404 });
  const back = (code: string) => NextResponse.redirect(new URL(`/connections?connect_error=${code}`, appUrl()));

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", appUrl()));
  if (isDemoUser(user)) return back("demo");
  const brand = await getCurrentBrand(user.id);
  if (!brand) return NextResponse.redirect(new URL("/setup", appUrl()));

  try {
    const { url, nonce } = await startConnect({ userId: user.id, brandId: brand.id, provider: provider as Provider });
    const res = NextResponse.redirect(url);
    res.cookies.set(CONNECT_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/connect",
      maxAge: CONNECT_STATE_TTL_SECONDS,
    });
    return res;
  } catch (e) {
    return back(e instanceof ConnectionError ? e.code : "exchange_failed");
  }
}
