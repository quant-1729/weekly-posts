-- Owner request 2026-10-16: choose the content format up front: a single post, a carousel, or (later) a reel.
-- A carousel's slides are extra `posts` rows of each channel sharing `carousel_id` (as in C-20); this column says
-- the owner asked for one, and how many slides. 'reel' is reserved for the coming-soon animated format.
alter table public.post_briefs
  add column content_format text not null default 'post' check (content_format in ('post', 'carousel', 'reel')),
  add column slide_count smallint check (slide_count between 3 and 10),
  add constraint post_briefs_slides_for_carousel check (content_format = 'carousel' or slide_count is null);
