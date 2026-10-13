-- History list (T-16, R13): posts are listed newest first, one page at a time,
-- with a keyset cursor on (created_at, id). This index serves both the ordering
-- and the "(created_at, id) < cursor" comparison within a brand without a sort.
-- No table or policy changes.
create index posts_brand_created_id_idx on public.posts (brand_id, created_at desc, id desc);
