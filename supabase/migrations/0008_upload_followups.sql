-- V-5 follow-ups: keep model outputs that must survive restarts and serverless instances.
alter table public.photos add column usable boolean;                          -- false = dark/blurry warning (Req 4)
alter table public.brand_memory add column avoid_suggestions text[] not null default '{}'; -- from voice refresh, for the owner to accept
alter table public.brand_memory add column voice_edited_at timestamptz;        -- owner edited the voice; refresh must not overwrite it
