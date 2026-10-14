# Build plan v3

Spec: [6-prd-v3.md](6-prd-v3.md). Approved change list (2026-10-14): [9-changes-v3.md](9-changes-v3.md); task IDs below match its C-numbers. v2 plan and hardening list: [8-build-plan-v2.md](8-build-plan-v2.md).

Statuses: To do · In progress · Done (with evidence) · Blocked (with reason).

## Phase 1: Foundations + Details (week 1)

| ID | Task | Owner | Status |
|---|---|---|---|
| P1-0 | Migration 0014 (USPs, contact points, payment IDs, post briefs, `posts.brief_id`, RLS); shared types `src/lib/usps/types.ts`, `src/lib/briefs/types.ts`; CLAUDE.md for v3 | orchestrator | Done 2026-10-14: migrations pass in tests; trial run on Supabase OK (30 tables, RLS on all); apply after phase 1 checks |
| C-05, C-06, C-09, C-11 | Details core: USP library, contact set, post briefs (data + server functions), date ranges; Brand page sections for USPs and contacts | builder A | **Done 2026-10-14**: 131 tests (USP kinds, phones for 6 countries, 18 bad-URL cases, hours, snapshot freezing, cross-brand FKs, dates across time zones); export/delete cover the new tables. Orchestrator: `confirmed` added to USP snapshots; one-time import (`details_seeded_at`) so deleted contacts/USPs stay deleted |
| C-10, C-12 | QR codes (link via short link; payment QR with email confirmation and decode check) + guardrail rules per USP kind | builder B | **Done 2026-10-14**, 131 tests (QR round trips incl. unicode UPI payee, SSRF rejection, full email-confirm flow, RLS: nobody signed in can activate an ID, 60 guardrail rule cases). Builder found a bug in 0014 (UPI regex `{2,256}` exceeds Postgres' 255 limit), fixed by the orchestrator, plus `clicks.source`; AI client now redacts payment IDs before every Gemini call. Follow-ups done: scans via `clicks.source` with a separate "QR code scans" section on Results; redaction proven with a mocked Gemini SDK. Phase 2: call `redactForBrand` on owner text in the brief prompt; add USPs to the fact-check prompt |
| C-31, C-32, C-33 | Cloud Run (Docker, Cloud Build, Cloud Scheduler), Cloud Storage backend, Vertex credentials via service account | builder C | **Done 2026-10-14**: standalone build verified in a copy (login 200, cron auth 401/200, render smoke: Noto + HarfBuzz Devanagari + resvg + sharp); GCS backend with signed URLs, tests; `docs/deploy.md`. Orchestrator: production flag covers Cloud Run (`K_SERVICE`), PGlite lazy-loaded and left out of the image. **Unverified until Docker/Cloud Build runs:** linux native binaries (the Dockerfile's smoke step will catch it) |
| C-01, C-02 | Setup with two paths; v3 navigation | builder D | **Done 2026-10-14**: Path B walked in the browser (13 screens; reload resumed at the same step, fixing H-16; contacts saved as E.164, likes as confirmed USPs); nav Queue · Brand · Mascot · Results · History · Connections; Connections page with no dead buttons. Orchestrator: phones shown in international format (India's national format adds a leading 0); website contacts never become a second default; stable contact order. Polish: phone example should match the owner's country |
| C-04 | Remove v1 leftovers | builder E | Blocked: waiting for the owner's commit of the current work (safe restore point) |
| — | Apply 0014 + 0015 to Supabase | orchestrator | **Done 2026-10-14** after full checks (2,972 tests, typecheck and lint clean). 0015 repairs databases that ran a draft of 0014 (verified on a simulated draft) |

**Phase 1 checks (2026-10-14):** typecheck and lint clean, 3,028 tests pass; migrations 0014-0015 live on Supabase. Only C-04 remains, blocked on the owner's commit.

## Phase 2: Design (weeks 2-3)

| ID | Task | Owner | Status |
|---|---|---|---|
| P2-0 | Migration 0016 (formats portrait/thumbnail/banner, `brand_memory.kit`, post theme/layout/design/carousel, `backgrounds`, usage kinds); design contract `src/lib/design/types.ts`; prompts `src/lib/ai/prompts/v3.ts` (brief from text, post copy, style read, Imagen background) + `src/lib/ai/schemas-v3.ts` | orchestrator | Done 2026-10-14: tests pass; Supabase trial run OK (31 tables, RLS on all) |
| C-14, C-15, C-20 | Design engine: 9 themes (classic = v2 templates), layouts for 6 formats, hierarchy, auto-fit, contrast, safe zones, QR/logo/mascot/background slots, carousel, design options; OFL fonts for the 5 font roles | builder E1 | **Done 2026-10-14**: 9 themes × 3 text + 2 photo layouts × 6 formats; **200/200 random briefs pass** (contrast, overflow, safe zones, QR decode; 500 in scratch runs); ~70-115 ms per render; classic byte-identical to v2 for plain content; contact sheets checked by eye. Follow-ups done: per-format rules (thumbnails headline-led with no QR or contact lines, no QR on banners; reported as dropped, not overflow), balanced headline wraps (no one-word last lines; Latin, Devanagari, Arabic); 200-brief check passes for two seeds |
| C-13, C-19 | Brand kit (load/save/defaults, Look section) + logo helpers (text logo, white background removal, low-res warning) | builder E2 | **Done 2026-10-14**: kit always valid (bad stored fields dropped), colours merged not replaced (orchestrator also fixed the old profile save), Look section with palettes, fonts via a signed-in font route, style toggles, 9 theme cards (preview slots for E1), text logo via E1's engine, white-background removal keeps letter interiors; 345 tests in its areas |
| C-07, C-08 | Brief editor (Details step on /create) + brief from text or voice | builder E3 | **Done 2026-10-14**: /create → /create/{id} (autosave as draft, "Next: Design" saves as ready), all B-1 to B-8 fields, describe by text or voice (owner text redacted, model output re-validated in code, new USPs only as suggestions), Create first in the nav; 3,212 tests. Follow-ups done: WhatsApp/YouTube channels and "No end date" for offers (migration 0017), voice hint under the mic, dead history link removed |
| C-17, C-18 | "Keep my look" (style read from Instagram/website) + Imagen backgrounds (cached per brand/theme/palette) | builder E4 | **Done 2026-10-14**: live style read $0.005 (6 sample posts → maroon/cream/mustard kit, contrast-fixed); 2 live backgrounds $0.08, checked by eye: abstract, no text. **Imagen is not enabled on the shared Google Cloud project** (404 for all Imagen models); the code also supports Gemini image models, set locally (`IMAGEN_MODEL=gemini-2.5-flash-image`). Orchestrator: SynthID watermark kept on; theme cards anchor. Owner: enable Imagen on the dedicated project for the competition |
| C-16 | Design step: 3 options, quick edits, post copy, guardrail with USP rules, render all channel formats, save posts; /create flow Details → Design → Review → Schedule | builder E5 | **Done 2026-10-14**: one post per channel (own caption, short link, flags), every size per channel, carousel rows, `posts.design` makes redraws byte-identical, copy written once (cached as drafts), approval blocked by open flags, overflow or a QR that fails decoding; 3,454 tests. Orchestrator: repetition check now covers brief posts without channels flagging each other; daily cap 60 (0018); typed per-type defaults. Follow-up running, then a live browser run |


**Phase 2 live run (2026-10-14, Saffron Tailors, real Gemini, about 3 cents):** describe → brief → 3 options → review → approve worked end to end; 2 channels × 3 sizes rendered; the fact check caught an invented "best". Found and fixed:
- brief-from-text: open-ended `fields` came back empty from Gemini, so new USPs were dropped → named fields (schema v3, prompt v2); a discount's subject returned as `what` → mapped to `on`; titles now exclude dates (prompt v3).
- old phone rows showed "098200 12345" → phones displayed from E.164 at read time.
- "look your best" flagged as a superlative → everyday phrases skipped (tests).
- the same fact printed four times on one design → prompt v2 forbids repeating lines; `contentFromBrief` now drops a primary line the headline already says, a subline that repeats headline/primary/date, and trailing date phrases (the date line shows the date once); tested on the live example plus a property test.
- "Add and use it" didn't select the new USP (a page refresh after the save reset the editor) → own actions without refresh + `selectNewUsp`; re-verified live.
- Known: removing a flagged word can leave a broken sentence (v2 behaviour); to revisit with smarter removal.

**Phase 2 checks (2026-10-14):** typecheck and lint clean, **3,476 tests pass**; second live run: description → new USP added and selected → 3 options all fitting, "Nothing to check", each fact shown once (headline, "Till 30 Nov", a new second line, CTA, phone); migrations 0016-0018 live on Supabase (31 tables, RLS on all). Live AI spend in phase 2 about $0.15. Open: Imagen must be enabled on the dedicated Google Cloud project; removing a flagged word can leave a broken sentence (v2 behaviour).

## Phase 3: Queue + publishing (week 3)

| ID | Task | Owner | Status |
|---|---|---|---|
| P3-0 | Migration 0019 (`queue_settings`, `queue_items`, `channel_connections`, server-only `channel_tokens` with brand id, `deletion_requests`, email kinds); contract `src/lib/queue/types.ts` (settings, statuses, `PublishQueueItem` seam) | orchestrator | Done 2026-10-15: tests pass (delete test covers the token table); Supabase trial run OK (36 tables, RLS on all) |
| C-24, C-27, C-28 | Queue: slots by cadence and time zone, one post per slot, end-date cut-off, owner actions, hourly sweep (publish / deliver / retry / missed / expired / pause, idempotent), delivery emails, auto-approve, Queue page, /create Schedule step | builder Q1 | **Done 2026-10-15**: DST-safe slots, one-statement claims (concurrent runs send once), stale publishing never re-sent, publish → fallback email after 3 attempts, delivery email with ready page, auto-approve only for flag-free posts; orchestrator wired the real publisher; follow-ups: deliver items upgrade to publish on connect, queue in the export, deploy doc lists 4 jobs. Not done: weekly suggestions filling the queue (v2 batch stays on the page) |
| C-25, C-26 | Connections: Instagram Login + Facebook Page connect, encrypted tokens, refresh, disconnect, Meta data-deletion callback; publisher for Instagram (feed, story, carousel) and Facebook (photo, multi-photo) | builder Q2 | **Done 2026-10-15** (mocked Meta; live test needs the app + https address): AES-256-GCM tokens bound to brand+provider, signed state + nonce cookie, Page tokens never reach the browser, publisher refuses unapproved posts and checks the IG publishing limit, 19 error mappings, tokens never in logs; follow-ups: `platform_user_id` (0020), double-post guard after a timeout (looks up recent posts by caption), revoke on account deletion, connections in the export. Open: verify response shapes live |

**Phase 3 checks (2026-10-15):** typecheck and lint clean, **3,746 tests pass**; migrations 0019-0020 live on Supabase (36 tables, RLS on all). Live publishing untested until the Meta app has an https address.

Owner: Meta app with Instagram Login + Facebook Login, App Review for `instagram_business_content_publish` and `pages_manage_posts` (2-4 weeks; testers work before).

## Phase 4: Imports, analytics, voice, languages, international (week 4)

C-22, C-23, C-29, C-30, C-34, C-35, C-36, C-37.

## Phase 5: Legal, docs, acceptance (week 4)

C-38, C-39, C-40; stretch C-21 (Veo) if time.
