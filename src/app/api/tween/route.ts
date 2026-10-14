import { NextResponse } from "next/server";
import { buildBundle } from "@/lib/tween/bundle";

// Read at request time so TWEEN_ENABLED works without a rebuild.
export const dynamic = "force-dynamic";

/**
 * Tween's written copy as same-origin JSON, fetched by the loader in the signed-in app layout after the page is idle.
 * Answers 404 when Tween is turned off (`"enabled": false` in src/content/tween.json, or TWEEN_ENABLED=0), and, like
 * every route outside the public list, 401 when signed out (src/proxy.ts). No personal data.
 */
export function GET() {
  let bundle;
  try {
    bundle = buildBundle();
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!bundle) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json(bundle, { headers: { "Cache-Control": "private, max-age=300" } });
}
