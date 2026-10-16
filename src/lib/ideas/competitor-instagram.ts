// Competitor Instagram through Business Discovery (R-3). Public business and creator accounts only; counts
// and links only: followers, media count, and for recent posts the link, date, type, likes and comments. No
// captions, no comments, no follower lists, no usernames of people.
//
// Behind a feature switch until Meta App Review approves the permission: IDEAS_BUSINESS_DISCOVERY=on (default off).
// The call goes through the brand's own Facebook connection (the Page's linked Instagram account):
//   GET /{page-id}?fields=instagram_business_account
//   GET /{ig-user-id}?fields=business_discovery.username({handle}){followers_count,media_count,media.limit(N){...}}
//
// Each run stores a snapshot (competitor_snapshots). Velocity is measured against the last snapshot from at least
// MIN_SNAPSHOT_GAP_DAYS earlier: the change in average likes + comments per post, else the follower change.

import { graphVersion } from "@/lib/connections/config";
import { graphRequest, type FetchLike } from "@/lib/connections/graph";
import type { ConnectionView } from "@/lib/connections/types";
import { getDb } from "@/lib/db";
import { redactPaymentIds } from "@/lib/payments/redact";
import type { ResearchDeps } from "./deps";
import { oneLine, type GatheredFinding } from "./findings";
import type { Competitor, TrendSource } from "./types";
import { inWindow, type ResearchWindow } from "./window";

export const MIN_SNAPSHOT_GAP_DAYS = 3;
export const MAX_SNAPSHOT_AGE_DAYS = 21;
export const RECENT_MEDIA_LIMIT = 12;
export const POSTS_PER_FINDING = 3;

/** True only when IDEAS_BUSINESS_DISCOVERY is exactly "on". Off by default until App Review. */
export function businessDiscoveryEnabled(env: Record<string, string | undefined>): boolean {
  return (env.IDEAS_BUSINESS_DISCOVERY ?? "").trim().toLowerCase() === "on";
}

export interface RecentPost {
  permalink: string;
  /** ISO timestamp from Instagram. */
  postedAt: string;
  format: "photo" | "video" | "carousel";
  likes: number | null;
  comments: number | null;
}

