-- Owner requests 2026-10-15: (1) a post can have several types (a main type + extras), (2) the admin dashboard on
-- Vercel monitors signed-in devices and the history of what users do. Every table is RLS-protected.

-- (1) Extra post types: the main type stays `post_type` (layout, default call to action); extras are context for the
-- copy. No duplicates of the main type (checked in the app); at most 7.
alter table public.post_briefs
  add column extra_post_types public.post_type[] not null default '{}' check (cardinality(extra_post_types) <= 7);

-- (2a) Sign-in sessions: one row per sign-in. The session cookie carries this id (`sid`); a revoked or missing row
-- signs the device out. IP is never stored, only a keyed hash; city/country come from an offline lookup.
create table public.user_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    text check (revoked_by in ('user', 'admin', 'system')),
  user_agent    text check (char_length(user_agent) <= 400),
  browser       text check (char_length(browser) <= 40),
  os            text check (char_length(os) <= 40),
  device_type   text not null default 'unknown' check (device_type in ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  country       text check (country ~ '^[A-Z]{2}$'),
  city          text check (char_length(city) <= 80),
  ip_hash       text check (char_length(ip_hash) <= 80)
);
create index user_sessions_user_idx on public.user_sessions (user_id, last_seen_at desc);
create index user_sessions_active_idx on public.user_sessions (last_seen_at desc) where revoked_at is null;

-- (2b) Activity log for the admin dashboard: what happened, when, for whom. Short codes and small details only;
-- never post text, captions, owner descriptions, payment IDs, tokens or email bodies.
create table public.app_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid references auth.users (id) on delete set null,
  brand_id    uuid references public.brands (id) on delete set null,
  session_id  uuid references public.user_sessions (id) on delete set null,
  kind        text not null check (kind ~ '^[a-z][a-z0-9_.]{1,59}$'),   -- e.g. auth.sign_in, brief.created, design.generated
  ok          boolean not null default true,
  detail      jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2000)
);
create index app_events_at_idx on public.app_events (at desc);
create index app_events_user_idx on public.app_events (user_id, at desc);
create index app_events_brand_idx on public.app_events (brand_id, at desc);
create index app_events_kind_idx on public.app_events (kind, at desc);

-- (2b') AI call details for the admin dashboard's Generations page: which model, and whether the call worked
-- (a failed call's partial cost is recorded with ok = false). Older rows keep model null and ok true.
alter table public.usage_events add column model text check (char_length(model) <= 80);
alter table public.usage_events add column ok boolean not null default true;

-- (2c) What admins did (sign a session out, etc.), kept for accountability.
create table public.admin_actions (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  admin_email  text not null check (char_length(admin_email) <= 254),
  action       text not null check (char_length(action) <= 60),
  target       text check (char_length(target) <= 120),
  detail       jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index admin_actions_at_idx on public.admin_actions (at desc);

alter table public.user_sessions enable row level security;
alter table public.app_events    enable row level security;
alter table public.admin_actions enable row level security;

-- A user may see their own sessions (a future "your devices" list); only the server writes them.
create policy user_sessions_select_own on public.user_sessions for select to authenticated using (user_id = auth.uid());
-- app_events and admin_actions are server-only (RLS on, no policies).
revoke all on public.user_sessions from anon;
revoke all on public.app_events, public.admin_actions from anon, authenticated;

-- (3) Brand characters (owner decision 2026-10-15): a mascot face names which kit character it uses (src/lib/characters).
-- Null = Tween (every mascot face made before this). Laltain is not offered.
alter table public.brand_faces add column character text check (character in
  ('tween', 'parchi', 'nudge', 'chitthi', 'dhaaga', 'baton', 'nishaan', 'gaanth', 'dabba', 'disha', 'yaadu', 'mynu', 'tiko'));
