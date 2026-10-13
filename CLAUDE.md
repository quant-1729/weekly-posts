# Weekly Posts (working name; was PostMitra)

Weekly brand-memory content assistant for small businesses worldwide: every week the owner gets an email with 3-5 ready, on-brand posts to approve, edit or skip through no-login links. Spec: `docs/6-prd-v2.md` (Req 1-26). Task list: `docs/8-build-plan-v2.md`. The v1 (India/WhatsApp) docs `docs/6-prd.md` and `docs/8-build-plan.md` are kept as history.

## Stack

Next.js (App Router, TypeScript) on Vercel; Supabase (auth by email magic link, Postgres with RLS, storage), with a local mock backend until Supabase is connected; Gemini via Vertex AI; Resend for email (mock outbox until a sending domain exists); Vercel Cron for weekly generation.

## How work is split

- The main session (Opus) is the orchestrator. It plans, owns the schema and AI prompts, and reviews.
- Delegate implementation of a task to the `builder` subagent (Sonnet), one task ID at a time.
- Delegate data files, test sets, test runs, docs and lint fixes to the `helper` subagent (Haiku).
- Run independent tasks in parallel only when they touch different files.
- After each builder task, the orchestrator checks the result against that requirement's acceptance criteria in the PRD before marking it done in `docs/8-build-plan-v2.md`.

## Rules

- AI images only as abstract backgrounds, never depicting the owner's products, premises or people. Never generate text inside AI images; render all text on images with code and Noto fonts.
- Posts may only state prices, offers, hours, claims and contact details found in brand memory; anything else is flagged "please check" (Req 11).
- Every table has row-level security; data is scoped by brand.
- Secrets live in `.env.local` only.
- Any AI run estimated over $0.50 needs the owner's approval first; tests use fixtures.
- Keep scope to the PRD (plus the owner-approved mascot extra); anything new goes to the orchestrator first.
