-- Fix-up: 0022 was extended with brand_faces.character after some databases had already applied it (local dev).
-- Adds the column only where it is missing; a no-op where 0022 already created it.
alter table public.brand_faces add column if not exists character text check (character in
  ('tween', 'parchi', 'nudge', 'chitthi', 'dhaaga', 'baton', 'nishaan', 'gaanth', 'dabba', 'disha', 'yaadu', 'mynu', 'tiko'));
