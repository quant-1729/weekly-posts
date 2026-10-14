# Changes from the current system to PRD v3 (for review)

Status: proposal, 2026-10-14. Nothing here is built yet. Approve, edit or strike items; the approved list becomes the v3 build plan.
Spec: [6-prd-v3.md](6-prd-v3.md). Current system: [6-prd-v2.md](6-prd-v2.md), [8-build-plan-v2.md](8-build-plan-v2.md), [architecture.md](architecture.md).

**Key:** **New** = doesn't exist. **Change** = exists, works differently. **Remove** = delete. **Keep** = no change. Effort is builder-days (one task, with tests), rough. Items in the same phase can run in parallel when they touch different files.

## 0. Summary

| Area | Items | Effort |
|---|---|---|
| 1. Onboarding and navigation | C-01 to C-04 | 6 days |
| 2. Details (post brief, USPs, contact, QR) | C-05 to C-12 | 14 days |
| 3. Design (kit, themes, formats, options, style learning) | C-13 to C-21 | 17 days (+4 stretch) |
| 4. Imports | C-22 to C-23 | 3 days |
| 5. Scheduling and auto-publishing | C-24 to C-28 | 12 days |
| 6. Results and analytics | C-29 to C-30 | 3 days |
| 7. Google Cloud platform | C-31 to C-36 | 8 days |
| 8. International | C-37 | 2 days |
| 9. Legal, docs, tests | C-38 to C-40 | 3 days |
| **Total** | 40 items | **about 68 builder-days** (+4 stretch). With 3-4 builders in parallel: **about 4 weeks** of calendar time, plus Meta's 2-4 week review running alongside |

## 1. Onboarding and navigation

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-01 | Change | **Setup becomes two paths.** First screen: "Do you have a website / Instagram / YouTube / none?" Path A: enter addresses, imports run in the background, a review screen shows what was found (untick anything). Path B: one question per screen: name, what you sell, who buys, location, phone/WhatsApp, hours, logo (upload or "make one from my name"), 1-3 things customers like (seed USPs), photos. Today's 10-step setup is replaced; its answers map onto the new screens. | `src/app/(app)/setup/**`, `src/lib/setup/**`, strings | 3 |
| C-02 | Change | **Navigation:** sidebar becomes Create · Queue · Brand · Results · History · Connections (+ Mascot under Brand). "This week" becomes **Queue** (C-24). | `src/components/app-shell/**`, bottom nav | 1 |
| C-03 | New | **Create a post** page: the Details → Design → Review → Schedule flow (C-07, C-16). Reuses the `/create` route; the v1 page there is replaced. | `src/app/(app)/create/**` | (in C-07) |
| C-04 | Remove | **v1 leftovers:** pages `/plan`, `/review/[postId]`, old `/create`; route `/api/posts/generate`; v1 tables `weekly_plans`, `plan_ideas`, `outputs`, `approval_links`, `approvals`, `approval_comments`, `summary_shares` and their code and tests, after a check that v2/v3 code doesn't use them. | many | 2 |

## 2. Details: post brief, USPs, contact, QR

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-05 | New | **USP library** per brand: kind (discount, price, quality, reviews, delivery, guarantee, experience, free extra, custom), fields per kind, source (website, Instagram, owner), active flag. Seeded from facts and Path B answers; edited on the Brand page. | table `usps`; `src/lib/usps/**`; Brand page section | 2 |
| C-06 | New | **Post brief** data model: type, primary USP, up to 2 secondary, CTA, chosen blocks, photo, language, date range, channels. A post points to its brief; editing the brief re-renders. | table `post_briefs`; `posts.brief_id`; `src/lib/briefs/**` | 2 |
| C-07 | New | **Brief editor** (B-1 to B-8): type picker, USP picker with primary/secondary, per-format USP limit with carousel offer, CTA, block toggles, photo, language, completeness check with one-line questions. | `src/components/brief/**`, `/create` | 3 |
| C-08 | New | **Brief from text or voice:** a Gemini prompt fills the brief from the owner's words; anything it can't ground stays empty. Voice via Speech-to-Text (C-34). | `src/lib/ai/prompts/brief.ts` (orchestrator), schema | 1.5 |
| C-09 | Change | **Contact set** in the brand profile: phone and WhatsApp in E.164 (validated by country), website (HEAD check), address (short and full), hours per day, date ranges, social handles. Today only some of these exist as free-text facts. | `brand_memory` columns or table `contact_points`; validation lib (`libphonenumber-js`) | 1.5 |
| C-10 | New | **QR codes.** Link QR through our short link (scans counted). Payment QR (UPI first): owner-typed ID only, never touched by AI, format check, payee name and ID shown as text, change needs email confirmation, decoded after rendering and must match exactly or the post is blocked. | `src/lib/qr/**` (`qrcode` + a decoder), table `payment_ids`, short links | 2 |
| C-11 | New | **Date ranges and expiry:** start ≤ end, end not in the past, owner's time zone; expired posts never deliver or publish. | `post_briefs`, queue (C-24) | 0.5 |
| C-12 | Change | **Guardrail rules per USP kind:** rating needs platform and count; "up to" only when the owner said so; superlatives flagged unless confirmed; payment IDs excluded from all AI input and output; QR content checked against the brief. | `src/lib/guardrail/**`, fact-check prompt (orchestrator) | 1.5 |

