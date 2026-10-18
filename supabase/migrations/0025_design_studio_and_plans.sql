-- Design Studio and weekly offer plans (owner request 2026-10-16).
--
-- post_briefs.studio: the owner's studio documents for a brief (one per picture size), the source of the stored
-- pictures for square, portrait and story sizes. Validated by the app (src/lib/studio/types.ts studioStateSchema).
--
-- post_plans: a week of posts asked for in one go ("Monday 10% off, Tuesday 20% off ..."). Each day becomes its own
-- brief (plan_id, plan_date) with its own offer; the plan holds the shared design and the posting settings.

alter table public.post_briefs add column if not exists studio jsonb;

create table public.post_plans (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands (id) on delete cascade,
  created_by  uuid,
  title       text not null default 'Weekly offers' check (char_length(title) between 1 and 80),
  -- [{ date, offer, on, note, photoId, time }], validated by the app
  days        jsonb not null default '[]'::jsonb,
  -- { channels, cta, time, delivery, blocks, photoId, language }
  settings    jsonb not null default '{}'::jsonb,
  -- the shared design (StudioState with per-day copies under "days")
  studio      jsonb,
  status      text not null default 'draft' check (status in ('draft', 'designed', 'scheduled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, brand_id)
);
create index post_plans_brand_idx on public.post_plans (brand_id, created_at desc);

alter table public.post_briefs add column if not exists plan_id uuid;
alter table public.post_briefs add column if not exists plan_date date;
alter table public.post_briefs
  add constraint post_briefs_plan_fk foreign key (plan_id, brand_id) references public.post_plans (id, brand_id) on delete set null (plan_id);
create index if not exists post_briefs_plan_idx on public.post_briefs (plan_id) where plan_id is not null;

alter table public.post_plans enable row level security;
create policy post_plans_all on public.post_plans for all to authenticated
  using (public.is_brand_member(brand_id)) with check (public.is_brand_member(brand_id));
revoke all on public.post_plans from anon;
