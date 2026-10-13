import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { buildShortLink } from "./link";

export { buildShortLink, POST_CODE_RE } from "./link";

/** The public short link for a post: `${APP_URL}/r/${code}`. */
export function shortLinkFor(postCode: string): string {
  return buildShortLink(getEnv().appUrl, postCode);
}

export interface ClickRange {
  /** Inclusive. */
  from: Date | string;
  /** Exclusive. */
  to: Date | string;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

/**
 * Clicks per post in the range, most clicked first. Posts with no clicks are not listed.
 * Runs as the signed-in user, so row-level security applies: a brand the user is not a member
 * of gives an empty list.
 */
export async function clicksByPost(
  userId: string,
  brandId: string,
  range: ClickRange,
): Promise<{ postId: string; clicks: number }[]> {
  return getDb().withUser(userId, (tx) =>
    tx.query<{ postId: string; clicks: number }>(
      `select post_id::text as "postId", count(*)::int as clicks
         from public.clicks
        where brand_id = $1 and clicked_at >= $2::timestamptz and clicked_at < $3::timestamptz
        group by post_id
        order by clicks desc, post_id`,
      [brandId, iso(range.from), iso(range.to)],
    ),
  );
}

/**
 * Clicks per week (Monday start, in the brand's own timezone) in the range, oldest first.
 * Weeks with no clicks are not listed. Same row-level security as clicksByPost.
 */
export async function clicksByWeek(
  userId: string,
  brandId: string,
  range: ClickRange,
): Promise<{ weekStart: string; clicks: number }[]> {
  return getDb().withUser(userId, (tx) =>
    tx.query<{ weekStart: string; clicks: number }>(
      `select to_char(date_trunc('week', c.clicked_at at time zone coalesce(m.timezone, 'UTC')), 'YYYY-MM-DD') as "weekStart",
              count(*)::int as clicks
         from public.clicks c
         left join public.brand_memory m on m.brand_id = c.brand_id
        where c.brand_id = $1 and c.clicked_at >= $2::timestamptz and c.clicked_at < $3::timestamptz
        group by 1
        order by 1`,
      [brandId, iso(range.from), iso(range.to)],
    ),
  );
}
