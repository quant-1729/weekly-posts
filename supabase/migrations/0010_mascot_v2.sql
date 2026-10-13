-- V-25 (owner-approved extra): the owner chooses whether weekly posts use their mascot.
-- Per post, posts.mascot_id (0001) records which mascot a post was drawn with; null = off.
alter table public.brand_memory add column mascot_in_posts boolean not null default false;
