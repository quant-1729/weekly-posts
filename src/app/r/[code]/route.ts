import { after } from "next/server";
import { isBotUserAgent, isPrefetch, firstClickInWindow } from "@/lib/shortlinks/bots";
import { pickDestination } from "@/lib/shortlinks/destination";
import { findShortLink, recordClick } from "@/lib/shortlinks/resolve";
import { isQrScanRequest } from "@/lib/qr/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public short link (Req 19). Looks the post up with one query, answers 302 at once, and writes
// the click after the response so the visitor never waits for it (AC 19: 300 ms or less added).

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link not found</title></head>
<body style="font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafaf9;color:#1c1917">
<main style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:1.25rem;margin:0 0 8px">This link has expired or doesn't exist</h1>
<p style="margin:0;color:#57534e">Please check the link, or ask the business that shared it.</p></main></body></html>`;

function notFound(): Response {
  // The same answer for every bad code, so nothing is revealed about which codes exist.
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function handle(req: Request, ctx: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await ctx.params;
  const target = await findShortLink(code);
  if (!target) return notFound();

  // A QR scan (`?q=1`) goes to the URL chosen for the QR in the post's brief, when there is one.
  const viaQr = isQrScanRequest(req.url);
  const qrDestination = viaQr && target.qrUrl ? pickDestination({ linkDestination: target.qrUrl, websiteUrl: null, channel: "qr", postCode: target.postCode }) : null;

  // No destination at all: the public card (relative Location, so it is right behind any proxy).
  const location =
    qrDestination ??
    pickDestination({
      linkDestination: target.linkDestination,
      websiteUrl: target.websiteUrl,
      channel: target.channel,
      postCode: target.postCode,
    }) ?? `/r/${target.postCode}/card`;

  // Count real people only. HEAD and prefetch requests are not a person arriving; the bot
  // list is best effort (see bots.ts); the same phone opening the link twice counts once.
  const ua = req.headers.get("user-agent") ?? "";
  const countable =
    req.method !== "HEAD" && !isPrefetch(req.headers) && !isBotUserAgent(ua) && firstClickInWindow(ua, target.postId);
  if (countable) {
    const work = () =>
      recordClick({ postId: target.postId, brandId: target.brandId, userAgent: ua, viaQr }).catch((e) =>
        console.error("[shortlinks] click not saved", e instanceof Error ? e.message : e),
      );
    try {
      after(work);
    } catch {
      // Outside a request (scripts): just start it.
      void work();
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer-when-downgrade",
    },
  });
}

export function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(req, ctx);
}

/** Answers like GET (so link checkers see the same redirect) but never counts a click. */
export function HEAD(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(req, ctx);
}
