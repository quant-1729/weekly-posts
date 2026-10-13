import { NextResponse, type NextRequest } from "next/server";
import { LINK_CSRF_COOKIE } from "@/lib/links/csrf";
import { LINK_PAGE_HEADERS, handleLinkGet, handleLinkPost, type LinkResponse } from "@/lib/links/dispatch";

export const dynamic = "force-dynamic";
// The edit page's "Rewrite with an instruction" calls the model (up to about 15 s) and redraws the images.
export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * No-login action pages from emailed links (docs/email-links.md). GET shows a page and changes
 * nothing; POST acts, with the CSRF nonce from the page. All logic is in src/lib/links/dispatch.ts.
 */

function toResponse(r: LinkResponse): NextResponse {
  const headers = r.csp ? { ...LINK_PAGE_HEADERS, "Content-Security-Policy": r.csp } : LINK_PAGE_HEADERS;
  const res = new NextResponse(r.html, { status: r.status, headers });
  if (r.cookie) res.cookies.set(r.cookie.name, r.cookie.value, r.cookie.options);
  return res;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return toResponse(await handleLinkGet(token, request.cookies.get(LINK_CSRF_COOKIE)?.value));
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }
  return toResponse(await handleLinkPost(token, form, request.cookies.get(LINK_CSRF_COOKIE)?.value));
}
