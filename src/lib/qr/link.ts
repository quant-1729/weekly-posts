// Link QR codes (PRD v3 B-4.1, change C-10). A link QR encodes OUR short link, which redirects to
// the owner's URL, so every scan is counted.
//
// The short link is the post's own (`/r/{post_code}`, src/lib/shortlinks) with `?q=1` added. On
// that request the redirect (src/app/r/[code]/route.ts) sends the visitor to the URL stored in
// the post's brief QR spec instead of the brand's default destination, and the click is stored
// with `clicks.source = 'qr'` (link clicks are 'link'). qrScansByPost() counts the scans.

import dns from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { QR_LINK_TARGETS, type QrLinkTarget, type QrSpec } from "@/lib/briefs/types";
import { parseWebUrl } from "@/lib/shortlinks/destination";
import { buildShortLink } from "@/lib/shortlinks/link";
import { classifyIp, isBlockedHostname } from "@/lib/website/ip";

export const QR_URL_MAX = 500;
/** Query parameter that marks a short link request as a QR scan. */
export const QR_SOURCE_PARAM = "q";

export type QrUrlFailure = "empty" | "too_long" | "not_http" | "credentials" | "private_address" | "no_host" | "dns";

export type QrUrlCheck = { ok: true; url: string } | { ok: false; reason: QrUrlFailure };

export type QrResolver = (hostname: string) => Promise<Array<{ address: string }>>;
const defaultResolver: QrResolver = (host) => dns.lookup(host, { all: true, verbatim: true });

/**
 * Is this a URL a QR code may point at? http(s) only, at most 500 characters, no credentials, and
 * not a private, loopback, link-local or metadata address (same address rules as the website
 * reader). The host is looked up and every address must be public; pass `resolve: false` to check
 * only the text of the URL (no DNS), for example in a form while typing.
 */
export async function checkQrUrl(raw: string, o: { resolve?: boolean; resolver?: QrResolver } = {}): Promise<QrUrlCheck> {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > QR_URL_MAX) return { ok: false, reason: "too_long" };
  const u = parseWebUrl(text);
  if (!u) return { ok: false, reason: "not_http" };
  if (u.username || u.password) return { ok: false, reason: "credentials" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "no_host" };
  if (isIP(host)) {
    if (!classifyIp(host).ok) return { ok: false, reason: "private_address" };
  } else {
    if (isBlockedHostname(host)) return { ok: false, reason: "private_address" };
    if (o.resolve !== false) {
      let found: Array<{ address: string }>;
      try {
        found = await (o.resolver ?? defaultResolver)(host);
      } catch {
        return { ok: false, reason: "dns" };
      }
      if (found.length === 0) return { ok: false, reason: "dns" };
      // Every address must be public: a name that also resolves to a private IP is refused.
      if (found.some((a) => !classifyIp(a.address).ok)) return { ok: false, reason: "private_address" };
    }
  }
  // The parsed (canonical) form, unless that grew past the limit.
  return { ok: true, url: u.href.length <= QR_URL_MAX ? u.href : text };
}

export class QrLinkError extends Error {
  constructor(public readonly reason: QrUrlFailure | "bad_target") {
    super(`QR link refused: ${reason}`);
    this.name = "QrLinkError";
  }
}

const targetSchema = z.enum(QR_LINK_TARGETS);

/** A validated link QR spec (without a short code yet; the post gets its code when it is made). */
export async function buildLinkQrSpec(args: { target: QrLinkTarget; url: string; resolver?: QrResolver; resolve?: boolean }): Promise<Extract<QrSpec, { kind: "link" }>> {
  if (!targetSchema.safeParse(args.target).success) throw new QrLinkError("bad_target");
  const check = await checkQrUrl(args.url, { resolver: args.resolver, resolve: args.resolve });
  if (!check.ok) throw new QrLinkError(check.reason);
  return { kind: "link", target: args.target, url: check.url };
}

/** The text a link QR holds: the post's short link, marked as a QR scan. */
export function linkQrContent(baseUrl: string, postCode: string): string {
  return `${buildShortLink(baseUrl, postCode)}?${QR_SOURCE_PARAM}=1`;
}

/** True when the request URL of a short link carries the QR marker. */
export function isQrScanRequest(requestUrl: string): boolean {
  try {
    return new URL(requestUrl).searchParams.get(QR_SOURCE_PARAM) === "1";
  } catch {
    return false;
  }
}

export interface ClickRange {
  /** Inclusive. */
  from: Date | string;
  /** Exclusive. */
  to: Date | string;
}
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

/** QR scans (`clicks.source = 'qr'`) per post in the range, most first. RLS applies. */
export async function qrScansByPost(userId: string, brandId: string, range: ClickRange): Promise<{ postId: string; scans: number }[]> {
  return getDb().withUser(userId, (tx) =>
    tx.query<{ postId: string; scans: number }>(
      `select post_id::text as "postId", count(*)::int as scans
         from public.clicks
        where brand_id = $1 and clicked_at >= $2::timestamptz and clicked_at < $3::timestamptz
          and source = 'qr'
        group by post_id
        order by scans desc, post_id`,
      [brandId, iso(range.from), iso(range.to)],
    ),
  );
}
