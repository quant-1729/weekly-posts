import { getDb } from "@/lib/db";
import { fill, s } from "@/lib/i18n/strings";
import { clicksPhrase, timeSavedPhrase } from "./format";

// The one-line summary in the weekly email (Req 21). Built by the sender with the service role
// (the owner is not signed in), for one brand only.

const r = s.results;
export const EMAIL_SUMMARY_DAYS = 28;

export interface EmailSummary {
  /** Posts shared in the last 4 weeks. */
  posts: number;
  /** Clicks counted in the last 4 weeks (at least this many). */
  clicks: number;
  /** posts x minutes_per_post, or null when the owner did not say. */
  minutesSaved: number | null;
}

/** The last 4 weeks for one brand, or null when there is nothing to show (no post shared, no click). */
export async function loadEmailSummary(brandId: string, now: Date): Promise<EmailSummary | null> {
  const from = new Date(now.getTime() - EMAIL_SUMMARY_DAYS * 86_400_000).toISOString();
  const to = now.toISOString();
  const [row] = await getDb().withService((tx) =>
    tx.query<{ posts: number; clicks: number; minutes: number | null }>(
      `select (select count(*)::int from public.posts p
                where p.brand_id = $1
                  and (p.posted_at >= $2::timestamptz and p.posted_at < $3::timestamptz
                       or exists (select 1 from public.post_actions a
                                   where a.post_id = p.id and a.brand_id = p.brand_id and a.action = 'share'
                                     and a.created_at >= $2::timestamptz and a.created_at < $3::timestamptz))) as posts,
              (select count(*)::int from public.clicks c
                where c.brand_id = $1 and c.clicked_at >= $2::timestamptz and c.clicked_at < $3::timestamptz) as clicks,
              (select minutes_per_post from public.brand_memory where brand_id = $1) as minutes`,
      [brandId, from, to],
    ),
  );
  if (!row || (row.posts === 0 && row.clicks === 0)) return null;
  return { posts: row.posts, clicks: row.clicks, minutesSaved: row.minutes == null ? null : row.posts * row.minutes };
}

/** "Last 4 weeks: 9 posts shared, at least 23 clicks, about 3 hours saved." Parts with nothing to say are left out. */
export function emailSummaryLine(sum: EmailSummary): string {
  const parts: string[] = [];
  if (sum.posts > 0) parts.push(sum.posts === 1 ? r.email.postsOne : fill(r.email.posts, { n: sum.posts }));
  if (sum.clicks > 0) parts.push(clicksPhrase(sum.clicks));
  const time = sum.minutesSaved ? timeSavedPhrase(sum.minutesSaved) : null;
  if (time) parts.push(fill(r.email.timeSaved, { time }));
  return fill(r.email.line, { parts: parts.join(", ") });
}
