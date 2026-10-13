# Architecture — PostMitra MVP

Owner: orchestrator (T-1). Spec: [6-prd.md](6-prd.md). Tasks: [8-build-plan.md](8-build-plan.md).

## Decisions (2026-10-12)

| # | Decision | Why |
|---|---|---|
| D1 | **Mock backend first.** `DATA_BACKEND=mock` runs the real Postgres schema on PGlite (Postgres in WASM, on disk under `.data/`), with stub phone OTP and local file storage. `DATA_BACKEND=supabase` swaps in Supabase later with no app code changes. | No Supabase project yet. Running the real schema and RLS locally means the mock enforces the same brand separation as production. |
| D2 | **LLM is Google Gemini** (`@google/genai`) **via Vertex AI** (project credentials by file path in `.env.local`), with JSON output against a schema. Default model `gemini-3.8-flash`, thinking level LOW; overridable in env. All calls go through `src/lib/ai/client.ts`, which logs tokens and estimated cost. | Owner's choice. The AI Studio key was blocked (403). |
| D3 | **Voice notes are transcribed by Gemini** (audio input), not a separate speech-to-text API. Browser records WAV (16 kHz mono); WhatsApp sends OGG. | One credential. Hindi voice note transcribed word-for-word in testing (2026-10-12). |
| D4 | **Mascot is a parametric SVG character** (Duolingo-style), not an AI image. Gemini picks the concept and its parameters; code draws every pose from one saved spec. | Owner's choice. Guarantees the same character in every pose (R15 AC), is transparent by nature, drops the image-model key. |
| D5 | **Images are SVG templates rendered to PNG by code** (`@resvg/resvg-js`) with Noto fonts. No text in any AI image. | R6, CLAUDE.md. Mascot SVG composes into the same templates. T-7 must first prove Devanagari shaping (conjuncts, matras) on the T-8 strings; fallback is `@napi-rs/canvas`. |
| D7 | **AI cost control:** tests always use fixtures (`AI_MODE=fixture` under vitest). Any live run estimated over $0.50 needs the owner's approval first. | Owner's rule. |
| D6 | WhatsApp, Vercel and background removal come later. Each sits behind an interface with a mock until then. | Accounts not ready. Web flow is complete without WhatsApp (PRD §8). |

## Overview

```
Phone browser ──► Next.js (App Router, TypeScript) on Vercel
                    ├─ pages: sign-in, brand setup, create, review, history, plan, mascot, summary
                    ├─ no-login pages: /a/[token] approval, /s/[token] summary, /r/[code] click redirect
                    └─ API routes ──► lib/
                                       ├─ db        PGlite (mock) | Supabase Postgres
                                       ├─ auth      stub OTP (mock) | Supabase phone OTP
                                       ├─ storage   local files (mock) | Supabase Storage
                                       ├─ ai        Gemini: captions, plan, guardrail, transcription, mascot concepts
                                       ├─ render    SVG templates + Noto fonts ──► PNG
                                       ├─ mascot    SVG rig
                                       └─ whatsapp  mock | Cloud API (week 3)
```

## Backends and the swap (D1)

All app code goes through four interfaces in `src/lib/`. Nothing outside these folders imports PGlite, Supabase or Gemini directly.

| Interface | Mock (now) | Real (later) |
|---|---|---|
| `db` | PGlite, persisted in `.data/pglite`, migrations from `supabase/migrations/` plus `supabase/mock/auth_stub.sql` applied on start | Supabase Postgres over the pooler (`postgres` driver) |
| `auth` | Any Indian mobile number; OTP is `123456`; session is a signed cookie (`AUTH_SECRET`) valid 30 days | Supabase phone OTP; session via `@supabase/ssr` cookies |
| `storage` | `.data/storage/{bucket}/{brand_id}/...`, served by an API route that checks brand membership | Supabase Storage, private buckets, signed URLs |
| `ai` | Gemini (Vertex) when credentials are set; fixture responses otherwise (tests always use fixtures) | Same |

**How queries run.** Both backends use plain SQL. Every request that acts for a signed-in user runs inside `withUser(userId, fn)`, which opens a transaction and does:

```sql
set local role authenticated;
select set_config('request.jwt.claim.sub', '<user id>', true);
```

This is what Supabase's API does, so RLS policies apply identically in mock and production. Server-only work (click logging, usage counting, no-login token routes, WhatsApp webhook) uses `withService(fn)` (role `service_role`, bypasses RLS) and must check the token or signature first.

## Data model

Migration: [supabase/migrations/0001_init.sql](../supabase/migrations/0001_init.sql). RLS test: [tests/db/rls.test.mjs](../tests/db/rls.test.mjs) (26 checks, all passing).

