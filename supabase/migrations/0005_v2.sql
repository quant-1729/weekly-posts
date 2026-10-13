-- v2: weekly brand-memory content assistant (docs/6-prd-v2.md, plan docs/8-build-plan-v2.md).
-- Additive: nothing from v1 is dropped. Every new table has RLS scoped by brand.
-- Server-only tables (email_log, post_actions from no-login links) are written
-- with the service role after a signature check, as in v1.

-- ---------------------------------------------------------------------------
-- Accounts: email sign-in (Req 1)
-- ---------------------------------------------------------------------------

alter table public.profiles alter column phone drop not null;
alter table public.profiles add column email text unique;
alter table public.profiles add constraint profiles_contact_present check (phone is not null or email is not null);

-- ---------------------------------------------------------------------------
-- Brand memory v2 (Req 2, 5, 12, 21, 24)
-- ---------------------------------------------------------------------------

create type public.goal_v2 as enum ('enquiries', 'footfall', 'awareness');
create type public.regulated_category as enum ('none', 'health', 'finance', 'alcohol', 'legal', 'other');
create type public.website_status as enum ('none', 'ok', 'partial', 'blocked', 'failed');

alter table public.brand_memory
  add column country             text check (country is null or country ~ '^[A-Z]{2}$'),      -- ISO 3166-1 alpha-2
  add column region              text,                                                        -- ISO 3166-2 code or name
  add column timezone            text not null default 'UTC',                                 -- IANA, e.g. Europe/London
  add column goal                public.goal_v2 not null default 'awareness',
  add column post_language       text not null default 'en' check (post_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'), -- BCP-47
  add column minutes_per_post    integer check (minutes_per_post is null or minutes_per_post between 1 and 600),
  add column website_url         text,
  add column website_status      public.website_status not null default 'none',
  add column website_read_at     timestamptz,
  add column voice_description   text,
  add column example_phrases     text[] not null default '{}',
  add column words_to_avoid      text[] not null default '{}',
  add column regulated           public.regulated_category,          -- null = detect from category; set = owner's choice
  add column schedule_weekday    smallint not null default 1 check (schedule_weekday between 1 and 7), -- ISO: 1 = Monday
  add column schedule_time       time not null default '08:00',      -- local time in `timezone`
  add column link_destination    text,                               -- where short links go (website, booking, WhatsApp)
  add column email_paused_until  date,
  add column email_unsubscribed_at timestamptz;

-- Facts, each with its source (Req 3, 5, 11). The only fact source for posts.
create type public.fact_kind as enum ('product', 'price', 'offer', 'hours', 'address', 'phone', 'email', 'differentiator', 'claim', 'other');
create type public.fact_source as enum ('website', 'setup', 'upload', 'owner');

create table public.brand_facts (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands (id) on delete cascade,
  kind          public.fact_kind not null,
  label         text,                                  -- e.g. product or service name
  value         text not null check (length(value) between 1 and 1000),
  source_type   public.fact_source not null,
  source_ref    text,                                  -- page URL, upload id or setup question key
  source_quote  text,                                  -- the words the fact came from
  active        boolean not null default true,         -- false = owner removed it (kept for audit)
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, brand_id)
);
create index brand_facts_brand_idx on public.brand_facts (brand_id) where active;

-- Photo library and past posts (Req 4, 5, 9, 15).
create type public.photo_kind as enum ('photo', 'past_post');

create table public.photos (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands (id) on delete cascade,
  kind            public.photo_kind not null default 'photo',
  storage_path    text,                                -- null for a past post pasted as text
  extracted_text  text,                                -- past post text (pasted or read from a screenshot)
  width           integer,
  height          integer,
  has_people      boolean,                             -- owner-declared; consent reminder (PRD §8)
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  unique (id, brand_id),
  check (storage_path is not null or extracted_text is not null)
);
create index photos_brand_idx on public.photos (brand_id, created_at desc);