## 3. Design

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-13 | Change | **Brand kit:** today's colours + logo grow into a kit: 4 colours, headline + body font (from a shipped set of open-licence fonts: Noto families plus a few display fonts), style flags (rounded/sharp, light/dark, calm/bold), mascot on/off. | `brand_memory` kit columns; `assets/fonts/**`; Brand page "Look" section | 2 |
| C-14 | Change | **Themes × layouts × formats.** Today: 12 templates (4 layouts × 3 formats). New: 6-8 themes, each with layout variants, driven by a **hierarchy engine** (primary USP largest, then offer/date, CTA, contact blocks, QR slot), auto-fit (shrink → wrap → roomier layout → ask), contrast rule, safe zones. The biggest single change. | `src/lib/render/**` (templates, layout) | 6 |
| C-15 | Change | **More formats:** add 1080×1350 (feed portrait), 1280×720 (YouTube thumbnail), 1920×600 (website banner); keep 1080², 1080×1920, 1200×630. A4 PDF optional. | `src/lib/render/**`, `post_images.format` enum | 1.5 |
| C-16 | New | **3 design options per post + quick edits:** swap layout, swap colours, change photo, edit text (re-checked), move logo, show/hide blocks. Chosen family becomes the default for that post type. | `src/components/design/**`, `/create` | 2.5 |
| C-17 | New | **"Keep my look":** read the website theme (colours, logo, fonts) and up to 12 Instagram/YouTube images with Gemini vision → suggested kit + closest theme. Owner picks "Keep my look" or "Try a fresh look". | `src/lib/style/**`, prompt (orchestrator) | 2.5 |
| C-18 | New | **Imagen backgrounds:** abstract textures per theme/brand, generated once and cached; never products, people or text. | `src/lib/ai/imagen.ts`, storage, cost caps | 1.5 |
| C-19 | New | **Logo helpers:** text logo from the business name in the kit font; remove a plain white background from uploaded logos when safe; low-resolution warning. | `src/lib/logo/**` | 1 |
| C-20 | New | **Carousel:** one USP per slide when the owner picks more than a format can hold. | render + publish | (in C-14/C-26) |
| C-21 | New (stretch) | **Veo animated posts:** 5-8 s video of a finished post (moving background, code-drawn text/logo/QR overlays) for Reels/Shorts/Status; opt-in, price shown first. | `src/lib/video/**` | +4 |

## 4. Imports

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-22 | New | **YouTube import** by channel handle/URL (YouTube Data API key): titles, descriptions, thumbnails → voice samples and style samples. | `src/lib/youtube/**`, Brand page card | 2 |
| C-23 | Change | **Instagram import** (built, I-1): its images also feed style learning (C-17); deleted imported posts stay deleted (H-20, small schema change). Live switch-on with your Meta token. | `src/lib/instagram/**` | 1 |

