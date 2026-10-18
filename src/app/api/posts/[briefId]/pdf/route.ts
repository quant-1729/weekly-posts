import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { s } from "@/lib/i18n/strings";
import { buildPostPdf } from "@/lib/share/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/posts/[briefId]/pdf[?post=<postId>]: one PDF with every picture of the brief's approved posts (or of the one post),
 * one page per picture. Only a signed-in member of the brief's business gets it; anyone else gets the same 404 as a missing brief.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/posts/[briefId]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return new Response(s.errors.signedOut, { status: 401 });
  const { briefId } = await ctx.params;
  const post = req.nextUrl.searchParams.get("post") ?? undefined;
  if (post !== undefined && !UUID_RE.test(post)) return new Response("Not found", { status: 404 });
  let out;
  try {
    out = await buildPostPdf({ userId: user.id, briefId, postId: post });
  } catch (err) {
    console.error("[share] could not build the PDF", err);
    return new Response("Could not make the PDF", { status: 500 });
  }
  if (!out.ok) return new Response(out.reason === "not_approved" ? s.share.pdfNotApproved : "Not found", { status: out.status });
  return new Response(out.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(out.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