-- Owner-added occasions (Req 7).
create table public.owner_dates (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands (id) on delete cascade,
  date        date not null,
  name        text not null check (length(name) between 1 and 120),
  yearly      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index owner_dates_brand_idx on public.owner_dates (brand_id, date);

-- Voice feedback from rewrite instructions (Req 15).
create table public.voice_feedback (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands (id) on delete cascade,
  post_id      uuid,
  instruction  text not null check (length(instruction) between 1 and 300),
  created_at   timestamptz not null default now()
);
create index voice_feedback_brand_idx on public.voice_feedback (brand_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Weekly batches and posts (Req 7-10, 14-18, 25)
-- ---------------------------------------------------------------------------

create type public.batch_status as enum ('generating', 'ready', 'failed');

create table public.weekly_batches (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brands (id) on delete cascade,
  week_start        date not null,                     -- Monday, in the brand's timezone
  status            public.batch_status not null default 'generating',
  trigger           text not null default 'cron' check (trigger in ('cron', 'button')),
  error             text,
  generated_at      timestamptz,
  email_sent_at     timestamptz,
  late              boolean not null default false,     -- email went out late after a failure (PRD §8)
  reminder_sent_at  timestamptz,                        -- Req 25: at most one per week
  usd               numeric(10, 6) not null default 0,  -- Req 23
  created_at        timestamptz not null default now(),
  unique (brand_id, week_start),
  unique (id, brand_id)
);

alter type public.post_status add value if not exists 'approved';
alter type public.post_status add value if not exists 'skipped';
alter type public.post_status add value if not exists 'posted';

create type public.post_channel as enum ('instagram', 'facebook', 'linkedin', 'gbp');

-- v2 posts carry their copy on the row; images live in post_images.
alter table public.posts alter column input_type drop not null;
alter table public.posts alter column language drop not null;
alter table public.posts
  add column batch_id       uuid,
  add column suggested_day  date,
  add column channel        public.post_channel,
  add column post_language  text,
  add column caption        text,
  add column cta            text,
  add column hashtags       text[] not null default '{}',
  add column image_text     jsonb not null default '{}'::jsonb,
  add column occasion       text,
  add column photo_id       uuid,
  add column fact_flags     jsonb not null default '[]'::jsonb check (jsonb_typeof(fact_flags) = 'array'),
  add column original       jsonb,
  add column edited_at      timestamptz,
  add column approved_at    timestamptz,
  add column skipped_at     timestamptz,
  add column posted_at      timestamptz,
  add constraint posts_batch_fk foreign key (batch_id, brand_id) references public.weekly_batches (id, brand_id) on delete cascade,
  add constraint posts_photo_fk foreign key (photo_id, brand_id) references public.photos (id, brand_id) on delete set null (photo_id);
create index posts_batch_idx on public.posts (batch_id);

create type public.image_format as enum ('square', 'vertical', 'landscape');

create table public.post_images (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null,
  brand_id     uuid not null,
  format       public.image_format not null,
  template_id  text not null,
  image_path   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (post_id, format),
  foreign key (post_id, brand_id) references public.posts (id, brand_id) on delete cascade
);
create index post_images_brand_idx on public.post_images (brand_id);

create type public.post_action as enum ('approve', 'skip', 'edit', 'rewrite', 'swap_photo', 'posted', 'share', 'download', 'undo');

create table public.post_actions (
  id          bigint generated always as identity primary key,
  post_id     uuid not null,
  brand_id    uuid not null,
  action      public.post_action not null,
  via         text not null check (via in ('email_link', 'dashboard')),
  detail      jsonb not null default '{}'::jsonb,
  user_id     uuid references auth.users (id) on delete set null,   -- null for no-login link actions
  created_at  timestamptz not null default now(),
  foreign key (post_id, brand_id) references public.posts (id, brand_id) on delete cascade
);
create index post_actions_post_idx on public.post_actions (post_id, created_at);

-- ---------------------------------------------------------------------------
-- Measurement (Req 20, 21) and email (Req 14, 24, 25)
-- ---------------------------------------------------------------------------

create type public.checkin_answer as enum ('none', 'few', 'many');

create table public.checkins (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands (id) on delete cascade,
  week_start  date not null,
  answer      public.checkin_answer not null,
  via         text not null check (via in ('email_link', 'dashboard')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (brand_id, week_start)
);

create type public.email_kind as enum ('magic_link', 'weekly', 'reminder', 'late_notice', 'paused_notice', 'missed_weeks');
create type public.email_status as enum ('queued', 'sent', 'failed');

create table public.email_log (
  id           bigint generated always as identity primary key,
  brand_id     uuid references public.brands (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete cascade,
  kind         public.email_kind not null,
  to_email     text not null,
  subject      text not null,
  provider_id  text,
  status       public.email_status not null default 'queued',
  error        text,
  created_at   timestamptz not null default now()
);
create index email_log_brand_idx on public.email_log (brand_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Cost (Req 23)
-- ---------------------------------------------------------------------------

alter table public.usage_events add column usd numeric(10, 6) not null default 0;
alter type public.usage_kind add value if not exists 'weekly_batch';
alter type public.usage_kind add value if not exists 'rewrite';
alter type public.usage_kind add value if not exists 'website_read';
alter type public.usage_kind add value if not exists 'upload_extract';
alter type public.usage_kind add value if not exists 'review_reply';
alter type public.usage_kind add value if not exists 'image';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger brand_facts_updated_at before update on public.brand_facts for each row execute function public.set_updated_at();
create trigger post_images_updated_at before update on public.post_images for each row execute function public.set_updated_at();
create trigger checkins_updated_at    before update on public.checkins    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.brand_facts    enable row level security;
alter table public.photos         enable row level security;
alter table public.owner_dates    enable row level security;
alter table public.voice_feedback enable row level security;
alter table public.weekly_batches enable row level security;
alter table public.post_images    enable row level security;
alter table public.post_actions   enable row level security;
alter table public.checkins       enable row level security;
alter table public.email_log      enable row level security;

create policy brand_facts_all    on public.brand_facts    for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy photos_all         on public.photos         for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy owner_dates_all    on public.owner_dates    for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy voice_feedback_all on public.voice_feedback for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy post_images_all    on public.post_images    for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy checkins_all       on public.checkins       for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));

-- Batches are created by the generation job (service role); members read them.
create policy weekly_batches_select on public.weekly_batches for select to authenticated using (public.is_brand_member(brand_id));
-- Members may log their own dashboard actions; link actions are written by the server.
create policy post_actions_select on public.post_actions for select to authenticated using (public.is_brand_member(brand_id));
create policy post_actions_insert on public.post_actions for insert to authenticated
  with check (public.is_brand_member(brand_id) and via = 'dashboard' and user_id = auth.uid());
-- Email log: members read their brand's; only the server writes.
create policy email_log_select on public.email_log for select to authenticated using (brand_id is not null and public.is_brand_member(brand_id));

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