| Table | Holds | Req |
|---|---|---|
| `profiles` | One per user: phone, consent time, WhatsApp opt-in, last brand used | R1, R3, R12 |
| `brands` | Brand name, daily generation cap | R14 |
| `brand_members` | user ↔ brand, role `owner` or `editor` | R14 |
| `brand_memory` | One per brand: every R2 field, plus `notes` (other stated facts) and mascot eligibility | R2, R8, R15a |
| `weekly_plans`, `plan_ideas` | Plan per brand per week, owner's goal; 3-5 ideas with suggested day and occasion | R3 |
| `posts` | One input: type, text/transcript, media, cleaned photo, language, status, short-link code, mascot used | R4, R7, R11, R13 |
| `outputs` | One per channel per post: caption, CTA, hashtags, on-image text, template, rendered image, fact flags, original version | R4, R5, R6, R8, R9 |
| `approval_links`, `approvals`, `approval_comments` | No-login link (token hash only), status per post, comments | R10 |
| `clicks` | One row per short-link click (no IP stored) | R11 |
| `summary_shares` | No-login weekly summary link (token hash) | R11 |
| `mascots` | Concepts and the active mascot: SVG spec, exported sheet | R15 |
| `usage_events` | Each AI call, for the per-brand daily cap | §8 costs |

Rules built into the schema:
- **Language includes script:** `hi` = Hindi in Devanagari, `hinglish` = Hindi in Roman script, `en` = English.
- **Brand scoping:** every content row carries `brand_id`. Child rows reference their parent by `(id, brand_id)`, so a row can never point at another brand's data.
- **RLS:** members of a brand read and write its rows; only owners rename or delete a brand or manage members. A brand can only be created via `create_brand()`, which makes the caller its owner. `clicks` and `usage_events` are written by the server only. `anon` has no access to anything.
- **No-login links** store only a hash of the token. The server looks up the hash with the service role.
- **One active mascot per brand.** Posts keep the `mascot_id` they were made with, so regenerating a mascot leaves old posts unchanged (PRD §8).
- **WhatsApp tables** (inbound message log, idempotency) are added in a later migration with T-22.

Storage buckets, each path starting with `{brand_id}/`: `brand-assets` (logos), `inputs` (photos, voice notes), `renders` (PNGs), `mascots` (sheets). Supabase storage policies come in `0002_storage.sql` at integration time.

## AI (Gemini)

- All prompts live in `src/lib/ai/prompts/` and are owned by the orchestrator (T-4, T-12, T-17). Builders call them; they don't edit them.
- Every call asks for JSON against a schema (zod for checks in code) and is validated before use. Invalid output is retried once, then fails visibly.
- **Facts-only (R8):** the generator gets only the input and brand memory. A separate check pulls out every price, discount, date, time, phone number and claim from each output and compares it with the sources. Anything not found becomes an open `fact_flags` entry; download is blocked while any flag is open.
- Each call writes a `usage_events` row; calls stop when the brand reaches its daily cap.

## Images (D5)

- Templates are SVG with slots: photo, logo, brand colours, headline, subline, CTA, mascot pose, speech bubble. At least 3 per format: 1:1 (1080×1080) and 9:16 (1080×1920).
- Text is placed and wrapped by code with Noto Sans / Noto Sans Devanagari (bundled `.ttf` in `assets/fonts/`, open licence).
- Mascot poses are SVG groups inserted into the template, so text, mascot and photo render in one pass.

## Folder structure

```
Post/
├─ docs/                      PRD, build plan, this note
├─ supabase/
│  ├─ migrations/             SQL, applied in order (mock and Supabase)
│  └─ mock/auth_stub.sql      Supabase stand-ins for PGlite only
├─ assets/fonts/              Noto .ttf files
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/
│  │  ├─ (app)/               signed-in, mobile layout, brand switcher
│  │  │  ├─ setup/  create/  review/[postId]/  history/  plan/  mascot/  summary/
│  │  ├─ a/[token]/           approval page, no login (R10)
│  │  ├─ s/[token]/           shared summary, no login (R11)
│  │  ├─ r/[code]/            click redirect to WhatsApp (R11)
│  │  └─ api/                 route handlers
│  ├─ lib/
│  │  ├─ db/  auth/  storage/ backend interfaces and mock/real implementations
│  │  ├─ ai/                  Gemini client, prompts/ (orchestrator-owned), schemas
│  │  ├─ render/              SVG templates, text layout, PNG export
│  │  ├─ mascot/              SVG rig and poses
│  │  ├─ guardrail/           fact flags
│  │  ├─ calendar/            festival calendar loader
│  │  └─ whatsapp/
│  └─ components/
├─ test-data/                 test sets (helper)
├─ tests/                     unit and integration tests
└─ .data/                     mock database and files (git-ignored)
```

## Environment

See [.env.example](../.env.example). Missing keys select the mock: no Supabase keys → `DATA_BACKEND=mock`, no Gemini credentials → fixture AI responses.
