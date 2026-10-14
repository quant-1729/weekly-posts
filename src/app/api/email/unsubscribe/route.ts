import { NextResponse, type NextRequest } from "next/server";
import { logBrandAction } from "@/lib/links/log";
import { setEmailUnsubscribed } from "@/lib/links/ops";
import { verifyLink } from "@/lib/links/tokens";
import { getDb } from "@/lib/db";
import { publicUrl } from "@/lib/links/public-url";

export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click unsubscribe (docs/email-links.md section 1, the one exception to "a link never
 * acts on GET"). A mail provider POSTs here when the person presses "Unsubscribe" in their mail app,
 * so POST acts directly on the signed token (t) with no cookie. GET only sends the person to the
 * normal unsubscribe page, where a button has to be pressed.
 */

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  const claims = await verifyLink(token, { act: "unsubscribe" });
  if (!claims) return new NextResponse("This unsubscribe link is not valid or has expired.", { status: 400 });
  const [brand] = await getDb().withService((tx) =>
    tx.query<{ id: string }>("select id::text as id from public.brands where id = $1", [claims.brandId]),
  );
  if (!brand) return new NextResponse("Not found", { status: 404 });
  await setEmailUnsubscribed(claims.brandId, true);
  logBrandAction(claims, "unsubscribe one-click");
  return new NextResponse("Unsubscribed", { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const url = publicUrl(request); // behind Cloud Run's proxy the request's own host is internal (0.0.0.0:8080)
  url.pathname = `/e/${encodeURIComponent(token)}`;
  url.search = "";
  return NextResponse.redirect(url, 303);
}
