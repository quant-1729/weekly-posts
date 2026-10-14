-- v3 phase 1 (PRD v3 §5.2, changes C-05, C-06, C-09, C-10, C-11): the "Details" layer.
-- USP library, contact set, post briefs, payment IDs for payment QR codes.
-- Every table: brand-scoped, row-level security on, composite (id, brand_id) keys so rows
-- can only point at rows of the same brand.

-- USP library (C-05) ---------------------------------------------------------------------

create type public.usp_kind as enum
  ('discount', 'price', 'quality', 'reviews', 'delivery', 'guarantee', 'experience', 'free_extra', 'custom');

create table public.usps (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands (id) on delete cascade,
  kind        public.usp_kind not null,
  title       text not null check (char_length(btrim(title)) between 1 and 60),  -- the short line a post shows
  details     jsonb not null default '{}'::jsonb,   -- fields per kind (amount, valid dates, rating, platform...), validated in code
  source      text not null default 'owner' check (source in ('owner', 'setup', 'website', 'instagram', 'youtube')),
  source_ref  text,                                 -- fact id or page/post URL it came from
  confirmed   boolean not null default false,       -- owner confirmed a claim that needs it (superlatives, ratings)
  active      boolean not null default true,
  sort        integer not null default 0,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, brand_id)
);
create index usps_brand_idx on public.usps (brand_id, active, sort);

-- Contact set (C-09) ---------------------------------------------------------------------

create table public.contact_points (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands (id) on delete cascade,
  kind        text not null check (kind in
                ('phone', 'whatsapp', 'website', 'email', 'address', 'hours', 'map', 'booking',
                 'instagram', 'youtube', 'facebook', 'custom_link')),
  value       text not null check (char_length(value) between 1 and 500),  -- normalised: E.164 phone, https URL, handle, address
  display     text check (char_length(display) <= 120),                    -- how a post shows it (local phone format, short address)
  details     jsonb not null default '{}'::jsonb,                          -- hours per day, full address, country...
  is_default  boolean not null default true,                               -- shown on new posts unless the owner turns it off
  verified_at timestamptz,                                                 -- e.g. the website answered
  source      text not null default 'owner' check (source in ('owner', 'setup', 'website', 'instagram', 'youtube')),
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, brand_id),
  unique (brand_id, kind, value)
);

-- Payment IDs for payment QR codes (C-10) -------------------------------------------------
-- Typed by the owner only; never written, edited or suggested by AI. A new or changed ID is
-- 'pending' until confirmed through an emailed link (service role), so a hijacked session
-- can't redirect payments. Signed-in users can never set status 'active' themselves.

create type public.payment_scheme as enum ('upi');   -- more schemes by country later

create table public.payment_ids (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references public.brands (id) on delete cascade,
  scheme             public.payment_scheme not null,
  address            text not null,
  payee_name         text not null check (char_length(btrim(payee_name)) between 1 and 60),
  status             text not null default 'pending' check (status in ('pending', 'active', 'retired')),
  confirm_token_hash text,
  confirm_expires_at timestamptz,
  confirmed_at       timestamptz,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  unique (id, brand_id),
  check (scheme <> 'upi' or address ~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9]{1,63}$'),
  check (status <> 'active' or confirmed_at is not null)
);
create unique index payment_ids_one_active on public.payment_ids (brand_id, scheme) where status = 'active';

-- Post briefs (C-06, C-11) ---------------------------------------------------------------

create type public.post_type as enum
  ('offer', 'new_product', 'event', 'announcement', 'occasion', 'testimonial', 'hiring', 'brand');
create type public.cta_kind as enum ('call', 'whatsapp', 'visit', 'book', 'order', 'website', 'scan');

create table public.post_briefs (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brands (id) on delete cascade,
  post_type         public.post_type not null,
  primary_usp_id    uuid,
  secondary_usp_ids uuid[] not null default '{}' check (cardinality(secondary_usp_ids) <= 2),
  usp_snapshot      jsonb not null default '[]'::jsonb,   -- the USPs exactly as used, so library edits don't change made posts
  cta               public.cta_kind,
  blocks            jsonb not null default '{}'::jsonb,   -- which blocks show: logo, phone, whatsapp, website, address, hours, dates, socials
  qr                jsonb,                                -- {kind:'link', target, url, short_code} | {kind:'payment', payment_id}
  photo_id          uuid,
  language          text,
  starts_on         date,
  ends_on           date,
  timezone          text,
  channels          public.post_channel[] not null default '{}',
  notes             text check (char_length(notes) <= 2000),   -- the owner's own words (typed or spoken), B-7
  status            text not null default 'draft' check (status in ('draft', 'ready')),
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, brand_id),
  check (starts_on is null or ends_on is null or starts_on <= ends_on),
  foreign key (primary_usp_id, brand_id) references public.usps (id, brand_id) on delete set null (primary_usp_id),
  foreign key (photo_id, brand_id) references public.photos (id, brand_id) on delete set null (photo_id)
);
create index post_briefs_brand_idx on public.post_briefs (brand_id, created_at desc);

alter table public.posts add column brief_id uuid;
alter table public.posts
  add constraint posts_brief_fk foreign key (brief_id, brand_id)
  references public.post_briefs (id, brand_id) on delete set null (brief_id);

-- Row-level security ----------------------------------------------------------------------

alter table public.usps           enable row level security;
alter table public.contact_points enable row level security;
alter table public.payment_ids    enable row level security;
alter table public.post_briefs    enable row level security;

create policy usps_all           on public.usps           for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy contact_points_all on public.contact_points for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
create policy post_briefs_all    on public.post_briefs    for all to authenticated using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));

-- Payment IDs: members can read; only the owner can add or retire one; nobody signed in can
-- activate one (the emailed confirmation runs as the service role).
create policy payment_ids_select on public.payment_ids for select to authenticated using (public.is_brand_member(brand_id));
create policy payment_ids_insert on public.payment_ids for insert to authenticated
  with check (public.is_brand_owner(brand_id) and status = 'pending' and confirmed_at is null);
create policy payment_ids_update on public.payment_ids for update to authenticated
  using (public.is_brand_owner(brand_id)) with check (public.is_brand_owner(brand_id) and status in ('pending', 'retired'));

revoke all on public.usps, public.contact_points, public.payment_ids, public.post_briefs from anon;

-- The emailed link that confirms a new or changed payment ID.
alter type public.email_kind add value if not exists 'payment_confirm';

-- Short-link visits that came from scanning a post's QR code (C-10, R-1), counted apart from link clicks.
alter table public.clicks add column source text not null default 'link' check (source in ('link', 'qr'));

-- When the USP library and contact set were first filled from the brand's facts, so that an owner
-- who later deletes them doesn't get them re-imported on the next visit.
alter table public.brand_memory add column details_seeded_at timestamptz;
