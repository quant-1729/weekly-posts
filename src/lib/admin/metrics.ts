// Read-only numbers for the admin dashboard (/admin), across all brands. Server only.
//
// Reads through getDb().withService (like src/lib/usage/report.ts), so the caller must have passed
// requireAdmin(): the AdminUser argument is the proof. Queries are aggregates or short lists (LIMIT).
//
// Privacy: never selects payment IDs, tokens, magic links, approval links, secrets or post text.
// Brands are shown by name, owner emails masked, error texts cleaned and cut to 200 characters.

import { getDb } from "@/lib/db";
import { WEEKLY_USD_CAP } from "@/lib/usage/caps";
import { cleanError, maskEmail, type AdminUser } from "./access";

/** A timestamp column as a UTC ISO string, the same in the mock and in Supabase. */
const TS = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const STUCK_MINUTES = 30;
const LIST_LIMIT = 20;
const DAYS = 14;

export interface Count {
  key: string;
  n: number;
}

export interface AdminMetrics {
  /** ISO time the numbers were read. */
  generatedAt: string;
  overview: { owners: number; brands: number; newOwners7d: number; newOwners30d: number; activeBrands7d: number };
  cost: {
    todayUsd: number;
    last7dUsd: number;
    last30dUsd: number;
    byKind: Array<{ kind: string; calls7d: number; usd7d: number; calls30d: number; usd30d: number }>;
    weeklyCapUsd: number;
    /** Top 10 brands by spend in their current local week. */
    topBrands: Array<{ brandId: string; brandName: string; usd: number; calls: number; overCap: boolean }>;
  };
  /** One row per UTC day, oldest first, DAYS rows. */
  postsPerDay: Array<{ day: string; created: number; approved: number; published: number; delivered: number }>;
  queue: {
    byStatus: Count[];
    stuckMinutes: number;
    stuck: Array<{ brandName: string; channel: string; status: string; slotAt: string; minutesLate: number; attempts: number }>;
    failures: Array<{ brandName: string; channel: string; at: string; attempts: number; error: string }>;
  };
  connections: {
    byProviderStatus: Array<{ provider: string; status: string; n: number }>;
    problems: Array<{ brandName: string; provider: string; status: string; at: string; error: string }>;
  };
  email: {
    byKindStatus: Array<{ kind: string; sent: number; failed: number; queued: number }>;
    failures: Array<{ kind: string; brandName: string; to: string; at: string; error: string }>;
  };
  deletions: { byStatus: Count[]; oldestPendingAt: string | null };
  /** Ideas (trend research, R-10). Counts, cost and cleaned error codes only: no focus text, searches or card text. */
  research: {
    /** Monday 00:00 UTC of the current week (YYYY-MM-DD). */
    weekStart: string;
    runsThisWeek: number;
    /** Runs started this week by status (running, done, failed, capped). */
    byStatus: Count[];
    costThisWeekUsd: number;
    costTotalUsd: number;
    /** Failed runs of the last 14 days, newest first. */
    failures: Array<{ brandName: string; trigger: string; at: string; error: string }>;
    /** Why runs were capped in the last 30 days, most common first (top 5). */
    cappedReasons: Count[];
  };
}

type Num = number | string | null;
const num = (v: Num | undefined) => Number(v) || 0;

