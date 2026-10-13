-- V-20 follow-ups (Req 22).

-- Single-use action links that are ours, not Supabase Auth's (account deletion).
-- Server-only: RLS on, no policies, so only the service role reads or writes it.
create table public.used_tokens (
  jti_hash    text primary key,
  purpose     text not null check (purpose in ('delete_account')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index used_tokens_expires_idx on public.used_tokens (expires_at);
alter table public.used_tokens enable row level security;
revoke all on public.used_tokens from anon, authenticated;

alter type public.email_kind add value if not exists 'account_delete';

-- Owners can see (and export) their own account emails that have no brand,
-- such as sign-in and delete-confirmation emails.
create policy email_log_select_own on public.email_log for select to authenticated using (user_id = auth.uid());
