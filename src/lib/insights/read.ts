// Read helpers of the insights loop, for the Growth report (R-9) and the Results page. Server only (service role):
// the caller has already checked that the signed-in user belongs to the brand.

import type { PostType } from "@/lib/briefs/types";
import { getDb } from "@/lib/db";
import { brandZone } from "@/lib/queue/data";
import { PROVIDERS, type Provider } from "@/lib/queue/types";
import { FB_INSIGHTS_SCOPES, IG_INSIGHTS_SCOPE, type BrandPostMetrics, type InsightsPermission, type InsightsPermissionByProvider } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
  queue_item_id: string;
  post_id: string;
  channel: string;
  post_type: string | null;
  theme_id: string | null;
  permalink: string | null;
  done_at: Date | string;
  age_hours: number;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  views: number | null;
  posted_hour: number;
  posted_weekday: number;
  from_idea: boolean;
}

/**
 * The latest measurement of every post of the brand that went out in the last `sinceDays` days, with what the post
 * was (type, theme, channel), when it went out (hour and weekday in the brand's time zone) and whether it came from a
 * trend idea. "Latest" is the highest bucket that holds at least one number; a post measured but with nothing to show
 * is left out. Newest post first.
 */
export async function metricsForBrand(brandId: string, sinceDays: number, now: Date = new Date()): Promise<BrandPostMetrics[]> {
  if (!UUID_RE.test(brandId) || !(sinceDays > 0)) return [];
  const since = new Date(now.getTime() - sinceDays * DAY_MS).toISOString();
  const rows = await getDb().withService(async (tx) => {
    const zone = await brandZone(tx, brandId);
    return tx.query<Row>(
      `select distinct on (q.id)
              q.id::text as queue_item_id, p.id::text as post_id, q.channel::text as channel, b.post_type::text as post_type, p.theme_id,
              q.permalink, q.done_at, m.age_hours::int as age_hours,
              m.reach, m.impressions, m.likes, m.comments, m.saves, m.shares, m.views,
              extract(hour from q.done_at at time zone $4)::int as posted_hour,
              extract(isodow from q.done_at at time zone $4)::int as posted_weekday,
              exists (select 1 from public.post_ideas i where i.brand_id = p.brand_id and i.brief_id is not null and i.brief_id = p.brief_id) as from_idea
         from public.post_metrics m
         join public.queue_items q on q.id = m.queue_item_id and q.brand_id = m.brand_id
         join public.posts p on p.id = q.post_id and p.brand_id = q.brand_id
         left join public.post_briefs b on b.id = p.brief_id and b.brand_id = p.brand_id
        where m.brand_id = $1 and q.status = 'published' and q.done_at >= $2::timestamptz and q.done_at <= $3::timestamptz
          and (m.reach is not null or m.impressions is not null or m.likes is not null or m.comments is not null or m.saves is not null or m.shares is not null or m.views is not null)
        order by q.id, m.age_hours desc, m.fetched_at desc`,
      [brandId, since, now.toISOString(), zone],
    );
  });
  return rows
    .map((r) => ({
      queueItemId: r.queue_item_id,
      postId: r.post_id,
      channel: r.channel,
      postType: (r.post_type as PostType | null) ?? null,
      themeId: r.theme_id,
      permalink: r.permalink,
      postedAt: new Date(r.done_at).toISOString(),
      postedHour: Number(r.posted_hour),
      postedWeekday: Number(r.posted_weekday),
      fromIdea: r.from_idea,
      ageHours: Number(r.age_hours),
      reach: r.reach,
      impressions: r.impressions,
      likes: r.likes,
      comments: r.comments,
      saves: r.saves,
      shares: r.shares,
      views: r.views,
    }))
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

/**
 * Whether each connected channel can give insights: `ok` (the permission is there), `missing` (connected, but the
 * insights permission was not granted: "insights permission missing", reconnect to add it) or `not_connected`.
 */
export async function insightsPermission(brandId: string): Promise<InsightsPermissionByProvider> {
  const out: InsightsPermissionByProvider = { instagram: "not_connected", facebook: "not_connected" };
  if (!UUID_RE.test(brandId)) return out;
  const rows = await getDb().withService((tx) =>
    tx.query<{ provider: Provider; scopes: string[] | null; status: string }>(
      "select provider, scopes, status from public.channel_connections where brand_id = $1 and status <> 'revoked'",
      [brandId],
    ),
  );
  for (const r of rows) {
    if (!(PROVIDERS as readonly string[]).includes(r.provider)) continue;
    const scopes = r.scopes ?? [];
    const has = r.provider === "instagram" ? scopes.includes(IG_INSIGHTS_SCOPE) : FB_INSIGHTS_SCOPES.every((s) => scopes.includes(s));
    const state: InsightsPermission = has ? "ok" : "missing";
    out[r.provider] = state;
  }
  return out;
}