/** Reads every panel in one transaction. `now` is for tests. */
export async function getAdminMetrics(admin: AdminUser, now: Date = new Date()): Promise<AdminMetrics> {
  if (!admin?.isAdmin) throw new Error("getAdminMetrics needs the result of requireAdmin()");
  const nowIso = now.toISOString();

  return getDb().withService(async (tx) => {
    const q = <T>(sql: string, params: unknown[] = [nowIso]) => tx.query<T>(sql, params);

    // Overview
    const [ov] = await q<{ owners: number; brands: number; n7: number; n30: number; active: number }>(
      `select (select count(*)::int from public.profiles) as owners,
              (select count(*)::int from public.brands) as brands,
              (select count(*)::int from public.profiles where created_at >= $1::timestamptz - interval '7 days') as n7,
              (select count(*)::int from public.profiles where created_at >= $1::timestamptz - interval '30 days') as n30,
              (select count(*)::int from (
                 select brand_id from public.usage_events where created_at >= $1::timestamptz - interval '7 days'
                 union select brand_id from public.posts where created_at >= $1::timestamptz - interval '7 days'
                 union select brand_id from public.post_actions where created_at >= $1::timestamptz - interval '7 days'
               ) a) as active`,
    );

    // AI cost
    const [spend] = await q<{ today: Num; d7: Num; d30: Num }>(
      `select coalesce(sum(usd) filter (where created_at >= (date_trunc('day', $1::timestamptz at time zone 'UTC')) at time zone 'UTC'), 0) as today,
              coalesce(sum(usd) filter (where created_at >= $1::timestamptz - interval '7 days'), 0) as d7,
              coalesce(sum(usd), 0) as d30
         from public.usage_events
        where created_at >= $1::timestamptz - interval '30 days' and created_at <= $1::timestamptz`,
    );
    const byKind = await q<{ kind: string; c7: number; u7: Num; c30: number; u30: Num }>(
      `select kind::text as kind,
              (count(*) filter (where created_at >= $1::timestamptz - interval '7 days'))::int as c7,
              coalesce(sum(usd) filter (where created_at >= $1::timestamptz - interval '7 days'), 0) as u7,
              count(*)::int as c30, coalesce(sum(usd), 0) as u30
         from public.usage_events
        where created_at >= $1::timestamptz - interval '30 days' and created_at <= $1::timestamptz
        group by kind order by u30 desc, kind limit 50`,
    );
    const top = await q<{ brand_id: string; name: string; usd: Num; n: number }>(
      `select u.brand_id::text as brand_id, b.name, coalesce(sum(u.usd), 0) as usd, count(*)::int as n
         from public.usage_events u
         join public.brands b on b.id = u.brand_id
         left join public.brand_memory m on m.brand_id = u.brand_id
        where u.created_at >= (date_trunc('week', $1::timestamptz at time zone coalesce(m.timezone, 'UTC'))) at time zone coalesce(m.timezone, 'UTC')
          and u.created_at <= $1::timestamptz
        group by u.brand_id, b.name
        order by usd desc, b.name limit 10`,
    );

    // Posts per UTC day: posts created and approved (carousel slides are not counted again), queue items published or delivered.
    const dayRows = await q<{ day: string; created: number; approved: number; published: number; delivered: number }>(
      `with days as (
         select (d::date)::text as day, d::date as dd
           from generate_series((date_trunc('day', $1::timestamptz at time zone 'UTC') - make_interval(days => ${DAYS - 1}))::date,
                                (date_trunc('day', $1::timestamptz at time zone 'UTC'))::date, interval '1 day') d
       )
       select days.day,
              (select count(*)::int from public.posts p where p.slide_index is null and (p.created_at at time zone 'UTC')::date = days.dd) as created,
              (select count(*)::int from public.posts p where p.slide_index is null and (p.approved_at at time zone 'UTC')::date = days.dd) as approved,
              (select count(*)::int from public.queue_items i where i.status = 'published' and (i.done_at at time zone 'UTC')::date = days.dd) as published,
              (select count(*)::int from public.queue_items i where i.status = 'delivered' and (i.done_at at time zone 'UTC')::date = days.dd) as delivered
         from days order by days.dd`,
    );

    // Queue
    const qStatus = await q<Count>(`select status as key, count(*)::int as n from public.queue_items group by status order by status`, []);
    const stuck = await q<{ name: string; channel: string; status: string; slot_at: string; late: number; attempts: number }>(
      `select b.name, i.channel::text as channel, i.status, ${TS("i.slot_at")} as slot_at, i.attempts::int as attempts,
              (extract(epoch from ($1::timestamptz - case when i.status = 'publishing' then i.updated_at else i.slot_at end)) / 60)::int as late
         from public.queue_items i join public.brands b on b.id = i.brand_id
        where i.done_at is null
          and ((i.status = 'publishing' and i.updated_at <= $1::timestamptz - make_interval(mins => ${STUCK_MINUTES}))
            or (i.status = 'scheduled' and i.slot_at <= $1::timestamptz - make_interval(mins => ${STUCK_MINUTES})))
        order by i.slot_at limit ${LIST_LIMIT}`,
    );
    const failures = await q<{ name: string; channel: string; at: string; attempts: number; err: string | null }>(
      `select b.name, i.channel::text as channel, ${TS("i.updated_at")} as at, i.attempts::int as attempts, left(i.last_error, 300) as err
         from public.queue_items i join public.brands b on b.id = i.brand_id
        where i.status = 'failed'
        order by i.updated_at desc limit ${LIST_LIMIT}`,
      [],
    );

    // Connections
    const conns = await q<{ provider: string; status: string; n: number }>(
      `select provider, status, count(*)::int as n from public.channel_connections group by provider, status order by provider, status`,
      [],
    );
    const connProblems = await q<{ name: string; provider: string; status: string; at: string; err: string | null }>(
      `select b.name, c.provider, c.status, ${TS("c.updated_at")} as at, left(c.last_error, 300) as err
         from public.channel_connections c join public.brands b on b.id = c.brand_id
        where c.status <> 'active' or c.last_error is not null
        order by c.updated_at desc limit ${LIST_LIMIT}`,
      [],
    );

    // Email
    const mail = await q<{ kind: string; sent: number; failed: number; queued: number }>(
      `select kind::text as kind,
              (count(*) filter (where status = 'sent'))::int as sent,
              (count(*) filter (where status = 'failed'))::int as failed,
              (count(*) filter (where status = 'queued'))::int as queued
         from public.email_log
        where created_at >= $1::timestamptz - interval '7 days' and created_at <= $1::timestamptz
        group by kind order by kind::text`,
    );
    const mailFails = await q<{ kind: string; name: string | null; to_email: string; at: string; err: string | null }>(
      `select e.kind::text as kind, b.name, e.to_email, ${TS("e.created_at")} as at, left(e.error, 300) as err
         from public.email_log e left join public.brands b on b.id = e.brand_id
        where e.status = 'failed' and e.created_at >= $1::timestamptz - interval '7 days'
        order by e.created_at desc limit ${LIST_LIMIT}`,
    );

    // Meta data-deletion requests
    const delStatus = await q<Count>(`select status as key, count(*)::int as n from public.deletion_requests group by status order by status`, []);
    const [oldest] = await q<{ at: string | null }>(`select ${TS("min(created_at)")} as at from public.deletion_requests where status <> 'done'`, []);

    // Research (Ideas). The week is the UTC week, like the rest of this page.
    const weekFilter = `started_at >= (date_trunc('week', $1::timestamptz at time zone 'UTC')) at time zone 'UTC' and started_at <= $1::timestamptz`;
    const [resWeek] = await q<{ week: string }>(`select to_char(date_trunc('week', $1::timestamptz at time zone 'UTC'), 'YYYY-MM-DD') as week`);
    const resStatus = await q<Count>(
      `select status as key, count(*)::int as n from public.research_runs where ${weekFilter} group by status order by status`,
    );
    const [resCost] = await q<{ week: Num; total: Num }>(
      `select coalesce(sum(cost_usd) filter (where ${weekFilter}), 0) as week, coalesce(sum(cost_usd), 0) as total from public.research_runs`,
    );
    const resFails = await q<{ name: string; trigger: string; at: string; err: string | null }>(
      `select b.name, r.trigger, ${TS("r.started_at")} as at, left(r.error, 300) as err
         from public.research_runs r join public.brands b on b.id = r.brand_id
        where r.status = 'failed' and r.started_at >= $1::timestamptz - interval '14 days'
        order by r.started_at desc limit ${LIST_LIMIT}`,
    );
    const resCapped = await q<Count>(
      `select coalesce(error, 'unknown') as key, count(*)::int as n from public.research_runs
        where status = 'capped' and started_at >= $1::timestamptz - interval '30 days'
        group by coalesce(error, 'unknown') order by n desc, key limit 5`,
    );

    return {
      generatedAt: nowIso,
      overview: { owners: ov.owners, brands: ov.brands, newOwners7d: ov.n7, newOwners30d: ov.n30, activeBrands7d: ov.active },
      cost: {
        todayUsd: num(spend?.today),
        last7dUsd: num(spend?.d7),
        last30dUsd: num(spend?.d30),
        byKind: byKind.map((r) => ({ kind: r.kind, calls7d: r.c7, usd7d: num(r.u7), calls30d: r.c30, usd30d: num(r.u30) })),
        weeklyCapUsd: WEEKLY_USD_CAP,
        topBrands: top.map((r) => ({ brandId: r.brand_id, brandName: r.name, usd: num(r.usd), calls: r.n, overCap: num(r.usd) >= WEEKLY_USD_CAP })),
      },
      postsPerDay: dayRows.map((r) => ({ day: r.day, created: r.created, approved: r.approved, published: r.published, delivered: r.delivered })),
      queue: {
        byStatus: qStatus,
        stuckMinutes: STUCK_MINUTES,
        stuck: stuck.map((r) => ({ brandName: r.name, channel: r.channel, status: r.status, slotAt: r.slot_at, minutesLate: r.late, attempts: r.attempts })),
        failures: failures.map((r) => ({ brandName: r.name, channel: r.channel, at: r.at, attempts: r.attempts, error: cleanError(r.err) })),
      },
      connections: {
        byProviderStatus: conns,
        problems: connProblems.map((r) => ({ brandName: r.name, provider: r.provider, status: r.status, at: r.at, error: cleanError(r.err) })),
      },
      email: {
        byKindStatus: mail,
        failures: mailFails.map((r) => ({ kind: r.kind, brandName: r.name ?? "(no brand)", to: maskEmail(r.to_email), at: r.at, error: cleanError(r.err) })),
      },
      deletions: { byStatus: delStatus, oldestPendingAt: oldest?.at ?? null },
      research: {
        weekStart: resWeek?.week ?? "",
        runsThisWeek: resStatus.reduce((sum, r) => sum + r.n, 0),
        byStatus: resStatus,
        costThisWeekUsd: num(resCost?.week),
        costTotalUsd: num(resCost?.total),
        failures: resFails.map((r) => ({ brandName: r.name, trigger: r.trigger, at: r.at, error: cleanError(r.err) })),
        cappedReasons: resCapped.map((r) => ({ key: cleanError(r.key), n: r.n })),
      },
    };
  });
}
