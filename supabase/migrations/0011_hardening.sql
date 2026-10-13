-- Hardening (docs/8-build-plan-v2.md §5).

-- H-3: real counters instead of JSON inside weekly_batches.error.
alter table public.weekly_batches
  add column attempts integer not null default 0 check (attempts >= 0),
  add column regens   integer not null default 0 check (regens >= 0),
  add column claimed_at timestamptz;

-- H-1: the pipeline's own repeat/avoid-word rewrites, kept apart from the owner's
-- "rewrite with an instruction" so they don't use up the owner's weekly rewrites.
alter type public.usage_kind add value if not exists 'auto_rewrite';
