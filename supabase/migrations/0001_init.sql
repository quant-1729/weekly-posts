-- PostMitra initial schema (T-1).
-- Every table has row-level security. All brand data is scoped by brand_id and
-- readable only by members of that brand (R14).
--
-- Runs on Supabase Postgres, and locally on PGlite (mock backend) with a stub
-- `auth` schema (see supabase/mock/auth_stub.sql).
--
-- No-login routes (approval link R10, shared summary R11, click redirect R11,
-- WhatsApp webhook R12) never use anon policies. They run server-side with the
-- service role after checking a token, so anon has no access to any table.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Language also fixes the script: hi = Hindi in Devanagari, hinglish = Hindi in
-- Roman script, en = English (R2, R5).
create type public.content_language as enum ('hi', 'hinglish', 'en');
create type public.brand_role as enum ('owner', 'editor');
create type public.input_type as enum ('photo', 'text', 'voice');
create type public.post_source as enum ('web', 'whatsapp');
create type public.post_status as enum ('generating', 'draft', 'ready', 'failed');
create type public.channel as enum ('ig_feed', 'status', 'facebook', 'gbp');
create type public.plan_goal as enum ('footfall', 'enquiries', 'offer', 'awareness');
create type public.idea_status as enum ('suggested', 'used', 'skipped');
create type public.approval_status as enum ('pending', 'approved', 'changes_requested');
create type public.comment_author as enum ('approver', 'member');
create type public.mascot_status as enum ('concept', 'active', 'discarded', 'archived');
create type public.usage_kind as enum (
  'generate', 'regenerate', 'switch_language', 'plan', 'transcribe', 'mascot', 'photo_cleanup'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users and brands (R1, R14)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  phone               text not null unique,
  display_name        text,
  consent_at          timestamptz not null,          -- DPDP consent at sign-up
  whatsapp_opt_in_at  timestamptz,                   -- null = not opted in (R3 reminders, R12 weekly plan)
  last_brand_id       uuid,                          -- brand switcher remembers the last one (R14)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.brands (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(trim(name)) > 0),
  created_by            uuid not null references auth.users (id),
  daily_generation_cap  integer not null default 30 check (daily_generation_cap >= 0),  -- pilot cost cap
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_last_brand_fk foreign key (last_brand_id)
  references public.brands (id) on delete set null;

-- Many users per brand, many brands per user (R14).
create table public.brand_members (
  brand_id    uuid not null references public.brands (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.brand_role not null default 'editor',
  created_at  timestamptz not null default now(),
  primary key (brand_id, user_id)
);
create index brand_members_user_idx on public.brand_members (user_id);

-- Membership checks. SECURITY DEFINER so policies on brand_members can call
-- them without recursing into their own RLS.
create function public.is_brand_member(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.brand_members m
    where m.brand_id = b and m.user_id = auth.uid()
  );
$$;

create function public.is_brand_owner(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.brand_members m
    where m.brand_id = b and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Brand memory, one row per brand (R2). Every field is editable later.
create table public.brand_memory (
  brand_id            uuid primary key references public.brands (id) on delete cascade,
  business_name       text,
  category            text,
  city                text,
  -- [{ "name": "Veg thali", "price": "120", "unit": "plate", "note": "" }]
  products            jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array'),
  audience            text,
  tone                text,
  languages           public.content_language[] not null default '{hi,en}',
  default_language    public.content_language not null default 'hinglish',
  logo_path           text,                          -- storage: brand-assets/{brand_id}/...
  -- { "primary": "#E4572E", "secondary": "#FFF3E0", "accent": "#1B998B" }
  colors              jsonb not null default '{}'::jsonb check (jsonb_typeof(colors) = 'object'),
  whatsapp_number     text,
  -- Other facts the owner stated in setup (timings, address, standing offers).
  -- A fact source for the guardrail (R8).
  notes               text,
  setup_transcript    text,                          -- raw setup chat / voice transcript, for audit
  -- { "eligible": true, "reason": "...", "checked_at": "..." } (R15a)
  mascot_eligibility  jsonb,
  setup_completed_at  timestamptz,
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Weekly plan (R3)
-- ---------------------------------------------------------------------------

create table public.weekly_plans (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands (id) on delete cascade,
  week_start   date not null,                        -- Monday, IST
  goal         public.plan_goal not null default 'awareness',
  goal_detail  text,                                 -- owner's words, e.g. the offer; a fact source (R8)
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  unique (brand_id, week_start),
  unique (id, brand_id)
);

create table public.plan_ideas (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null,
  brand_id          uuid not null,
  title             text not null,
  description       text,
  suggested_day     date not null,
  occasion          text,                            -- festival/occasion key from the calendar, if any
  status            public.idea_status not null default 'suggested',
  reminder_sent_at  timestamptz,
  created_at        timestamptz not null default now(),
  unique (id, brand_id),
  foreign key (plan_id, brand_id) references public.weekly_plans (id, brand_id) on delete cascade
);
create index plan_ideas_plan_idx on public.plan_ideas (plan_id);
create index plan_ideas_day_idx on public.plan_ideas (suggested_day) where reminder_sent_at is null;

-- ---------------------------------------------------------------------------
-- Mascot (R15). The mascot is a parametric SVG character: `spec` holds the
-- rig parameters, so every pose is drawn from the same spec in code and the
-- character never drifts between posts.
-- ---------------------------------------------------------------------------

create table public.mascots (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands (id) on delete cascade,
  status      public.mascot_status not null default 'concept',
  name        text not null,
  concept     jsonb not null default '{}'::jsonb,    -- name, personality, why it fits
  spec        jsonb not null default '{}'::jsonb,    -- SVG rig parameters
  sheet_path  text,                                  -- exported character sheet (owner keeps it, R15f)
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, brand_id)
);
-- At most one active mascot per brand.
create unique index mascots_one_active on public.mascots (brand_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Posts and outputs (R4, R5, R6, R8, R13)
-- ---------------------------------------------------------------------------

create table public.posts (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brands (id) on delete cascade,
  created_by          uuid references auth.users (id),
  source              public.post_source not null default 'web',
  input_type          public.input_type not null,
  input_text          text,                          -- typed text, or voice transcript
  input_media_path    text,                          -- original photo or audio
  photo_path          text,                          -- cleaned photo used in templates (R7)
  language            public.content_language not null,
  status              public.post_status not null default 'generating',
  post_code           text not null unique check (post_code ~ '^[a-z0-9]{6,10}$'),  -- short link code (R11)
  plan_idea_id        uuid,
  mascot_id           uuid,                          -- null = mascot off for this post (R15e)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, brand_id),
  foreign key (plan_idea_id, brand_id) references public.plan_ideas (id, brand_id) on delete set null (plan_idea_id),
  foreign key (mascot_id, brand_id) references public.mascots (id, brand_id) on delete set null (mascot_id)
);
create index posts_brand_created_idx on public.posts (brand_id, created_at desc);
create index posts_brand_language_idx on public.posts (brand_id, language);

create table public.outputs (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null,
  brand_id     uuid not null,
  channel      public.channel not null,
  language     public.content_language not null,
  caption      text not null default '',
  cta          text,
  hashtags     text[] not null default '{}',
  -- Text drawn on the image by code (R6): { "headline": "", "subline": "", "bubble": "" }
  image_text   jsonb not null default '{}'::jsonb,
  template_id  text,                                 -- null for text-only channels (gbp)
  image_path   text,                                 -- last rendered PNG
  -- R8 flags: [{ "id": "", "text": "Rs 99", "kind": "price|discount|date|time|phone|claim",
  --              "regulated": false, "status": "open|confirmed|removed" }]
  fact_flags   jsonb not null default '[]'::jsonb check (jsonb_typeof(fact_flags) = 'array'),
  original     jsonb,                                -- first generated version, to measure edits
  edited_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (post_id, channel),
  foreign key (post_id, brand_id) references public.posts (id, brand_id) on delete cascade
);
create index outputs_brand_idx on public.outputs (brand_id);

-- ---------------------------------------------------------------------------
-- Approval links (R10). One no-login link can cover several posts; each post
-- gets its own status. Only a hash of the token is stored.
-- ---------------------------------------------------------------------------

create table public.approval_links (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brands (id) on delete cascade,
  token_hash     text not null unique,
  approver_name  text,
  created_by     uuid references auth.users (id),
  expires_at     timestamptz not null default now() + interval '30 days',
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (id, brand_id)
);

create table public.approvals (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null,
  post_id     uuid not null,
  brand_id    uuid not null,
  status      public.approval_status not null default 'pending',
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (link_id, post_id),
  unique (id, brand_id),
  foreign key (link_id, brand_id) references public.approval_links (id, brand_id) on delete cascade,
  foreign key (post_id, brand_id) references public.posts (id, brand_id) on delete cascade
);
create index approvals_post_idx on public.approvals (post_id);

create table public.approval_comments (
  id           uuid primary key default gen_random_uuid(),
  approval_id  uuid not null,
  brand_id     uuid not null,
  author       public.comment_author not null,
  author_name  text,
  body         text not null check (length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  foreign key (approval_id, brand_id) references public.approvals (id, brand_id) on delete cascade
);
create index approval_comments_approval_idx on public.approval_comments (approval_id);

-- ---------------------------------------------------------------------------
-- Clicks and summary (R11). Clicks are written only by the server redirect.
-- ---------------------------------------------------------------------------

create table public.clicks (
  id          bigint generated always as identity primary key,
  post_id     uuid not null,
  brand_id    uuid not null,
  clicked_at  timestamptz not null default now(),
  user_agent  text,                                  -- for bot filtering; no IP stored
  foreign key (post_id, brand_id) references public.posts (id, brand_id) on delete cascade
);
create index clicks_post_idx on public.clicks (post_id, clicked_at);
create index clicks_brand_idx on public.clicks (brand_id, clicked_at);

create table public.summary_shares (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands (id) on delete cascade,
  token_hash  text not null unique,
  week_start  date not null,
  created_by  uuid references auth.users (id),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Usage, for the per-brand daily generation cap. Written by the server only.
-- ---------------------------------------------------------------------------

create table public.usage_events (
  id          bigint generated always as identity primary key,
  brand_id    uuid not null references public.brands (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  kind        public.usage_kind not null,
  created_at  timestamptz not null default now()
);
create index usage_events_brand_day_idx on public.usage_events (brand_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger profiles_updated_at     before update on public.profiles     for each row execute function public.set_updated_at();
create trigger brands_updated_at       before update on public.brands       for each row execute function public.set_updated_at();
create trigger brand_memory_updated_at before update on public.brand_memory for each row execute function public.set_updated_at();
create trigger mascots_updated_at      before update on public.mascots      for each row execute function public.set_updated_at();
create trigger posts_updated_at        before update on public.posts        for each row execute function public.set_updated_at();
create trigger outputs_updated_at      before update on public.outputs      for each row execute function public.set_updated_at();
create trigger approvals_updated_at    before update on public.approvals    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Create a brand: inserts the brand, makes the caller its owner, creates an
-- empty brand memory row. The only way to create a brand.
-- ---------------------------------------------------------------------------

create function public.create_brand(brand_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.brands (name, created_by) values (brand_name, uid) returning id into new_id;
  insert into public.brand_members (brand_id, user_id, role) values (new_id, uid, 'owner');
  insert into public.brand_memory (brand_id, business_name) values (new_id, brand_name);
  return new_id;
end;
$$;

revoke all on function public.create_brand(text) from public, anon;
grant execute on function public.create_brand(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.brands            enable row level security;
alter table public.brand_members     enable row level security;
alter table public.brand_memory      enable row level security;
alter table public.weekly_plans      enable row level security;
alter table public.plan_ideas        enable row level security;
alter table public.mascots           enable row level security;
alter table public.posts             enable row level security;
alter table public.outputs           enable row level security;
alter table public.approval_links    enable row level security;
alter table public.approvals         enable row level security;
alter table public.approval_comments enable row level security;
alter table public.clicks            enable row level security;
alter table public.summary_shares    enable row level security;
alter table public.usage_events      enable row level security;

-- profiles: own row only.
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and (last_brand_id is null or public.is_brand_member(last_brand_id)));

-- brands: members read; owners rename and delete; insert only via create_brand().
create policy brands_select on public.brands for select to authenticated using (public.is_brand_member(id));
create policy brands_update on public.brands for update to authenticated
  using (public.is_brand_owner(id)) with check (public.is_brand_owner(id));
create policy brands_delete on public.brands for delete to authenticated using (public.is_brand_owner(id));

-- brand_members: members see the member list; owners manage it.
create policy brand_members_select on public.brand_members for select to authenticated using (public.is_brand_member(brand_id));
create policy brand_members_insert on public.brand_members for insert to authenticated with check (public.is_brand_owner(brand_id));
create policy brand_members_update on public.brand_members for update to authenticated
  using (public.is_brand_owner(brand_id)) with check (public.is_brand_owner(brand_id));
create policy brand_members_delete on public.brand_members for delete to authenticated using (public.is_brand_owner(brand_id));

-- Brand-scoped content: any member can read and write. One policy per table.
create policy brand_memory_all      on public.brand_memory      for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy weekly_plans_all      on public.weekly_plans      for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy plan_ideas_all        on public.plan_ideas        for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy mascots_all           on public.mascots           for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy posts_all             on public.posts             for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy outputs_all           on public.outputs           for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy approval_links_all    on public.approval_links    for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy approvals_all         on public.approvals         for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy approval_comments_all on public.approval_comments for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy summary_shares_all    on public.summary_shares    for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));

-- Server-written tables: members read; only the service role writes.
create policy clicks_select       on public.clicks       for select to authenticated using (public.is_brand_member(brand_id));
create policy usage_events_select on public.usage_events for select to authenticated using (public.is_brand_member(brand_id));

-- anon gets nothing. No-login routes go through the server with the service role.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
