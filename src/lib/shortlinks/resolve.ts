import { getDb } from "@/lib/db";
import { POST_CODE_RE } from "./link";

export interface ShortLinkTarget {
  postId: string;
  brandId: string;
  postCode: string;
  channel: string | null;
  linkDestination: string | null;
  websiteUrl: string | null;
}

/** One query, service role (the visitor is not signed in). Null for a malformed or unknown code. */
export async function findShortLink(rawCode: string): Promise<ShortLinkTarget | null> {
  const code = rawCode.trim().toLowerCase();
  if (!POST_CODE_RE.test(code)) return null;
  const [r] = await getDb().withService((tx) =>
    tx.query<ShortLinkTarget>(
      `select p.id::text as "postId", p.brand_id::text as "brandId", p.post_code as "postCode", p.channel::text as channel,
              m.link_destination as "linkDestination", m.website_url as "websiteUrl"
         from public.posts p
         left join public.brand_memory m on m.brand_id = p.brand_id
        where p.post_code = $1`,
      [code],
    ),
  );
  return r ?? null;
}

export const MAX_USER_AGENT = 300;

/** Writes one click. The user agent is cut to 300 characters; no IP address is stored. */
export async function recordClick(args: { postId: string; brandId: string; userAgent: string }): Promise<void> {
  await getDb().withService((tx) =>
    tx.query("insert into public.clicks (post_id, brand_id, user_agent) values ($1::uuid, $2::uuid, $3)", [
      args.postId,
      args.brandId,
      args.userAgent.slice(0, MAX_USER_AGENT),
    ]),
  );
}
