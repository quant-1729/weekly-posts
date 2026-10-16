import { db } from "../db";

export interface Overview {
  active_sessions: number;
  sign_ins_today: number;
  users: number;
  brands: number;
  spend_today: number;
  spend_7d: number;
  spend_30d: number;
  posts_made_7d: number;
  posts_published_7d: number;
  posts_failed_7d: number;
  research_runs_7d: number;
  errors_24h: number;
}

// "Today" is the UTC day. Counts only, no row content.
export const OVERVIEW_SQL = `
select
  (select count(*)::int from public.user_sessions
     where revoked_at is null and last_seen_at > now() - interval '15 minutes') as active_sessions,
  (select count(*)::int from public.user_sessions
     where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) as sign_ins_today,
  (select count(*)::int from public.profiles) as users,
  (select count(*)::int from public.brands) as brands,
  (select coalesce(sum(usd), 0)::float8 from public.usage_events
     where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) as spend_today,
  (select coalesce(sum(usd), 0)::float8 from public.usage_events where created_at >= now() - interval '7 days') as spend_7d,
  (select coalesce(sum(usd), 0)::float8 from public.usage_events where created_at >= now() - interval '30 days') as spend_30d,
  (select count(*)::int from public.posts where created_at >= now() - interval '7 days') as posts_made_7d,
  (select count(*)::int from public.queue_items
     where status = 'published' and done_at >= now() - interval '7 days') as posts_published_7d,
  ((select count(*)::int from public.queue_items where status = 'failed' and updated_at >= now() - interval '7 days')
   + (select count(*)::int from public.posts where status = 'failed' and updated_at >= now() - interval '7 days')) as posts_failed_7d,
  (select count(*)::int from public.research_runs where started_at >= now() - interval '7 days') as research_runs_7d,
  ((select count(*)::int from public.app_events where ok = false and at >= now() - interval '24 hours')
   + (select count(*)::int from public.usage_events where ok = false and created_at >= now() - interval '24 hours')) as errors_24h
`;

export async function getOverview(): Promise<Overview> {
  const rows = await db().query<Overview>(OVERVIEW_SQL);
  return rows[0];
}
