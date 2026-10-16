-- Owner-approved 2026-10-15 (docs/10-plan-research-and-brand-face.md, docs/12-research-repos-and-proposal.md):
-- Trend research ("Ideas", R-1..R-10) and Brand Face (F-1..F-10). Every table is brand-scoped with RLS.

-- ---------------------------------------------------------------------------------------------
-- Ideas: competitors, research runs, trend cards, post ideas, snapshots, post metrics
-- ---------------------------------------------------------------------------------------------

-- Competitors the owner names (R-1). Businesses, never private people. Up to 5 per brand (enforced in the app).
create table public.competitors (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brands (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 80),
  website           text check (char_length(website) <= 300),
  instagram_handle  text check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  youtube_handle    text check (char_length(youtube_handle) <= 100),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, brand_id)
);
create index competitors_brand_idx on public.competitors (brand_id);

-- One research run per brand per week (scheduled) or on "Research now" (R-7). Cost is recorded per run.
create table public.research_runs (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brands (id) on delete cascade,
  trigger        text not null check (trigger in ('weekly', 'manual')),
  status         text not null default 'running' check (status in ('running', 'done', 'failed', 'capped')),
  window_start   date not null,                       -- the date window is set in code, never by the model
  window_end     date not null,
  focus          text check (char_length(focus) <= 200), -- the owner's optional one-line focus
  queries        jsonb not null default '[]'::jsonb check (jsonb_typeof(queries) = 'array'),
  sources_count  integer not null default 0 check (sources_count >= 0),
  cost_usd       numeric(10, 4) not null default 0 check (cost_usd >= 0),
  error          text check (char_length(error) <= 500),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  unique (id, brand_id),
  check (window_start <= window_end)
);
create index research_runs_brand_idx on public.research_runs (brand_id, started_at desc);

-- Trend cards (R-5). Every card has at least one dated source; sources hold a link, title, site and date only
-- (no copied posts, no usernames of private people).
create table public.trend_cards (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null,
  run_id          uuid not null,
  foreign key (run_id, brand_id) references public.research_runs (id, brand_id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  summary         text not null check (char_length(summary) <= 600),
  why_it_matters  text not null check (char_length(why_it_matters) <= 400),
  kind            text not null default 'trend' check (kind in ('trend', 'competitor', 'seasonal')),
  sources         jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 12),
  score           numeric(5, 2) not null default 0,   -- recency + velocity + engagement + brand fit, computed in code
  velocity        numeric(7, 2),                      -- change vs last week's snapshot; null when there is no history
  confidence      text not null check (confidence in ('low', 'medium', 'high')),
  status          text not null default 'new' check (status in ('new', 'used', 'dismissed', 'expired')),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (id, brand_id)
);
create index trend_cards_brand_idx on public.trend_cards (brand_id, status, created_at desc);

-- Post ideas under a card (R-5, R-6). The description never holds prices, numbers or claims (stripped in code);
-- "Make this post" creates a brief from it (brief_id).
create table public.post_ideas (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null,
  card_id         uuid not null,
  foreign key (card_id, brand_id) references public.trend_cards (id, brand_id) on delete cascade,
  post_type       public.post_type not null,
  angle           text not null check (char_length(angle) between 1 and 120),
  description     text not null check (char_length(description) between 1 and 600),
  format          text check (format in ('single', 'carousel', 'story', 'reel')),
  flags           jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),
  status          text not null default 'new' check (status in ('new', 'used', 'dismissed', 'queued')),
  brief_id        uuid,
  foreign key (brief_id, brand_id) references public.post_briefs (id, brand_id) on delete set null (brief_id),
  created_at      timestamptz not null default now(),
  unique (id, brand_id)
);
create index post_ideas_card_idx on public.post_ideas (card_id);

