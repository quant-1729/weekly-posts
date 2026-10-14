import { getDb } from "@/lib/db";
import { POST_CODE_RE } from "./link";

export interface ShortLinkTarget {
  postId: string;
  brandId: string;
  postCode: string;
  channel: string | null;
  linkDestination: string | null;
  websiteUrl: string | null;
  /** The URL of the post's brief link QR (v3), used for requests marked as a QR scan. */
  qrUrl: string | null;
}

/** One query, service role (the visitor is not signed in). Null for a malformed or unknown code. */
export async function findShortLink(rawCode: string): Promise<ShortLinkTarget | null> {
  const code = rawCode.trim().toLowerCase();
  if (!POST_CODE_RE.test(code)) return null;
  const [r] = await getDb().withService((tx) =>
    tx.query<ShortLinkTarget>(
      `select p.id::text as "postId", p.brand_id::text as "brandId", p.post_code as "postCode", p.channel::text as channel,
              m.link_destination as "linkDestination", m.website_url as "websiteUrl",
              case when pb.qr->>'kind' = 'link' then pb.qr->>'url' end as "qrUrl"
         from public.posts p
         left join public.brand_memory m on m.brand_id = p.brand_id
         left join public.post_briefs pb on pb.id = p.brief_id and pb.brand_id = p.brand_id
        where p.post_code = $1`,
      [code],
    ),
  );
  return r ?? null;
}

export const MAX_USER_AGENT = 300;

/**
 * Writes one click. The user agent is cut to 300 characters; no IP address is stored. A QR scan
 * (`viaQr`) is stored with source 'qr' (a link click is 'link'); the user agent is kept as it was.
 */
export async function recordClick(args: { postId: string; brandId: string; userAgent: string; viaQr?: boolean }): Promise<void> {
  await getDb().withService((tx) =>
    tx.query("insert into public.clicks (post_id, brand_id, user_agent, source) values ($1::uuid, $2::uuid, $3, $4)", [
      args.postId,
      args.brandId,
      args.userAgent.slice(0, MAX_USER_AGENT),
      args.viaQr ? "qr" : "link",
    ]),
  );
}
