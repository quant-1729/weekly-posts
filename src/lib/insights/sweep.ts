// The hourly insights sweep (R-8): for each published Instagram or Facebook post, stores how it did at about 24 h,
// 72 h and 7 days after it went out (one post_metrics row per post and bucket; age_hours holds the bucket, fetched_at
// the real time).
//
// Which bucket a post is in is decided by its age: the newest bucket it has reached. A post found late (the sweep was
// down, or the connection was repaired) is measured once at the bucket it has reached and the earlier ones stay empty,
// because the numbers read then are the numbers of today. A story is measured once from 20 h (Meta drops story insights at 24 h).
//
// Safe to run twice at once: a post-and-bucket is CLAIMED by inserting its row under an advisory lock in one
// transaction; the run whose insert returns the row fetches, the other finds the row and moves on. If the fetch cannot
// answer now (Meta busy, bad token, no permission) the claim is released so a later run tries again. A post whose
// metrics are all refused keeps an empty row ("asked, nothing to show") and is not asked again. A run that died
// between claim and answer leaves an empty row for that bucket: that bucket stays empty.
//
// Nothing here changes a queue item. A token is decrypted, used for the calls and dropped: never logged, never in a
// result or an error (messages are scrubbed of it).

import { GraphError, scrub, type FetchLike } from "@/lib/connections/graph";
import { readToken as realReadToken } from "@/lib/connections/tokens";
import { getDb } from "@/lib/db";
import type { Provider } from "@/lib/queue/types";
import { fetchFacebookInsights } from "./facebook";
import { fetchInstagramInsights } from "./instagram";
import {
  FB_INSIGHTS_SCOPES,
  IG_INSIGHTS_SCOPE,
  INSIGHTS_MAX_AGE_DAYS,
  InsightsError,
  METRIC_FIELDS,
  STORY_FETCH_FROM_HOURS,
  SWEEP_BATCH,
  type FetchedInsights,
  type InsightBucket,
  type InstagramMediaKind,
} from "./types";

export interface InsightsDeps {
  fetch?: FetchLike;
  /** Reads a connection's token (default: the connections module). Tests pass their own. */
  readToken?: (conn: { id: string; brandId: string; provider: Provider }) => Promise<string>;
  /** Stops starting new posts after this long (default 90 s, so a run ends inside the route's time limit). */
  budgetMs?: number;
}

export type InsightsOutcome = "stored" | "empty" | "permission_missing" | "token_problem" | "retry_later" | "claimed_elsewhere" | "error";

export interface InsightsItemResult {
  itemId: string;
  brandId: string;
  provider: Provider;
  bucket: InsightBucket;
  outcome: InsightsOutcome;
  /** Metrics Meta refused for this post (deprecated or not valid). */
  skipped?: string[];
}

export interface InsightsSummary {
  at: string;
  /** Posts that were due for a measurement and could be tried. */
  due: number;
  stored: number;
  /** Fetched, but Meta gave nothing (all metrics refused): an empty row marks it done. */
  empty: number;
  /** Due posts whose connection lacks the insights permission: skipped, nothing stored ("insights permission missing"). */
  permissionMissing: number;
  /** Meta said the permission is missing when we asked (the saved scopes were wrong). */
  permissionRefused: number;
  tokenProblems: number;
  retryLater: number;
  claimedElsewhere: number;
  errors: number;
  items: InsightsItemResult[];
}

interface DueRow {
  id: string;
  brand_id: string;
  provider: Provider;
  platform_post_id: string;
  bucket: number;
  media_kind: string;
  connection_id: string;
}

/**
 * The CTE every query shares: published posts with their age, bucket and kind, joined to the brand's connection.
 * $1 = now, $2 = max age in days.
 */
