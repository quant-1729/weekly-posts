-- v3 phase 2 (PRD v3 §5.3, changes C-13 to C-20): the "Design" layer.

-- New formats (G-5). Existing values stay: square 1080x1080, vertical 1080x1920 (stories/status),
-- landscape 1200x630 (link preview / LinkedIn / Google Business).
alter type public.image_format add value if not exists 'portrait';   -- 1080x1350 feed
alter type public.image_format add value if not exists 'thumbnail';  -- 1280x720 YouTube
alter type public.image_format add value if not exists 'banner';     -- 1920x600 website

-- Brand kit (C-13, G-1). Colours and logo keep their existing columns (brand_memory.colors,
-- logo_path); the kit adds fonts, style, default theme and where the kit came from.
-- Shape is validated in code (src/lib/design/types.ts BrandKit).
alter table public.brand_memory
  add column kit jsonb not null default '{}'::jsonb check (jsonb_typeof(kit) = 'object');

-- Posts made from a brief (C-14, C-16, C-20): which theme and layout drew them, the exact content
-- the engine laid out (so a re-render is identical), and carousel grouping.
alter table public.posts
  add column theme_id    text check (char_length(theme_id) <= 40),
  add column layout_id   text check (char_length(layout_id) <= 60),
  add column design      jsonb,
  add column carousel_id uuid,
  add column slide_index smallint check (slide_index between 0 and 9),
  add constraint posts_carousel_slide check ((carousel_id is null) = (slide_index is null));
create index posts_carousel_idx on public.posts (carousel_id, slide_index) where carousel_id is not null;

-- Imagen backgrounds (C-18): abstract textures, generated once per brand + theme + palette and reused.
create table public.backgrounds (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands (id) on delete cascade,
  theme_id     text not null check (char_length(theme_id) <= 40),
  palette_hash text not null check (char_length(palette_hash) <= 64),   -- colours the texture was made for
  variant      smallint not null default 0 check (variant between 0 and 9),
  storage_path text not null,                                            -- brand-assets/{brand_id}/backgrounds/...
  width        integer not null check (width > 0),
  height       integer not null check (height > 0),
  model        text not null,                                            -- e.g. the Imagen model id
  usd          numeric(10, 6) not null default 0 check (usd >= 0),
  created_at   timestamptz not null default now(),
  unique (id, brand_id),
  unique (brand_id, theme_id, palette_hash, variant)
);
alter table public.backgrounds enable row level security;
create policy backgrounds_all on public.backgrounds for all to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
revoke all on public.backgrounds from anon;

-- Cost logging for the new AI jobs (C-08, C-16, C-17). 'image' (v2) is reused for Imagen.
alter type public.usage_kind add value if not exists 'brief_from_text';
alter type public.usage_kind add value if not exists 'post_copy';
alter type public.usage_kind add value if not exists 'style_read';
