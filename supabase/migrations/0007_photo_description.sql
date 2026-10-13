-- A short neutral description of each library photo (made once at upload, Req 4),
-- so the weekly batch can pick a fitting photo for each post (Req 9).
alter table public.photos add column description text;
