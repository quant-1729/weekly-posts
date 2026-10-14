-- v3 phase 2 follow-ups to the post brief (C-07).

-- WhatsApp (status/messages) and YouTube (thumbnails, community, Shorts) as brief channels.
alter type public.post_channel add value if not exists 'whatsapp';
alter type public.post_channel add value if not exists 'youtube';

-- PRD v3 §6: "Discount with no end date → ask once; allow 'no end date' explicitly".
-- True when the owner chose that an offer runs with no end date (then ends_on stays null).
alter table public.post_briefs add column open_ended boolean not null default false;
alter table public.post_briefs add constraint post_briefs_open_ended_no_end check (not open_ended or ends_on is null);
