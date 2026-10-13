-- Stand-in for the parts of Supabase that 0001_init.sql depends on, so the
-- same migrations run on PGlite (DATA_BACKEND=mock). Never run on Supabase.
--
-- The app sets the signed-in user per transaction, exactly as PostgREST does:
--   set local role authenticated;
--   select set_config('request.jwt.claim.sub', '<user uuid>', true);

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

create table auth.users (
  id          uuid primary key default gen_random_uuid(),
  phone       text unique,
  email       text unique,
  created_at  timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants table privileges to these roles by default and relies on RLS.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
