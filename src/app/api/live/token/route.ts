import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getEnv } from "@/lib/env";
import { s } from "@/lib/i18n/strings";
import { hasLiveTokenMinterForTests, mintLiveToken, realtimeMode, webConfig } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** True when the Origin header names this app (the public app address or the host the request came to). */
function sameOrigin(request: NextRequest, origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const base = getEnv().appUrl;
  if (base && new URL(base).origin === new URL(origin).origin) return true;
  const own = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  return host === own;
}

/**
 * POST: a short-lived Firebase custom token for the signed-in owner's current brand (docs/14-firebase-plan.md §4), so their
 * browser can listen to that brand's live status documents. Same-origin only. Claims are exactly { b: brandId, until }; no
 * email or personal data. Answers { mode: 'off' } when live status is not on, and, like every route outside the public
 * list, 401 when signed out (src/proxy.ts; checked again here against the database, so a revoked device is refused).
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== null && !sameOrigin(request, origin)) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: "signed_out", message: s.errors.signedOut }, { status: 401, headers: NO_STORE });
  }
  const config = webConfig();
  if ((realtimeMode() !== "firestore" && !hasLiveTokenMinterForTests()) || !config) {
    return NextResponse.json({ mode: "off" }, { headers: NO_STORE });
  }
  try {
    const brand = await getCurrentBrand(user.id);
    if (!brand) return NextResponse.json({ ok: false, code: "no_brand" }, { status: 404, headers: NO_STORE });
    const { token, until } = await mintLiveToken({ userId: user.id, brandId: brand.id, now: Date.now() });
    return NextResponse.json({ mode: "firestore", token, brandId: brand.id, until, config }, { headers: NO_STORE });
  } catch (e) {
    console.error("[live] token failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, code: "generic", message: s.errors.generic }, { status: 500, headers: NO_STORE });
  }
}