-- Weekly snapshots of competitor Instagram counts (R-3) so "rising" is measured, not guessed.
-- Business Discovery returns public business/creator accounts only; counts only, no follower lists.
create table public.competitor_snapshots (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null,
  competitor_id    uuid not null,
  foreign key (competitor_id, brand_id) references public.competitors (id, brand_id) on delete cascade,
  taken_at         timestamptz not null default now(),
  followers        integer check (followers >= 0),
  media_count      integer check (media_count >= 0),
  recent           jsonb not null default '[]'::jsonb check (jsonb_typeof(recent) = 'array') -- [{permalink, posted_at, format, likes, comments}]
);
create index competitor_snapshots_idx on public.competitor_snapshots (competitor_id, taken_at desc);

-- Insights per published post (R-8), fetched at about 24 h, 72 h and 7 days.
create table public.post_metrics (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null,
  queue_item_id  uuid not null,
  foreign key (queue_item_id, brand_id) references public.queue_items (id, brand_id) on delete cascade,
  fetched_at     timestamptz not null default now(),
  age_hours      integer not null check (age_hours >= 0),
  reach          integer check (reach >= 0),
  impressions    integer check (impressions >= 0),
  likes          integer check (likes >= 0),
  comments       integer check (comments >= 0),
  saves          integer check (saves >= 0),
  shares         integer check (shares >= 0),
  views          integer check (views >= 0),
  unique (queue_item_id, age_hours)                  -- one row per post per bucket (24 h, 72 h, 168 h)
);
create index post_metrics_item_idx on public.post_metrics (queue_item_id, fetched_at desc);
create index post_metrics_brand_idx on public.post_metrics (brand_id, fetched_at desc);

-- The weekly Growth report (R-9): suggestions written from the numbers given, nothing else.
create table public.growth_reports (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands (id) on delete cascade,
  week_start    date not null,
  summary       jsonb not null check (jsonb_typeof(summary) = 'object'),   -- numbers by topic/type/theme/channel/hour
  suggestions   jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array'),
  created_at    timestamptz not null default now(),
  unique (brand_id, week_start)
);

-- The owner's optional research focus line and their weekly research switch.
alter table public.brand_memory add column research_focus text check (char_length(research_focus) <= 200);
alter table public.brand_memory add column research_on boolean not null default true;

-- ---------------------------------------------------------------------------------------------
-- Brand Face (F-1): the mascot becomes one kind of face
-- ---------------------------------------------------------------------------------------------

create table public.brand_faces (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brands (id) on delete cascade,
  kind              text not null check (kind in ('mascot', 'illustrated', 'owner_photo', 'photoreal')),
  name              text not null check (char_length(name) between 1 and 40),
  description       text check (char_length(description) <= 600),   -- the owner's description (never a real person's name)
  style             text check (char_length(style) <= 60),          -- flat, 3d_cartoon, line_art, photo ...
  status            text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  master_path       text check (char_length(master_path) <= 300),   -- the approved master image (storage path)
  sheet_path        text check (char_length(sheet_path) <= 300),    -- the approved character sheet
  provenance        jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'), -- model, version, prompt hash, C2PA/SynthID
  consent           jsonb check (consent is null or jsonb_typeof(consent) = 'object'),              -- owner_photo: {user_id, at, text_version, email_confirmed_at}
  never_say         text[] not null default '{}',
  post_types        public.post_type[],                               -- null = all types
  placement         jsonb not null default '{}'::jsonb check (jsonb_typeof(placement) = 'object'), -- side, size
  created_cost_usd  numeric(10, 4) not null default 0 check (created_cost_usd >= 0),
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, brand_id),
  -- the owner's own face needs a confirmed consent record before it can be approved
  check (kind <> 'owner_photo' or status = 'draft' or coalesce(consent ? 'email_confirmed_at', false))
);
create index brand_faces_brand_idx on public.brand_faces (brand_id);

