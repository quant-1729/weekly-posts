-- C-25 follow-up: Meta's data-deletion and deauthorize callbacks name the person (their Meta /
-- Instagram user id), not the Page or account we publish to. Keep that id in its own column.
alter table public.channel_connections add column platform_user_id text check (char_length(platform_user_id) <= 64);
create index channel_connections_platform_user_idx on public.channel_connections (provider, platform_user_id) where platform_user_id is not null;
