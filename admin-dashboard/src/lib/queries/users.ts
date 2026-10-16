import { db } from "../db";
import {
  PAGE_SIZE,
  Params,
  UUID_RE,
  cleanText,
  decodeCursor,
  iso,
  likeContains,
  paginate,
  type Page,
} from "./common";
import { SESSION_COLUMNS, type SessionRow } from "./devices";
import { cleanError } from "../format";

export interface UserRow {
  id: string;
  ts: string; // sign-up time, ISO (cursor)
  email: string | null;
  display_name: string | null;
  brand_name: string | null;
  signed_up: string;
  last_seen: string | null;
  sessions: number;
  posts: number;
  ai_spend: number;
}

export function usersSql(f: { q?: string; cursor?: string }): { sql: string; params: unknown[] } {
  const p = new Params();
  const where: string[] = [];
  const q = cleanText(f.q);
  if (q) where.push(`p.email ilike ${p.add(likeContains(q))} escape '\\'`);
  const cur = decodeCursor(f.cursor, UUID_RE);
  if (cur) where.push(`(p.created_at, p.id) < (${p.add(cur.t)}::timestamptz, ${p.add(cur.i)}::uuid)`);
  // The page is cut first, so the per-user counts below run for 51 users at most.
  const sql = `
with page as (
  select p.id, p.email, p.display_name, p.created_at, p.last_brand_id
    from public.profiles p
   ${where.length ? `where ${where.join(" and ")}` : ""}
   order by p.created_at desc, p.id desc
   limit ${PAGE_SIZE + 1}
)
select page.id::text as id, ${iso("page.created_at")} as ts, page.email, page.display_name, b.name as brand_name,
       ${iso("page.created_at")} as signed_up,
       ${iso("(select max(s.last_seen_at) from public.user_sessions s where s.user_id = page.id)")} as last_seen,
       (select count(*)::int from public.user_sessions s where s.user_id = page.id) as sessions,
       (select count(*)::int from public.posts po where po.created_by = page.id) as posts,
       (select coalesce(sum(u.usd), 0)::float8 from public.usage_events u where u.user_id = page.id) as ai_spend
  from page
  left join public.brands b on b.id = page.last_brand_id
 order by page.created_at desc, page.id desc`;
  return { sql, params: p.values };
}

export async function listUsers(f: { q?: string; cursor?: string }): Promise<Page<UserRow>> {
  const { sql, params } = usersSql(f);
  return paginate(await db().query<UserRow>(sql, params));
}

// ---------------------------------------------------------------------------------------------------------------
// One user
// ---------------------------------------------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  signed_up: string;
}

export const USER_PROFILE_SQL = `
select p.id::text as id, p.email, p.display_name, ${iso("p.created_at")} as signed_up
  from public.profiles p
 where p.id = $1::uuid`;

export const USER_BRANDS_SQL = `
select b.name, m.role::text as role
  from public.brand_members m
  join public.brands b on b.id = m.brand_id
 where m.user_id = $1::uuid
 order by b.name
 limit 50`;

export const USER_SESSIONS_SQL = `
select ${SESSION_COLUMNS}
  from public.user_sessions s
  left join public.profiles p on p.id = s.user_id
  left join public.brands b on b.id = p.last_brand_id
 where s.user_id = $1::uuid
 order by s.last_seen_at desc, s.id desc
 limit 25`;

export const USER_AI_BY_KIND_SQL = `
select u.kind::text as kind, count(*)::int as n, coalesce(sum(u.usd), 0)::float8 as usd
  from public.usage_events u
 where u.user_id = $1::uuid
 group by u.kind
 order by count(*) desc`;

export const USER_COUNTS_SQL = `
select
  (select count(*)::int from public.post_briefs where created_by = $1::uuid) as briefs,
  (select count(*)::int from public.posts where created_by = $1::uuid) as posts,
  (select count(*)::int from public.posts where created_by = $1::uuid and approved_at is not null) as approved,
  (select count(*)::int from public.queue_items q join public.posts po on po.id = q.post_id
     where po.created_by = $1::uuid and q.status = 'scheduled') as scheduled,
  (select count(*)::int from public.queue_items q join public.posts po on po.id = q.post_id
     where po.created_by = $1::uuid and q.status = 'published') as published,
  (select count(*)::int from public.queue_items q join public.posts po on po.id = q.post_id
     where po.created_by = $1::uuid and q.status = 'failed') as failed,
  (select count(*)::int from public.research_runs r join public.brand_members m on m.brand_id = r.brand_id
     where m.user_id = $1::uuid) as research_runs,
  (select count(*)::int from public.brand_faces where created_by = $1::uuid) as faces`;

export interface UserCounts {
  briefs: number;
  posts: number;
  approved: number;
  scheduled: number;
  published: number;
  failed: number;
  research_runs: number;
  faces: number;
}

export interface TimelineRow {
  id: string; // source-prefixed key, unique per row
  ts: string;
  src: string;
  kind: string;
  status: string;
  info: string;
  brand_name: string | null;
  link: string | null;
}

/**
 * One merged, newest-first feed of what a user did. Every branch selects short codes and counts only: no post text,
 * captions, brief notes, descriptions, payment details or email bodies.
 */
