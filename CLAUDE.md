# Weekly Posts (working name; was PostMitra)

Design and posting assistant for small businesses worldwide: **details first, then design**. The owner (with or without a website, Instagram or YouTube) fills a short brief (USPs, contact blocks, QR, dates), gets on-brand post designs drawn by code, and the posts are scheduled and published one at a time after approval. Spec: `docs/6-prd-v3.md`. Approved change list: `docs/9-changes-v3.md`. Approved next features (Ideas, Brand Face): `docs/10-plan-research-and-brand-face.md`, `docs/12-research-repos-and-proposal.md`. Task list: `docs/8-build-plan-v3.md`. Earlier specs (`docs/6-prd-v2.md`, `docs/6-prd.md`) and plans are kept as history; v3 wins where they differ.

## Stack

Next.js (App Router, TypeScript), desktop-first and responsive; Google Cloud: Gemini, Imagen and Veo on Vertex AI, Speech-to-Text, Text-to-Speech, Cloud Translation, BigQuery, Cloud Storage, Cloud Run + Cloud Scheduler (moving from Vercel); Supabase Postgres with row-level security and app-managed magic-link sign-in (local mock backend for development and tests); Resend for email (mock outbox until a sending domain exists); Meta and YouTube APIs for import and publishing.

## How work is split

- The main session (Opus) is the orchestrator. It plans, owns the schema (migrations), the shared domain types (`src/lib/usps/types.ts`, `src/lib/briefs/types.ts`) and the AI prompts, and reviews.
- Delegate implementation of a task to the `builder` subagent (Sonnet), one task ID at a time.
- Delegate data files, test sets, test runs, docs and lint fixes to the `helper` subagent (Haiku).
- Run independent tasks in parallel only when they touch different files.
- After each builder task, the orchestrator checks the result against the acceptance criteria in the PRD before marking it done in `docs/8-build-plan-v3.md`.

## Rules

- AI images only as abstract backgrounds, never depicting the owner's products, premises or people. One exception (owner decision 2026-10-15): a Brand Face (illustrated character or realistic AI person) generated once, approved by the owner, and reused as a fixed pose set; never a real or famous person (only the consenting owner, from their own photos), never shown as a professional, customer or in a testimonial or before/after, realistic faces always labelled "AI" and never for health/finance brands. Never generate text inside AI images; render all text, logos and QR codes with code and Noto (or shipped open-licence) fonts.
- Posts may only state prices, offers, dates, ratings, claims and contact details that come from the owner's brief or brand profile; anything else is flagged "please check".
- Payment IDs (e.g. UPI) are typed by the owner only, confirmed by email before use, and never sent to, written, edited or suggested by AI. A rendered payment QR must decode to exactly the confirmed ID.
- Nothing is published or delivered without the owner's approval (unless they turned on auto-approve for posts with no flags).
- Every table has row-level security; data is scoped by brand.
- Secrets live in `.env.local` only (Secret Manager in the cloud); publishing tokens are encrypted at rest.
- Any AI run estimated over $0.50 needs the owner's approval first (Imagen and Veo included); tests use fixtures.
- Keep scope to PRD v3 and the approved change list; anything new goes to the orchestrator first.