## 5. Scheduling and auto-publishing

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-24 | Change | **Queue replaces the weekly batch screen:** cadence (e.g. 1 a day, 3 a week), preferred times per channel, one post per slot, missed slot → "skip, post now or move", expiry, pause. The weekly suggestion run stays but fills the queue with suggested briefs instead of a fixed 3-5 posts. | tables `schedule_settings`, `queue_items`; `src/lib/weekly/**` → `src/lib/queue/**`; Queue page | 4 |
| C-25 | New | **Connections:** "Connect Instagram" (Instagram Login, `instagram_business_basic` + `instagram_business_content_publish`) and "Connect Facebook" (Page, `pages_manage_posts`); encrypted tokens, 60-day refresh, disconnect, expiry warning; Meta data-deletion callback. | table `channel_connections`; `src/lib/connections/**`; Connections page | 3 |
| C-26 | New | **Publisher:** at slot time publish approved posts to connected channels (image, carousel, Reels when video exists, Stories), poll status, retry 3 times, then "share it yourself"; store platform post ID and link. Needs public image URLs (Cloud Storage signed URLs, C-32). | table `publications`; `src/lib/publish/**`; worker on Cloud Run | 3 |
| C-27 | Change | **Delivery to owner** for channels that can't be automated (WhatsApp Status, YouTube community, others): reuse today's email + share page per slot instead of one weekly email. | `src/lib/email/**`, `src/lib/links/**` | 1 |
| C-28 | Change | **Approvals:** keep no-login approve/edit/skip links; add "auto-approve posts with no flags" per channel (off by default). | `src/lib/approvals/**`, settings | 1 |

## 6. Results and analytics

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-29 | Change | **Results per post, USP kind, theme and channel:** QR scans + link clicks (exists) + published post links; "what worked" on the Results page. | `src/lib/results/**` | 1 |
| C-30 | New | **BigQuery:** daily export (or streaming) of anonymised events (scans, clicks, approvals, publishes, theme, USP kind, category, country) for audience analytics; no personal data. | `src/lib/analytics/**`, Cloud Scheduler job | 2 |