const BASE = `
  with c as (
    select q.id, q.brand_id, q.channel::text as provider, q.platform_post_id, q.done_at,
           extract(epoch from ($1::timestamptz - q.done_at)) / 3600.0 as age_h,
           cc.id as connection_id, cc.status as conn_status, cc.expires_at as conn_expires, cc.scopes,
           case
             when q.channel::text <> 'instagram' then 'page'
             when (select count(*) from public.posts s
                    where s.brand_id = p.brand_id and s.carousel_id = coalesce(p.carousel_id, nullif(p.design -> 'carousel' ->> 'id', '')::uuid)) >= 2 then 'carousel'
             when exists (select 1 from public.post_images i where i.post_id = p.id and i.brand_id = p.brand_id and i.format::text = 'vertical')
              and not exists (select 1 from public.post_images i where i.post_id = p.id and i.brand_id = p.brand_id and i.format::text in ('portrait', 'square', 'landscape')) then 'story'
             else 'feed'
           end as media_kind
      from public.queue_items q
      join public.posts p on p.id = q.post_id and p.brand_id = q.brand_id
      join public.channel_connections cc on cc.brand_id = q.brand_id and cc.provider = q.channel::text
     where q.status = 'published' and q.platform_post_id is not null and q.done_at is not null
       and q.channel::text in ('instagram', 'facebook')
       and q.done_at <= $1::timestamptz - make_interval(hours => ${STORY_FETCH_FROM_HOURS})
       and q.done_at > $1::timestamptz - make_interval(days => $2)
  ), t as (
    select c.*, case
             when media_kind = 'story' then 24
             when age_h >= 168 then 168
             when age_h >= 72 then 72
             when age_h >= 24 then 24
           end as bucket
      from c
  ), due as (
    select t.* from t
     where t.bucket is not null
       and not exists (select 1 from public.post_metrics m where m.queue_item_id = t.id and m.age_hours = t.bucket)
  ), usable as (
    select due.* from due
     where due.conn_status = 'active' and (due.conn_expires is null or due.conn_expires > $1::timestamptz)
  )`;

const HAS_SCOPES = `
  case when u.provider = 'instagram' then $3::text = any(u.scopes)
       else $4::text[] <@ u.scopes end`;

async function loadDue(now: Date, limit: number): Promise<DueRow[]> {
  return getDb().withService((tx) =>
    tx.query<DueRow>(
      `${BASE}
       select u.id::text as id, u.brand_id::text as brand_id, u.provider, u.platform_post_id, u.bucket::int as bucket, u.media_kind, u.connection_id::text as connection_id
         from usable u
        where ${HAS_SCOPES}
        order by u.done_at, u.id
        limit $5`,
      [now.toISOString(), INSIGHTS_MAX_AGE_DAYS, IG_INSIGHTS_SCOPE, [...FB_INSIGHTS_SCOPES], limit],
    ),
  );
}

async function countPermissionMissing(now: Date): Promise<number> {
  const [r] = await getDb().withService((tx) =>
    tx.query<{ n: number }>(
      `${BASE}
       select count(*)::int as n from usable u where not (${HAS_SCOPES})`,
      [now.toISOString(), INSIGHTS_MAX_AGE_DAYS, IG_INSIGHTS_SCOPE, [...FB_INSIGHTS_SCOPES]],
    ),
  );
  return r?.n ?? 0;
}

/** Inserts the (empty) row for this post and bucket if none exists, under a lock; returns its id, or null when another run has it. */
async function claim(row: DueRow, now: Date): Promise<string | null> {
  return getDb().withService(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`insights:${row.id}:${row.bucket}`]);
    const [r] = await tx.query<{ id: string }>(
      `insert into public.post_metrics (brand_id, queue_item_id, age_hours, fetched_at)
       select $1::uuid, $2::uuid, $3::int, $4::timestamptz
        where not exists (select 1 from public.post_metrics where queue_item_id = $2::uuid and age_hours = $3::int)
       returning id::text as id`,
      [row.brand_id, row.id, row.bucket, now.toISOString()],
    );
    return r?.id ?? null;
  });
}

