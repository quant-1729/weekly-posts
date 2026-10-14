-- Instagram import (owner decision 2026-10-14): the owner gives their @handle (or we find it
-- on their website) and we read their recent public posts through Meta's Business Discovery,
-- with no login on their side. Captions become past posts (voice); images can be added as photos.

alter table public.photos
  add column source           text not null default 'upload' check (source in ('upload', 'instagram')),
  add column source_id        text,          -- Instagram media id, so a re-import never duplicates
  add column source_url       text,          -- permalink to the original post
  add column source_posted_at timestamptz;   -- when it was posted on Instagram

create unique index photos_source_unique
  on public.photos (brand_id, source, kind, source_id)
  where source_id is not null;

alter table public.brand_memory
  add column instagram_handle        text check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  add column instagram_handle_source text check (instagram_handle_source in ('owner', 'website')),
  add column instagram_status        text check (instagram_status in ('found', 'imported', 'not_business', 'not_found', 'unavailable', 'failed')),
  add column instagram_checked_at    timestamptz;

-- W-1: why the last website read was partial or failed (e.g. 'js_only_meta' when only the
-- title and description of a JavaScript-built site could be read), so setup and the Brand
-- page can explain it after a reload. Null when the read was fine.
alter table public.brand_memory add column website_read_reason text check (char_length(website_read_reason) <= 40);