## 7. Google Cloud platform

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-31 | Change | **Hosting on Cloud Run** instead of Vercel: Dockerfile, Cloud Build, region next to the database (Supabase is in Sydney → `australia-southeast1`, or move Supabase while it's empty), Secret Manager for secrets; **Cloud Scheduler** replaces `vercel.json` crons. `docs/vercel-deploy.md` becomes `docs/deploy.md`. | `Dockerfile`, `cloudbuild.yaml`, docs | 2 |
| C-32 | Change | **Cloud Storage** instead of Supabase Storage: new implementation of our storage interface (same 5 buckets), signed URLs for publishing; the Supabase one stays as an option. | `src/lib/storage/gcs.ts`, env | 1.5 |
| C-33 | Keep/Change | **Gemini on Vertex AI** stays; switch the credentials to your dedicated Google Cloud project with a service account (H-6). | env only | 0 |
| C-34 | Change | **Speech-to-Text (Chirp)** for voice input (brief by voice, setup answers) instead of Gemini transcription. | `src/lib/ai/transcribe.ts` | 1.5 |
| C-35 | New | **Text-to-Speech** for Tween's optional voice (replaces the browser voice) and for voice-overs on animated posts (with C-21). | `src/lib/tts/**`, Tween | 1.5 |
| C-36 | New | **Cloud Translation** for the app interface in more languages (strings.ts → per-language files, glossary for brand terms); post captions stay written by Gemini in the target language. | `src/lib/i18n/**` | 1.5 |

## 8. International

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-37 | Change | **Locale-aware defaults:** currency, number/date formats, phone format by country, payment QR type by country (UPI in India; others later), WhatsApp/UPI defaults only where common; remove remaining India-only assumptions from v1 code paths. | `src/lib/setup/**`, render, strings | 2 |

## 9. Legal, docs and tests

| ID | Type | Change | Where | Effort |
|---|---|---|---|---|
| C-38 | Change | **Terms and privacy:** Google Cloud services, Jina Reader, Meta (import + publishing), YouTube, payment QR rules, data-deletion URL, Tween clause. Lawyer review. | `src/app/terms/**` | 1 |
| C-39 | Change | **Docs:** PRD v3 becomes the spec; new build plan v3 and QA map; CLAUDE.md updated (stack, rules: payment IDs never in AI, auto-publish only after approval). | `docs/**`, `CLAUDE.md` | 1 |
| C-40 | New | **Acceptance tests** for PRD v3 section 9: timed Path B run, Path A import timing, planted-fact checks, 200-brief render checks (contrast, overflow, safe zones), QR scan test on 3 phones, queue across time zones/DST, "keep my look" owner check. | `tests/**`, scripts | 1 |

## 10. Database changes (orchestrator-owned migrations, each with row-level security)

| Migration | Adds |
|---|---|
| 0014 | `usps`, `post_briefs`, `posts.brief_id`; contact set (`contact_points` or `brand_memory` columns) |
| 0015 | `payment_ids` (owner-only, change log, email confirmation), QR fields on briefs |
| 0016 | brand kit columns; theme and layout ids on posts; new `image_format` values |
| 0017 | `schedule_settings`, `queue_items` (slots, status, expiry) |
| 0018 | `channel_connections` (encrypted tokens), `publications` |
| 0019 | Instagram hidden posts (H-20); YouTube import fields |
| later | drop v1 tables (C-04), after a backup and a check that nothing reads them |

## 11. New settings (`.env.local` and the cloud)

`INSTAGRAM_LOOKUP_TOKEN`, `INSTAGRAM_LOOKUP_USER_ID` (import) · `META_APP_ID`, `META_APP_SECRET` (connect + publish) · `TOKEN_ENCRYPTION_KEY` · `YOUTUBE_API_KEY` · `GCS_BUCKET_PREFIX` (Cloud Storage) · `BIGQUERY_DATASET` · `GOOGLE_SERVICE_ACCOUNT_JSON` (exists) for Vertex AI, Speech, TTS, Translation, BigQuery and Storage · `READER_API_KEY` (exists) · `RESEND_API_KEY` (exists).

## 12. What you need to set up

1. **Google Cloud project** (dedicated, with billing): enable Vertex AI, Speech-to-Text, Text-to-Speech, Cloud Translation, BigQuery, Cloud Storage, Cloud Run, Cloud Build, Cloud Scheduler, Secret Manager, YouTube Data API; one service account key. I'll send click-by-click steps.
2. **Meta app** (steps already sent) plus the publishing permissions; submit App Review and Business Verification early (2-4 weeks).
3. **Resend** with a sending domain.
4. **Decisions** in PRD v3 section 11: Cloud Run move now or later; Veo in the demo or later; competition deadline and demo format; product name.

## 13. Kept as is

Website reader with sourced facts and the JavaScript-site reader · Instagram import by @handle · facts with sources, voice, photos and the usable-photo check · guardrail (code + AI), regulated rules, repetition check · text drawn by code with HarfBuzz and Noto fonts · Tween (app guide and brand mascot) · no-login signed email links · short links and click counting · check-ins · export and account deletion · cost caps · Supabase database and sign-in · desktop-first layout.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Meta App Review rejects or takes longer | Submit early; testers work meanwhile; delivery-to-owner always works |
| Render engine rewrite (C-14) breaks existing posts | Keep current templates as the "Classic" theme; 200-brief automated checks before switching |
| Veo cost | Opt-in, priced per clip, weekly cap; stretch only |
| Payment QR misuse | Owner-only ID, email-confirmed changes, decode check, never in AI |
| Moving hosting mid-build | Do C-31/C-32 first, before new features, while traffic is zero |
| Scope (about 68 builder-days) | Phase it: (1) Details + platform move, (2) Design, (3) Queue + publishing, (4) imports, analytics, stretch |

## 15. Proposed phases

| Phase | Items | Calendar |
|---|---|---|
| 1. Foundations + Details | C-31, C-32, C-33, C-04, C-05, C-06, C-09, C-10, C-11, C-12, C-01, C-02 | Week 1 |
| 2. Design | C-13, C-14, C-15, C-16, C-17, C-18, C-19, C-07, C-08 | Weeks 2-3 |
| 3. Queue + publishing | C-24, C-25, C-26, C-27, C-28 (Meta review submitted in week 1) | Week 3 |
| 4. Imports, analytics, voice, languages, international | C-22, C-23, C-29, C-30, C-34, C-35, C-36, C-37 | Week 4 |
| 5. Legal, docs, acceptance | C-38, C-39, C-40; stretch C-21 if time | Week 4 |