async function release(metricId: string): Promise<void> {
  await getDb().withService((tx) => tx.query("delete from public.post_metrics where id = $1", [metricId]));
}

async function store(metricId: string, fetched: FetchedInsights, now: Date): Promise<boolean> {
  const values = METRIC_FIELDS.map((f) => fetched.metrics[f] ?? null);
  await getDb().withService((tx) =>
    tx.query(
      `update public.post_metrics set fetched_at = $2::timestamptz, reach = $3, impressions = $4, likes = $5, comments = $6, saves = $7, shares = $8, views = $9 where id = $1`,
      [metricId, now.toISOString(), ...values],
    ),
  );
  return METRIC_FIELDS.some((f) => fetched.metrics[f] !== undefined);
}

function summaryLine(sum: InsightsSummary): string {
  return JSON.stringify({ ...sum, items: undefined });
}

/**
 * The sweep. `now` is the test clock. Never throws for one post's problem: that post is counted in `errors` and the
 * rest still run. Processes at most `limit` posts per run.
 */
export async function sweepInsights(opts: { now?: Date; limit?: number } = {}, deps: InsightsDeps = {}): Promise<InsightsSummary> {
  const now = opts.now ?? new Date();
  const sum: InsightsSummary = {
    at: now.toISOString(),
    due: 0,
    stored: 0,
    empty: 0,
    permissionMissing: 0,
    permissionRefused: 0,
    tokenProblems: 0,
    retryLater: 0,
    claimedElsewhere: 0,
    errors: 0,
    items: [],
  };
  const readToken = deps.readToken ?? realReadToken;
  const started = Date.now();
  const budget = deps.budgetMs ?? 90_000;

  sum.permissionMissing = await countPermissionMissing(now);
  const due = await loadDue(now, opts.limit ?? SWEEP_BATCH);
  sum.due = due.length;

  for (const row of due) {
    if (Date.now() - started > budget) break; // the rest waits for the next run
    const bucket = row.bucket as InsightBucket;
    const result: InsightsItemResult = { itemId: row.id, brandId: row.brand_id, provider: row.provider, bucket, outcome: "error" };
    sum.items.push(result);
    let metricId: string | null = null;
    let token = "";
    try {
      metricId = await claim(row, now);
      if (!metricId) {
        result.outcome = "claimed_elsewhere";
        sum.claimedElsewhere++;
        continue;
      }
      token = await readToken({ id: row.connection_id, brandId: row.brand_id, provider: row.provider });
      const fetched =
        row.provider === "instagram"
          ? await fetchInstagramInsights({ mediaId: row.platform_post_id, kind: row.media_kind as InstagramMediaKind, token, fetch: deps.fetch })
          : await fetchFacebookInsights({ postId: row.platform_post_id, token, fetch: deps.fetch });
      result.skipped = fetched.skipped;
      const any = await store(metricId, fetched, now);
      metricId = null; // kept
      result.outcome = any ? "stored" : "empty";
      if (any) sum.stored++;
      else sum.empty++;
    } catch (e) {
      if (metricId) await release(metricId).catch(() => undefined);
      if (e instanceof InsightsError) {
        if (e.kind === "permission") {
          result.outcome = "permission_missing";
          sum.permissionRefused++;
        } else if (e.kind === "token") {
          result.outcome = "token_problem";
          sum.tokenProblems++;
        } else {
          result.outcome = "retry_later";
          sum.retryLater++;
        }
      } else {
        result.outcome = "error";
        sum.errors++;
        const msg = e instanceof GraphError || e instanceof Error ? e.message : "unknown error";
        console.error(`[insights] item ${row.id} failed: ${scrub(msg, [token]).slice(0, 300)}`);
      }
    }
  }
  console.info(`[insights] sweep ${summaryLine(sum)}`);
  return sum;
}
