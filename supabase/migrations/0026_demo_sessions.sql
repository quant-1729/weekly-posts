-- 0026: demo sessions (judges' one-click access, docs/15-demo-login.md).
-- A session started from the "Try the demo" page is marked demo = true. The app refuses destructive or
-- account-level actions in such a session (account delete, export, connections, payment QR, sign-out of other
-- devices, new Brand Face), and the admin dashboard can tell demo sessions apart. Nothing else changes.

alter table public.user_sessions
  add column if not exists demo boolean not null default false;

create index if not exists user_sessions_demo_idx on public.user_sessions (last_seen_at desc) where demo;
