-- v3 phase 3 (PRD v3 §5.5, changes C-24 to C-28): the queue, one post per slot, delivery to the
-- owner, and auto-publishing through connected accounts.

-- Queue settings (C-24, S-1, S-4, S-6): one row per brand.
create table public.queue_settings (
  brand_id        uuid primary key references public.brands (id) on delete cascade,
  posts_per_week  smallint not null default 3 check (posts_per_week between 1 and 14),
  days            smallint[] not null default '{2,4,6}' check (cardinality(days) between 1 and 7 and days <@ '{1,2,3,4,5,6,7}'), -- ISO weekdays, 1 = Monday
  times           jsonb not null default '{}'::jsonb check (jsonb_typeof(times) = 'object'),        -- channel -> "HH:MM" (brand time zone)
  auto_approve    jsonb not null default '{}'::jsonb check (jsonb_typeof(auto_approve) = 'object'), -- channel -> true: publish posts with no open flags without the owner's tap
  deliver_email   boolean not null default true,     -- email the owner each post that can't be auto-published, at its slot
  paused          boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- Queue items (C-24, S-2, S-5): one per channel post. Carousel slides travel with their first post.
create table public.queue_items (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands (id) on delete cascade,
  post_id          uuid not null,
  channel          public.post_channel not null,
  slot_at          timestamptz not null,
  status           text not null default 'scheduled' check (status in
                     ('scheduled', 'publishing', 'published', 'delivered', 'missed', 'skipped', 'expired', 'failed')),
  mode             text not null check (mode in ('publish', 'deliver')),  -- auto-publish via a connection, or deliver to the owner
  attempts         smallint not null default 0 check (attempts >= 0),
  last_error       text check (char_length(last_error) <= 500),
  platform_post_id text check (char_length(platform_post_id) <= 120),
  permalink        text check (char_length(permalink) <= 500),
  done_at          timestamptz,                                         -- published / delivered / skipped / expired
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, brand_id),
  unique (post_id),
  foreign key (post_id, brand_id) references public.posts (id, brand_id) on delete cascade
);
create index queue_items_due_idx on public.queue_items (slot_at) where status = 'scheduled';
create index queue_items_brand_idx on public.queue_items (brand_id, slot_at);

-- Connected accounts (C-25). Public part: readable by brand members.
create table public.channel_connections (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brands (id) on delete cascade,
  provider       text not null check (provider in ('instagram', 'facebook')),
  account_id     text not null check (char_length(account_id) <= 64),     -- IG user id / Facebook Page id
  account_name   text check (char_length(account_name) <= 120),
  scopes         text[] not null default '{}',
  status         text not null default 'active' check (status in ('active', 'expired', 'revoked', 'error')),
  expires_at     timestamptz,                                              -- when the token stops working (60-day tokens)
  last_error     text check (char_length(last_error) <= 500),
  connected_by   uuid references auth.users (id),
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, brand_id),
  unique (brand_id, provider)
);

-- Tokens (C-25): encrypted with TOKEN_ENCRYPTION_KEY (AES-256-GCM) by the app; this table is
-- server-only (RLS on, no policies, no grants), like public.used_tokens.
create table public.channel_tokens (
  connection_id uuid primary key,
  brand_id      uuid not null,                       -- so account deletion is provable table by table
  foreign key (connection_id, brand_id) references public.channel_connections (id, brand_id) on delete cascade,
  ciphertext    text not null,
  iv            text not null,
  tag           text not null,
  key_version   smallint not null default 1,
  updated_at    timestamptz not null default now()
);

-- Meta data-deletion callbacks (C-25): a status page per request, as Meta requires. Holds only the
-- platform's account id and a confirmation code (no brand, no user); it must outlive the account it
-- was about. Rows older than 90 days may be purged.
create table public.deletion_requests (
  code         text primary key check (char_length(code) between 16 and 64),
  provider     text not null check (provider in ('instagram', 'facebook')),
  account_id   text not null,
  status       text not null default 'received' check (status in ('received', 'done')),
  created_at   timestamptz not null default now(),
  done_at      timestamptz
);

-- Row-level security.
alter table public.queue_settings      enable row level security;
alter table public.queue_items         enable row level security;
alter table public.channel_connections enable row level security;
alter table public.channel_tokens      enable row level security;
alter table public.deletion_requests   enable row level security;

create policy queue_settings_all on public.queue_settings for all to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy queue_items_all on public.queue_items for all to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
-- Members see their connections; only the server (service role) creates, updates or removes them.
create policy channel_connections_select on public.channel_connections for select to authenticated
  using (public.is_brand_member(brand_id));

revoke all on public.queue_settings, public.queue_items, public.channel_connections from anon;
revoke all on public.channel_tokens, public.deletion_requests from anon, authenticated;

-- Emails for posts delivered to the owner at their slot (C-27) and connection problems (C-25).
alter type public.email_kind add value if not exists 'post_delivery';
alter type public.email_kind add value if not exists 'connection_problem';
