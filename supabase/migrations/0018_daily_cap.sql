-- v3: a post made on /create uses about two AI calls (copy + fact check) and each saved edit one more,
-- so the v1 pilot default of 30 calls a day is too tight. The weekly USD cap (WEEKLY_USD_CAP) still
-- bounds spending. Brands still on the old default move to the new one; custom values are kept.
alter table public.brands alter column daily_generation_cap set default 60;
update public.brands set daily_generation_cap = 60 where daily_generation_cap = 30;
