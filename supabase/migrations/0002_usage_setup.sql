-- Count brand-setup profile extraction (R2) against the daily AI cap.
alter type public.usage_kind add value if not exists 'setup';
