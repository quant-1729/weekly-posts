import { NextResponse, type NextRequest } from "next/server";
import { LINK_PAGE_HEADERS } from "@/lib/links/dispatch";
import type { LinkResponse } from "@/lib/links/dispatch";
import { PAYMENT_CSRF_COOKIE, handlePaymentGet, handlePaymentPost } from "@/lib/payments/confirm-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The emailed link that confirms a payment ID. GET shows the ID and a button and changes nothing
 * (mail scanners open links); POST confirms, with the CSRF nonce from the page. Logic in
 * src/lib/payments/confirm-link.ts.
 */

function toResponse(r: LinkResponse): NextResponse {
  const res = new NextResponse(r.html, { status: r.status, headers: LINK_PAGE_HEADERS });
  if (r.cookie) res.cookies.set(r.cookie.name, r.cookie.value, r.cookie.options);
  return res;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return toResponse(await handlePaymentGet(token, request.cookies.get(PAYMENT_CSRF_COOKIE)?.value));
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }
  return toResponse(await handlePaymentPost(token, form, request.cookies.get(PAYMENT_CSRF_COOKIE)?.value));
}