create table public.brand_face_poses (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null,
  face_id       uuid not null,
  foreign key (face_id, brand_id) references public.brand_faces (id, brand_id) on delete cascade,
  pose          text not null check (pose in ('wave', 'talk', 'point', 'think', 'celebrate', 'present', 'idle')),
  storage_path  text not null check (char_length(storage_path) <= 300),  -- transparent PNG
  width         integer not null check (width > 0),
  height        integer not null check (height > 0),
  checks        jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'), -- vision check result
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (face_id, pose)
);

-- Only the server confirms the owner's consent (the emailed link is the proof): a signed-in member may save or clear a
-- consent request, but may never set or change consent.email_confirmed_at themselves.
create function public.brand_faces_guard_consent() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated'
     and (new.consent ->> 'email_confirmed_at') is not null
     and (new.consent ->> 'email_confirmed_at') is distinct from (case when tg_op = 'UPDATE' then old.consent ->> 'email_confirmed_at' end) then
    raise exception 'face consent can only be confirmed by email' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger brand_faces_guard_consent before insert or update on public.brand_faces
  for each row execute function public.brand_faces_guard_consent();
create trigger brand_faces_updated_at before update on public.brand_faces for each row execute function public.set_updated_at();

-- The brand's face in posts. mascot_in_posts stays for now (read by older code paths) and is kept in sync
-- by the app; face_in_posts + active_face_id are the new source of truth.
alter table public.brand_memory add column face_in_posts boolean not null default false;
alter table public.brand_memory add column active_face_id uuid references public.brand_faces (id) on delete set null;

-- Move today's mascot brands over: one approved Mascot face (Tween in brand colours) each.
insert into public.brand_faces (brand_id, kind, name, status)
  select m.brand_id, 'mascot', 'Tween', 'approved' from public.brand_memory m where m.mascot_in_posts;
update public.brand_memory m
   set face_in_posts = true,
       active_face_id = f.id
  from public.brand_faces f
 where f.brand_id = m.brand_id and f.kind = 'mascot' and m.mascot_in_posts;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------
alter table public.competitors          enable row level security;
alter table public.research_runs        enable row level security;
alter table public.trend_cards          enable row level security;
alter table public.post_ideas           enable row level security;
alter table public.competitor_snapshots enable row level security;
alter table public.post_metrics         enable row level security;
alter table public.growth_reports       enable row level security;
alter table public.brand_faces          enable row level security;
alter table public.brand_face_poses     enable row level security;

-- The owner manages competitors and uses ideas and faces; runs, snapshots, metrics and reports are written by the server.
create policy competitors_all on public.competitors for all to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy post_ideas_all on public.post_ideas for all to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy trend_cards_select on public.trend_cards for select to authenticated using (public.is_brand_member(brand_id));
create policy trend_cards_update on public.trend_cards for update to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy research_runs_select on public.research_runs for select to authenticated using (public.is_brand_member(brand_id));
create policy competitor_snapshots_select on public.competitor_snapshots for select to authenticated using (public.is_brand_member(brand_id));
create policy post_metrics_select on public.post_metrics for select to authenticated using (public.is_brand_member(brand_id));
create policy growth_reports_select on public.growth_reports for select to authenticated using (public.is_brand_member(brand_id));
create policy brand_faces_all on public.brand_faces for all to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy brand_face_poses_all on public.brand_face_poses for all to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));

revoke all on public.competitors, public.research_runs, public.trend_cards, public.post_ideas, public.competitor_snapshots,
              public.post_metrics, public.growth_reports, public.brand_faces, public.brand_face_poses from anon;

-- Usage kinds for cost tracking and caps.
alter type public.usage_kind add value if not exists 'research';       -- grounded search + synthesis, per run
alter type public.usage_kind add value if not exists 'growth_report';
alter type public.usage_kind add value if not exists 'face_create';    -- master options, sheet, poses, checks

-- Email: confirm the owner's own face (consent), like payment IDs.
alter type public.email_kind add value if not exists 'face_consent';