export function timelineSql(userId: string, cursor?: string): { sql: string; params: unknown[] } {
  const p = new Params();
  const uid = p.add(userId);
  const cur = decodeCursorKey(cursor);
  const keyset = cur ? `where (ev.at, ev.key) < (${p.add(cur.t)}::timestamptz, ${p.add(cur.i)}::text)` : "";
  const sql = `
with ev as (
  select a.at as at, 'a' || a.id::text as key, 'activity' as src, a.kind as kind,
         case when a.ok then 'ok' else 'failed' end as status, ''::text as info, a.brand_id as brand_id, null::text as link
    from public.app_events a where a.user_id = ${uid}::uuid
  union all
  select s.created_at, 's' || s.id::text, 'session', 'session.started', 'ok',
         coalesce(s.device_type, '') || ' ' || coalesce(s.browser, '') || ' ' || coalesce(s.os, ''), null, null
    from public.user_sessions s where s.user_id = ${uid}::uuid
  union all
  select br.created_at, 'b' || br.id::text, 'brief', 'brief.created', br.status,
         br.post_type::text || case when cardinality(br.extra_post_types) > 0 then ' +' || cardinality(br.extra_post_types)::text else '' end,
         br.brand_id, null
    from public.post_briefs br where br.created_by = ${uid}::uuid
  union all
  select u.created_at, 'u' || u.id::text, 'generation', 'ai.' || u.kind::text, case when u.ok then 'ok' else 'failed' end,
         coalesce(u.model, '-') || ' $' || u.usd::text, u.brand_id, null
    from public.usage_events u where u.user_id = ${uid}::uuid
  union all
  select po.created_at, 'p' || po.id::text, 'post', 'post.created', po.status::text, coalesce(po.channel::text, ''), po.brand_id, null
    from public.posts po where po.created_by = ${uid}::uuid
  union all
  select po.approved_at, 'pa' || po.id::text, 'post', 'post.approved', 'ok', coalesce(po.channel::text, ''), po.brand_id, null
    from public.posts po where po.created_by = ${uid}::uuid and po.approved_at is not null
  union all
  select q.created_at, 'qs' || q.id::text, 'queue', 'queue.scheduled', 'ok',
         q.channel::text || ' for ' || ${iso("q.slot_at")}, q.brand_id, null
    from public.queue_items q join public.posts po on po.id = q.post_id where po.created_by = ${uid}::uuid
  union all
  select coalesce(q.done_at, q.updated_at), 'qd' || q.id::text, 'queue', 'queue.' || q.status,
         case when q.status in ('published', 'delivered') then 'ok' when q.status in ('failed', 'missed', 'expired') then 'failed' else 'ok' end,
         q.channel::text || ' attempts=' || q.attempts::text || case when q.last_error is not null then ' | ' || q.last_error else '' end,
         q.brand_id, q.permalink
    from public.queue_items q join public.posts po on po.id = q.post_id
   where po.created_by = ${uid}::uuid and q.status <> 'scheduled'
  union all
  select r.started_at, 'r' || r.id::text, 'research', 'research.' || r.trigger,
         case when r.status = 'failed' then 'failed' else 'ok' end, r.status || ' sources=' || r.sources_count::text || ' $' || r.cost_usd::text,
         r.brand_id, null
    from public.research_runs r join public.brand_members m on m.brand_id = r.brand_id where m.user_id = ${uid}::uuid
  union all
  select f.created_at, 'f' || f.id::text, 'face', 'face.' || f.kind, 'ok', f.status || ' $' || f.created_cost_usd::text, f.brand_id, null
    from public.brand_faces f where f.created_by = ${uid}::uuid
  union all
  select e.created_at, 'e' || e.id::text, 'email', 'email.' || e.kind::text,
         case when e.status = 'failed' then 'failed' else 'ok' end, e.status::text, e.brand_id, null
    from public.email_log e where e.user_id = ${uid}::uuid
)
select ${iso("ev.at")} as ts, ev.key as id, ev.src, ev.kind, ev.status, ev.info, b.name as brand_name, ev.link
  from ev
  left join public.brands b on b.id = ev.brand_id
 ${keyset}
 order by ev.at desc, ev.key desc
 limit ${PAGE_SIZE + 1}`;
  return { sql, params: p.values };
}

// A timeline cursor's id is the row key ("a12", "qd<uuid>"), not a number or uuid.
const KEY_RE = /^[a-z]{1,2}[0-9a-f-]{1,40}$/i;
function decodeCursorKey(raw: string | undefined) {
  return decodeCursor(raw, KEY_RE);
}

export interface UserDetail {
  profile: UserProfile;
  brands: { name: string; role: string }[];
  sessions: SessionRow[];
  aiByKind: { kind: string; n: number; usd: number }[];
  counts: UserCounts;
}

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const d = db();
  const profile = (await d.query<UserProfile>(USER_PROFILE_SQL, [id]))[0];
  if (!profile) return null;
  const [brands, sessions, aiByKind, counts] = await Promise.all([
    d.query<{ name: string; role: string }>(USER_BRANDS_SQL, [id]),
    d.query<SessionRow>(USER_SESSIONS_SQL, [id]),
    d.query<{ kind: string; n: number; usd: number }>(USER_AI_BY_KIND_SQL, [id]),
    d.query<UserCounts>(USER_COUNTS_SQL, [id]),
  ]);
  return { profile, brands, sessions, aiByKind, counts: counts[0] };
}

export async function getUserTimeline(id: string, cursor?: string): Promise<Page<TimelineRow>> {
  if (!UUID_RE.test(id)) return { rows: [], next: null };
  const { sql, params } = timelineSql(id, cursor);
  const rows = await db().query<TimelineRow>(sql, params);
  // Queue errors are shown cleaned and cut short (the raw text may carry provider details).
  const cleaned = rows.map((r) => ({ ...r, info: r.src === "queue" ? cleanQueueInfo(r.info) : r.info }));
  return paginate(cleaned);
}

function cleanQueueInfo(info: string): string {
  const i = info.indexOf(" | ");
  return i < 0 ? info : `${info.slice(0, i)} | ${cleanError(info.slice(i + 3))}`;
}
