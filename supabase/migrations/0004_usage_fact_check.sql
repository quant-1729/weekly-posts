-- Count the facts-only guardrail's AI check (R8) against the daily AI cap.
alter type public.usage_kind add value if not exists 'fact_check';
