-- Sign-in links (Req 1) on the Supabase backend: the app sends its own magic links
-- (docs/architecture.md D8) and tracks them here. Server only: RLS on, no policies,
-- no grants to anon or authenticated (like public.used_tokens).

create table public.magic_links (
  jti         text primary key,
  email       text not null,
  ip          text,                       -- for the per-IP rate limit; null when unknown
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Rate limits count recent links per address and per IP.
create index magic_links_email_created on public.magic_links (lower(email), created_at desc);
create index magic_links_ip_created on public.magic_links (ip, created_at desc) where ip is not null;

alter table public.magic_links enable row level security;
revoke all on public.magic_links from anon, authenticated;

-- Finds an existing auth user by email when a link is opened. service_role cannot
-- read auth.users on Supabase, so this runs as the function owner.
create function public.auth_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) order by created_at limit 1;
$$;
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;