export interface DiscoveryData {
  followers: number | null;
  mediaCount: number | null;
  recent: RecentPost[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const FORMAT: Record<string, RecentPost["format"]> = { IMAGE: "photo", VIDEO: "video", CAROUSEL_ALBUM: "carousel" };

/** Reads the Graph answer into plain data. Pure. */
export function parseDiscovery(body: unknown): DiscoveryData | null {
  const bd = (body as { business_discovery?: Record<string, unknown> } | null)?.business_discovery;
  if (!bd || typeof bd !== "object") return null;
  const recent: RecentPost[] = [];
  const data = (bd.media as { data?: unknown } | undefined)?.data;
  for (const m of Array.isArray(data) ? data : []) {
    const r = m as Record<string, unknown>;
    if (typeof r.permalink !== "string" || !/^https:\/\/(www\.)?instagram\.com\//i.test(r.permalink) || typeof r.timestamp !== "string") continue;
    if (Number.isNaN(Date.parse(r.timestamp))) continue;
    recent.push({
      permalink: r.permalink,
      postedAt: r.timestamp,
      format: FORMAT[String(r.media_type)] ?? "photo",
      likes: num(r.like_count),
      comments: num(r.comment_count ?? r.comments_count),
    });
  }
  return { followers: num(bd.followers_count), mediaCount: num(bd.media_count), recent };
}

const avgEngagement = (posts: Pick<RecentPost, "likes" | "comments">[]): number | null => {
  const counted = posts.filter((p) => p.likes !== null || p.comments !== null);
  if (counted.length === 0) return null;
  return counted.reduce((s, p) => s + (p.likes ?? 0) + (p.comments ?? 0), 0) / counted.length;
};

const pct = (now: number, before: number): number | null => (before > 0 ? Math.max(-99999, Math.min(99999, Math.round(((now - before) / before) * 10000) / 100)) : null);

/** Percent change against the previous snapshot: average engagement per post when both have it, else followers. Null without history. */
export function velocityOf(now: DiscoveryData, before: Pick<DiscoveryData, "followers" | "recent"> | null): number | null {
  if (!before) return null;
  const a = avgEngagement(now.recent);
  const b = avgEngagement(before.recent);
  if (a !== null && b !== null) {
    const v = pct(a, b);
    if (v !== null) return v;
  }
  if (now.followers !== null && before.followers !== null) return pct(now.followers, before.followers);
  return null;
}

/** The finding for one competitor from fresh data. Null when no recent post falls inside the window. */
export function findingFromDiscovery(competitor: Pick<Competitor, "name">, d: DiscoveryData, w: ResearchWindow, velocity: number | null): GatheredFinding | null {
  const c = { name: redactPaymentIds(competitor.name) };
  const inside = d.recent.filter((p) => inWindow(p.postedAt.slice(0, 10), w));
  if (inside.length === 0) return null;
  const byFormat = new Map<string, number>();
  for (const p of inside) byFormat.set(p.format, (byFormat.get(p.format) ?? 0) + 1);
  const topFormat = [...byFormat.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  const label = (f: string) => (f === "video" ? "video or reel" : f);
  const ranked = [...inside].sort((x, y) => (y.likes ?? 0) + (y.comments ?? 0) - ((x.likes ?? 0) + (x.comments ?? 0)) || x.permalink.localeCompare(y.permalink));
  const sources: TrendSource[] = ranked.slice(0, POSTS_PER_FINDING).map((p) => ({
    url: p.permalink,
    title: `${oneLine(c.name, 60)}: ${label(p.format)} post`,
    site: "instagram.com",
    publishedAt: p.postedAt.slice(0, 10),
    kind: "competitor_instagram",
    engagement: { ...(p.likes !== null ? { likes: p.likes } : {}), ...(p.comments !== null ? { comments: p.comments } : {}) },
  }));
  return {
    topic: `${oneLine(c.name, 50)} on Instagram`,
    note: `${c.name} posted ${inside.length} time${inside.length === 1 ? "" : "s"} recently, mostly as ${label(topFormat)} posts.`,
    sources,
    kind: "competitor",
    velocity,
  };
}

async function igUserId(conn: ConnectionView, token: string, fetchFn: FetchLike): Promise<string | null> {
  const body = await graphRequest<{ instagram_business_account?: { id?: unknown } }>({
    url: `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(conn.accountId)}`,
    params: { fields: "instagram_business_account" },
    token,
    fetch: fetchFn,
  });
  const id = body.instagram_business_account?.id;
  return typeof id === "string" && /^\d{5,25}$/.test(id) ? id : null;
}

async function fetchDiscovery(igId: string, handle: string, token: string, fetchFn: FetchLike): Promise<DiscoveryData | null> {
  const fields = `business_discovery.username(${handle}){followers_count,media_count,media.limit(${RECENT_MEDIA_LIMIT}){permalink,timestamp,media_type,like_count,comments_count}}`;
  const body = await graphRequest<Record<string, unknown>>({
    url: `https://graph.facebook.com/${graphVersion()}/${igId}`,
    params: { fields },
    token,
    fetch: fetchFn,
  });
  return parseDiscovery(body);
}

interface SnapshotRow {
  followers: number | null;
  recent: RecentPost[];
  age_days: number;
}

/** The last snapshot that is old enough to compare with (at least MIN_SNAPSHOT_GAP_DAYS) and not too old. */
async function previousSnapshot(competitorId: string, now: Date): Promise<SnapshotRow | null> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ followers: number | null; recent: unknown; age_days: number }>(
      `select followers, recent, extract(epoch from ($2::timestamptz - taken_at)) / 86400.0 as age_days
         from public.competitor_snapshots
        where competitor_id = $1 and taken_at <= $2::timestamptz - make_interval(days => $3)
        order by taken_at desc limit 1`,
      [competitorId, now.toISOString(), MIN_SNAPSHOT_GAP_DAYS],
    ),
  );
  if (!row || Number(row.age_days) > MAX_SNAPSHOT_AGE_DAYS) return null;
  const recent = Array.isArray(row.recent)
    ? (row.recent as Record<string, unknown>[]).map((r) => ({
        permalink: String(r.permalink ?? ""),
        postedAt: String(r.posted_at ?? ""),
        format: (r.format as RecentPost["format"]) ?? "photo",
        likes: num(r.likes),
        comments: num(r.comments),
      }))
    : [];
  return { followers: row.followers, recent, age_days: Number(row.age_days) };
}

async function saveSnapshot(brandId: string, competitorId: string, d: DiscoveryData, now: Date): Promise<void> {
  const recent = d.recent.map((p) => ({ permalink: p.permalink, posted_at: p.postedAt, format: p.format, likes: p.likes, comments: p.comments }));
  await getDb().withService((tx) =>
    tx.query(
      `insert into public.competitor_snapshots (brand_id, competitor_id, taken_at, followers, media_count, recent)
       values ($1, $2, $3::timestamptz, $4, $5, $6::jsonb)`,
      [brandId, competitorId, now.toISOString(), d.followers, d.mediaCount, JSON.stringify(recent)],
    ),
  );
}

export type DiscoverySkip = "switch_off" | "no_handle" | "no_connection" | "no_instagram_account";

export interface DiscoveryResult {
  finding: GatheredFinding | null;
  skipped: DiscoverySkip | null;
}

/**
 * One competitor's Instagram. Skips (no network call) when the switch is off, there is no handle, or the brand has
 * no active Facebook connection. Throws GraphError when Meta refuses (the run counts that as a source error).
 */
export async function discoverCompetitorInstagram(
  brandId: string,
  competitor: Competitor,
  w: ResearchWindow,
  now: Date,
  deps: Pick<ResearchDeps, "env" | "fetch" | "getConnection" | "readToken">,
): Promise<DiscoveryResult> {
  if (!businessDiscoveryEnabled(deps.env)) return { finding: null, skipped: "switch_off" };
  if (!competitor.instagramHandle) return { finding: null, skipped: "no_handle" };
  const conn = await deps.getConnection(brandId, "facebook");
  if (!conn || conn.status !== "active") return { finding: null, skipped: "no_connection" };
  const token = await deps.readToken({ id: conn.id, brandId: conn.brandId, provider: conn.provider });
  const igId = await igUserId(conn, token, deps.fetch);
  if (!igId) return { finding: null, skipped: "no_instagram_account" };
  const data = await fetchDiscovery(igId, competitor.instagramHandle, token, deps.fetch);
  if (!data) return { finding: null, skipped: null };
  const before = await previousSnapshot(competitor.id, now);
  await saveSnapshot(brandId, competitor.id, data, now);
  return { finding: findingFromDiscovery(competitor, data, w, velocityOf(data, before)), skipped: null };
}
