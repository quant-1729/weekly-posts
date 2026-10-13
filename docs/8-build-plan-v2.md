# Build plan v2

Status: **approved 2026-10-13** with the owner's decisions in §4. Build window: 4 weeks.

Turns the revised PRD ([6-prd-v2.md](6-prd-v2.md), Req 1-26) into tasks. The old plan ([8-build-plan.md](8-build-plan.md)) and PRD ([6-prd.md](6-prd.md)) stay as the record of v1.

**Product:** a weekly email of 3-5 ready, on-brand posts that an SMB owner approves in about two minutes. It is global, English by default (post language is a setting), and email-first, with the dashboard secondary. There is no WhatsApp delivery and no auto-posting.
**Infrastructure stays as built** (owner's instruction): Next.js, the mock backend that swaps to Supabase later, Vercel, Gemini via Vertex, and the `.env.local` setup. This overrides PRD §9 "separate projects".

## 1. What happens to the existing code

| Area | Built (v1) | v2 |
|---|---|---|
| Mock backend: PGlite with real schema and RLS, local storage, sessions | T-1, T-2 | **Keep** |
| Gemini client: Vertex, timeouts, retries, cost estimate, fixture mode | T-4 and later | **Keep**. Add per-account $ logging (Req 23) |
| Image renderer: HarfBuzz text, resvg, 6 templates, brand colours, logo | T-7 | **Keep.** Add a **landscape** format (Req 10) |
| Usage events and daily cap | T-3 | **Keep**, and extend to weekly caps with $ (Req 23) |
| Deterministic checks and the AI fact-check prompt (30/30 caught) | T-4, T-12 | **Keep the design.** Re-point sources to brand-memory facts. Add the repetition and words-to-avoid checks (Req 11-13) |
| History page | T-16 | **Keep** as the dashboard history |
| Sign-in by phone code | T-2 | **Change** to an email magic link (Req 1); session logic stays |
| Setup wizard (5 questions, voice, tap choices) | T-3 | **Change** to the v2 questions (Req 2); voice is removed |
| Brand memory table (flat fields) | T-1, T-3 | **Change:** facts each with a source, voice, example phrases, words to avoid, photo library (Req 5) |
| Generate pipeline (one input → 4 channel versions) | T-5 | **Change** to a weekly batch: 3-5 posts in one call, each with a suggested channel and images in 3 formats (Req 7-10) |
| Prompts (India and Hindi rules, ₹) | T-4 | **Change** to global: post language and currency come from settings. Keep the Hindi rules as one language option |
| Review page | T-5, T-6 | **Change** into the dashboard's "this week" view, plus no-login approve, edit and skip pages (Req 14-16) |
| India festival calendar (74 entries, verified) | T-9 | **Keep** as an extra source for India. The main source becomes a country and region holiday dataset plus owner dates (Req 7) |
| Weekly plan prompt | T-10 (prompt only) | **Merge** into the weekly batch prompt |
| Language switch per post | T-6 | **Remove from the UI.** Language is a brand setting; keep the backend function |
| Brand switcher (several brands per user) | T-16 | **Remove from the UI:** one business per account. The data model can stay |
| Voice recorder and transcription | T-3, T-5 | **Remove from the UI** (not in v2). Keep the code dormant |
| Mascot (old R15): partial module from the stopped task | T-17, T-18a | **Keep and finish** (owner decision): an extra beyond the v2 PRD, adapted to a global audience (task V-25) |
| WhatsApp layer, helper approval links, background removal | not built | **Drop** (out of v2 scope) |

Dev data in `.data/` is test data only and is reset when the v2 schema lands.

## 2. Tasks

Owners: **O** = orchestrator (Opus), **B** = builder (Sonnet), **H** = helper (Haiku). A task is done only when the PRD acceptance criterion (AC) passes and the orchestrator has checked it.

### Week 1 — Sign-up, setup, website reading, uploads, brand memory (Req 1-6)

| ID | Task | Req | Owner | Done when |
|---|---|---|---|---|
| V-1 | Schema v2 migration (see §3) plus prompts for website facts, voice from past posts, and screenshot text | 1-6 | O | Migration applies; RLS tests pass — **Done 2026-10-13** (0005/0006; 40 RLS checks; website facts live 22/22 and 23/23; voice phrases verbatim) |
| V-2 | Email magic-link sign-in. Mock: the link is shown in dev and logged to the outbox | 1 | B | AC 1 — **Done 2026-10-13** (link to setup 1.3 s warm; follow-up: Continue-button step against mail scanners, in V-3) |
| V-3 | Setup v2: name, what they sell, customers, country/region/city plus timezone, goal, tone (3 options + "like my past posts"), post language, minutes per post, website URL | 2, 6 | B | AC 2/6 (under 5 min, no website) — **Done 2026-10-13** (10 screens, about 3 min for a person; website read in background; magic link GET/POST with CSRF) |
| V-4 | Website reader: up to 5 pages, robots.txt, SSRF-safe fetch, size and time limits, fact extraction with sources | 3, 6 | B | AC 3 (80% of facts on test sites; disallow respected) — **Done 2026-10-13** (live end to end: 22/22, 23/23, robots-blocked site read nothing) |
| V-5 | Uploads: 3-5 past posts (screenshot or text) and photos. Screenshot text and voice examples extracted by Gemini | 4 | B | Photos in storage; example phrases extracted — **Done 2026-10-13** (EXIF/GPS stripped; verbatim phrases; follow-ups wired in V-6 via 0008) |
| V-6 | Brand memory page: every fact with its source, plus voice, phrases, words to avoid, colours/logo and photos; all editable | 5 | B | AC 4/5 — **Done 2026-10-13** (sources with page links and quotes; edits persist; 3-tab nav; small follow-ups in progress) |
| V-7 | Test data v2: 3 static test websites (one blocked by robots.txt), 8 global sample brands (US, UK, AU, CA, IN, AE, SG, ZA), a past-posts set | 3-6 | H | Files in `/test-data` — **Done 2026-10-13** |

### Week 2 — Weekly generation, images, guardrails (Req 7-13)

| ID | Task | Req | Owner | Done when |
|---|---|---|---|---|
| V-8 | Prompts: weekly batch (3-5 posts with channel, CTA by goal, 3-8 hashtags, voice from examples), rewrite-with-instruction, regulated v2 (adds alcohol and legal, plus "check local rules") | 7, 8, 12, 15 | O | 10-brand live dry run — **Done 2026-10-13** (4 brands/16 posts live: 0 invented numbers, NEVER-USE claims avoided; rewrite 3.5-3.8 s, refuses missing facts) |
| V-9 | Occasions: bundled country/region holiday dataset plus owner-added dates plus sensitive-day marks; India calendar as an extra | 7 | B | Correct holidays for test countries — **Done 2026-10-13** (US, GB, SG, IN, AU, AE checked; DST-safe week starts) |
| V-10 | Weekly generation job: one call for 3-5 posts. Hourly cron sweep runs brands whose local time has come (timezone). "Generate now" button as the fallback. Retry once; late notice on failure | 7 | B | AC 7 (3 time zones) — **Done 2026-10-13** (AC 7 London/New York/Kolkata incl. DST; live demo: website URL to 4 checked posts + 12 images in 60 s, $0.03) |
| V-11 | Images: landscape format (1200×630) added; every post rendered in 3 formats; text-only templates when there are no photos. AI backgrounds are not used in the MVP (code-drawn only) | 9, 10 | B | AC 8/10, AC 9 — **Done 2026-10-13** (12 templates; story safe zones; Arabic RTL incl. brackets, phones, numbers) |
| V-12 | Guardrail v2: sources are brand-memory facts; "please check" flags; regulated reminder; 6+ word repetition check over 4 weeks; words to avoid | 11-13 | B | AC 11 (30-post set), AC 12, AC 13 — **Done 2026-10-13** (live: AC 11 27/27, AC 12 12/12, AC 13 20/20; 3 cautious false positives) |
| V-13 | Test sets v2: 30-post planted-fact set (global, several currencies), 20 regulated posts, repetition cases | 11-13 | H | Files in `/test-data` — **Done 2026-10-13** |

### Week 3 — Weekly email, approval, sharing, reminders (Req 14-18, 24, 25)

| ID | Task | Req | Owner | Done when |
|---|---|---|---|---|
| V-14 | Signed link design: per post and action, HMAC, 14-day expiry, actions logged. Email copy | 14, 24 | O | Design note — **Done 2026-10-13** (`docs/email-links.md`; links never act on GET) |
| V-15 | Email service: Resend or other (decision needed) plus a mock outbox with a dev preview. Weekly email HTML (Gmail/Outlook-safe, plain-text fallback), unsubscribe, pause, List-Unsubscribe | 14, 24 | B | AC 14 — **Done 2026-10-13** (links work 14 days, never act on GET; HTML lint; missed-week variants; real-client check pending a sending domain: docs/email-checklist.md) |
| V-16 | No-login approve, edit and skip. Edit covers caption change, photo swap and rewrite with instruction (feedback saved to brand memory). "Ready to share" page | 14-16 | B | AC 14, AC 15 (under 15 s) — **Done 2026-10-13** (email + dashboard share one set of ops; flags gate approval; live AC 15 timing in final review) |
| V-17 | Share: Web Share API with image and caption on mobile, download and copy on desktop, "Mark as posted". One reminder after 3 days | 17, 18, 25 | B | AC 17, AC 25 — **Done 2026-10-13** (share/download/copy/mark posted; reminder exactly once at 72 h; real-phone share sheet on the manual checklist; browser check of ready-page script in V-24) |

### Week 4 — Measurement, data, cost, stretch, pilot (Req 19-23, 26)

| ID | Task | Req | Owner | Done when |
|---|---|---|---|---|
| V-18 | Short links `/r/[code]` to the owner's chosen destination, with click log | 19 | B | AC 19 (300 ms or less) — **Done 2026-10-13** (handler p95 3.4 ms; bots/prefetch/HEAD not counted; UTM tags; card fallback) |
| V-19 | One-tap check-in (email and dashboard) and summary: month-on-month posts shared, clicks, check-ins, time saved, plus the "not measured" line | 20, 21 | B | AC 20/21 — **Done 2026-10-13** (brand-timezone months; "at least N clicks"; summary line in email; Results tab) |
| V-20 | Export (ZIP: JSON plus photos) and delete account (rows plus storage) | 22 | B | AC 22 — **Done 2026-10-13** (0 rows/0 files after delete, schema-driven test; streaming ZIP; follow-up 0009) |
| V-21 | Cost per account per week in $, caps on weekly batches, rewrites and images | 23 | B | AC 23 (under $0.50 a week) — **Done 2026-10-13** (heavy week simulated at $0.17; all caps maxed $0.29; batch reserve; /dev/costs) |
| V-22 | *(Stretch)* Review replies in the owner's voice, copy-paste | 26 | B | AC 26 — **Done 2026-10-13** (live 1.7-4.9 s; facts checked; needs-attention alert; nothing stored) |
| V-23 | Run all test sets; email client checklist; demo script draft | All | H | Report |
| V-24 | Final review against every AC; demo: website URL to a week of posts in under 3 minutes | All | O | All AC pass or listed as known gaps |
| V-25 | *(Extra, owner decision)* Mascot: finish the rig, concepts and sheet; place it in weekly posts; on/off per post. Global names and blocklist | old R15 | B | old R15 AC, adapted — **Done 2026-10-13** (20/20 eligibility; 17 blocked hints, no AI call; same character in 8 poses, checked by eye; bubble fact-checked) |

**2-week fallback** (PRD §10): generation from the "Generate now" button instead of cron. Short links, check-in, reminder and review replies become stretch. The email is the demo centrepiece.

## 3. Schema v2 (V-1, orchestrator)

New migration `0005_v2.sql`. Nothing is dropped, so v1 data stays readable.
- **`brand_memory` gains:**
  - country, region, city and timezone (IANA)
  - goal (`enquiries`, `footfall` or `awareness`)
  - tone (incl. `like_past_posts`)
  - post_language (BCP-47, default `en`)
  - minutes_per_post
  - website_url
  - voice_description, example_phrases, words_to_avoid
  - weekly schedule (day and local time), link_destination
  - email paused and unsubscribed flags
- **`brand_facts`:** kind, value, source_type (`website`, `setup`, `upload` or `owner`), source_ref (URL or upload id), status (`active` or `removed`), created_by. Every fact keeps its source (Req 5).
- **`photos`:** the brand photo library (storage path, kind `photo` or `past_post`, extracted text).
- **`owner_dates`:** owner-added occasions.
- **`posts`:**
  - gain week_start, channel (`instagram`, `facebook`, `linkedin` or `gbp`) and short_code
  - status changes to `draft`, `approved`, `skipped` or `posted`
  - gain approved_at and posted_at
  - gain one row in `outputs` per format (`square`, `vertical` or `landscape`)
- **`post_actions`:** a log of approve, edit, skip, posted, share and rewrite, with how each was done (email link or dashboard).
- **`checkins`:** week, answer (`none`, `few` or `many`).
- **`email_log`:** kind (`weekly`, `reminder`, `late_notice` or `magic_link`), sent_at, status.
- **`usage_events`** gains usd.

Every new table has RLS by brand. No-login link actions run on the server after the signature check, as in v1.

## 4. Owner decisions (2026-10-13)

| Decision | Answer |
|---|---|
| Mascot | **Keep and finish** as an extra (V-25), after the core loop works |
| Email vendor | **Resend.** Needs a sending domain you control (SPF, DKIM, DMARC). Built against a mock outbox until then |
| Product name | **Working name for now:** "Weekly Posts" in the UI and emails, kept in one constant so it is easy to change |
| Build window | **4 weeks** |

## 5. Hardening list (for V-24 final review)

| # | Item | From |
|---|---|---|
| H-1 | **Fixed 2026-10-13** (`auto_rewrite` usage kind, migration 0011; counted in batch USD, no count cap). Was: Pipeline's own repeat/avoid rewrites should use their own usage kind (`auto_rewrite`), not count toward the owner's 15 weekly rewrites | V-21 |
| H-2 | **Fixed 2026-10-13** (`AiError.stats` + `failedCallUsd` at every JSON call site; a retried success sums both attempts). Was: `AiError` should carry call stats so failed/invalid calls are still costed | V-21 |
| H-3 | **Fixed 2026-10-13** (columns `attempts`, `regens`, `claimed_at`, migration 0011; old JSON rows still read). Was: `weekly_batches` attempts/regens as real columns instead of JSON in `error` | V-10 |
| H-4 | **Fixed 2026-10-13** (median-of-5 timing, robust temp cleanup). Was: flaky under full-suite load (pass alone): render "under 1.5 s" timing test; `tests/db/mock-steps.test.ts` (timeout, ENOTEMPTY on temp dir cleanup). Stabilise | V-21, V-22 |
| H-5 | Gmail/Outlook rendering and real-phone share sheets: manual checklist once a sending domain exists (`docs/email-checklist.md`) | V-15, V-17 |
| H-6 | Gemini via the shared Vertex project stalls on ~1 in 5 calls; dedicated GCP project before the pilot | live checks |
| H-7 | Supabase backend stubs (auth admin delete, storage list/removePrefix, Postgres driver) to implement at Supabase integration | V-2, V-20 |
| H-8 | Mascot polish: small mascot slot in tall text-only templates; pose label "Namaste" could read "Greeting" for a global audience | V-25 review |
| H-9 | **Fixed 2026-10-13** (pipes become ": " or ", " in saved values; quotes unchanged). Was: Website table cells are joined with " \| " in cleaned text, so facts like "Monday to Friday \| 7am to 6pm" carry a pipe into posts; normalise separators in fact values at extraction | V-24 demo |
| H-10 | **Fixed 2026-10-13** (old links show the week's current posts with a "replaced" note; a POST never acts). Was: After "Generate new posts", links in the already-sent weekly email point at replaced drafts and show "We could not find that". Fall back to the week's current posts with a short "these posts were replaced" note | V-24 browser pass |
| H-11 | **Fixed 2026-10-13** (real PNG `canShare` probe; Share hidden unless it passes, on the ready page and dashboard). Was: Ready page shows "Share" / "Share as story" on browsers that cannot share files (desktop); hide them when `navigator.canShare({files})` is false and lead with Download/Copy | V-24 browser pass |
| H-12 | **Fixed 2026-10-13** (consent says owners can delete in settings, with a Terms and privacy link). Was: Login consent line still says "You can ask us to delete them"; owners can now delete themselves in settings | V-24 browser pass |
| H-13 | **Fixed 2026-10-13** (lint scans style attributes only). Was: email lint test flakes when a random JWT in an href matches the CSS-unit regex; strip hrefs before scanning | V-23 |
| — | Fixed in V-24: setup location and business name were not facts, so "Mumbai" was flagged as an unsupported contact; plain invitations ("visit us today") were flagged as dates | V-24 browser pass |
