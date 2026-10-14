# PRD v3: Details first, then design (DRAFT for discussion)

Status: draft, 2026-10-14 (updated with the owner's answers: Google Cloud stack, auto-publish, international market, QR payments). Nothing here is built yet beyond what section 10 marks as existing. Builds on v2 (`6-prd-v2.md`, "Weekly Posts"); where they differ, this file wins once approved.

## 1. Summary

A web app (desktop-first, works on phones) that lets a small business owner with no design skills, tools or budget make good-looking, truthful promotional posts for WhatsApp, Instagram, YouTube and their website, and then schedules them one at a time.

It works in two steps, always in this order:

1. **Details:** what the post must say (offer, USPs, contact, logo, dates). Nothing appears on a post unless it came from the details.
2. **Design:** how it looks (colours, theme, layout), either matching the owner's existing look or a fresh one.

Two entry paths:

- **Path A, has a digital presence** (Instagram, YouTube, website): we read it, pre-fill the details and learn the existing look.
- **Path B, no digital presence:** short guided questions fill the details; the owner picks a look.

## 2. Users

| User | Situation | What they need |
|---|---|---|
| A: present online | Has an Instagram, YouTube channel and/or website; posts irregularly, looks inconsistent | "Keep my look, make it faster and more consistent" |
| B: not online | Only a phone number and a shop; maybe a WhatsApp Business profile | "Make me look professional from nothing" |

Both: no design tool skills, no budget for an agency, little time (minutes, not hours), often on a phone, sometimes not confident in English.

## 3. Goals and success measures

| Goal | Measure |
|---|---|
| First post fast | Path B: details to a finished post in under 5 minutes. Path A: URL or @handle to a finished post in under 3 minutes |
| Truthful | 0 prices, offers, dates, ratings or claims on a post that are not in the details (checked by code + AI, flagged otherwise) |
| Looks designed | In a blind test, owners and outsiders prefer our post over the owner's previous post or a generic template ≥ 60% of the time |
| Consistent | All of an owner's posts share one brand kit (colours, logo, fonts) unless they choose otherwise |
| Gets used | ≥ 60% of scheduled posts are approved with light or no edits |
| Cheap | AI cost per owner per week under the cap (v2: $0.50) |

**Non-goals (this version):** video editing, AI images of the owner's products, people or premises (photos come from the owner), print fulfilment, paid ads management, a full drag-and-drop editor like Canva.

**Market:** international from day one: English UI first, posts in 20+ languages, any currency, phone numbers in international format, every time zone. No country-specific default (UPI, WhatsApp-first) is assumed; they switch on by country.

## 4. Core flow

```
Onboard (Path A import | Path B questions)
   → Brand profile (facts + brand kit)
   → New post: Details (brief) → Design (3 options) → Review (flags) → Schedule
   → Delivery, one at a time → Share / publish → Results
```

Weekly mode (v2) uses the same engine: it proposes a week of briefs from the brand profile and occasions; each still goes Details → Design → Review.

## 5. Requirements

### 5.1 Onboarding and brand profile (D-1 to D-4)

**D-1 Path choice.** First screen: "Do you have any of these? Website / Instagram / YouTube / None". Any combination is allowed. "None" goes to Path B.

**D-2 Path A import.**
- Website: read up to 5 pages (robots.txt respected; JavaScript-built sites through a reader service), extract facts, each with its source quote. *(Exists, W-1.)*
- Instagram: from the @handle (typed, or found on the website), read recent public posts of business/creator accounts: captions become voice samples; images become photo candidates and style samples. *(In progress, I-1.)*
- YouTube: from the channel handle/URL, read recent video titles, descriptions and thumbnails (YouTube Data API). Thumbnails are style samples.
- Each import shows what it found with its source and lets the owner untick anything.
- Imports never block: setup continues; results arrive in the background.

**D-3 Path B questions** (one per screen, all skippable except the first two): business name; what you sell; who buys; location; phone/WhatsApp; opening hours; logo (upload or "make one from my name"); 1-3 things customers like about you (seed USPs); photos (optional).

**D-4 Brand profile** (editable any time): facts with sources, USP library, contact set, brand kit (section 5.3), voice. Every value shows where it came from (website, Instagram, YouTube, owner).

### 5.2 Details: the post brief (B-1 to B-8)

**B-1 Post type** (one): Offer/discount · New product/service · Event · Announcement (opening, holiday hours) · Festival/occasion greeting · Testimonial/review · Hiring · General brand post.

**B-2 USPs.** The owner picks from their USP library or adds new ones. One is **primary** (largest on the post); up to 2 **secondary**. Built-in USP kinds, each with its own fields:

| Kind | Fields | Rule |
|---|---|---|
| Discount | % or amount off; on what; valid from-to | "Up to" allowed only if owner says so; base price optional |
| Price | amount, currency, unit | Must match a fact or be entered now |
| Quality / feature | short claim | Superlatives ("best", "No.1") flagged unless owner confirms a source |
| Reviews / rating | rating, count, platform (e.g. "4.8 on Google, 230 reviews") | Must be entered by owner; shown with platform name |
| Speed / delivery | promise (e.g. "Same-day delivery in Indore") | Area and conditions required |
| Guarantee / warranty | length, terms | Shown as "T&C apply" when terms exist |
| Experience / trust | years, certifications, awards | Owner-entered only |
| Free extra / trial | what is free, conditions | Conditions shown |
| Custom | text up to 60 characters | Guardrail-checked |

Limit per format: square/story up to 1 primary + 2 secondary; thumbnail/banner 1 primary + 1 secondary. If the owner picks more, we warn ("Too many points make the post hard to read") and offer a carousel (one USP per slide).

**B-3 Call to action** (one): Call · WhatsApp · Visit us · Book · Order online · Visit website · Scan QR. Text is generated from the type and fits ≤ 25 characters.

**B-4 Contact and info blocks.** Per post, the owner toggles which appear. Defaults come from the brand profile.

| Block | Content | Validation |
|---|---|---|
| Logo | uploaded or text logo | Transparent PNG/SVG preferred; low-res warning below 300 px |
| Phone / WhatsApp | number | Normalised to E.164; shown in local format; WhatsApp link `wa.me/...` |
| Website | URL | Must load (HEAD check); shown without `https://` |
| QR code | a **link** (website, WhatsApp chat, Google Maps, booking, custom URL) or a **payment** (B-4.1) | Generated by code; minimum 2.5 cm/300 px, quiet zone, dark-on-light plate, contrast check; label under it ("Scan to visit" / "Scan to pay"); never a QR the owner did not ask for |
| Address | short form for the post, full form in caption | Map link optional |
| Hours | per day, or "Open daily 9-9" | Contradiction check with profile hours |
| Date range | "From 15 to 20 Oct" or "Till Sunday" | End date not in the past; start ≤ end; shown in the owner's time zone; post auto-expires after the end date |
| Social handles | Instagram, YouTube | Must be the owner's own (imported or confirmed) |

**B-4.1 QR codes in detail.**
- **Link QR:** encodes our short link, which redirects to the owner's URL, so every scan is counted (R-1). The owner's URL must load (HEAD check).
- **Payment QR:** encodes the payment address itself, not a short link (payment apps read the QR directly and won't follow a web redirect), so payment scans are not counted. By country: UPI (India, `upi://pay?pa=<id>&pn=<name>&cu=INR`) first; later PIX (Brazil), PayNow (Singapore), PromptPay (Thailand), EPC/SEPA (EU); elsewhere a payment link (PayPal.me, Stripe Payment Link) as a link QR.
- **Safety (payment):** the payment ID is typed by the owner only and is never written, edited or suggested by AI; format check (UPI: `name@bank`); the payee name and ID are printed as text next to the QR; changing a saved payment ID needs confirmation by email (stops a hijacked session redirecting payments); a fixed amount only if the owner sets it; after rendering, code decodes the QR and it must equal the saved ID exactly, or the post is blocked.
- **In templates:** every template has a QR slot (corner badge or panel) that appears only when a QR is chosen; it never covers the primary USP; its size and plate are fixed by the template, so edits can't break it.

**B-5 Product/photo.** Pick from the photo library or upload; or "no photo" (typography-only design). AI never draws the product.

**B-6 Language.** Post language (default from profile); English + one local language allowed on the same post (e.g. Hindi headline, English phone/website).

**B-7 Brief from text or voice.** "Describe your post" box (typed or spoken): AI fills B-1 to B-6 from it; the owner confirms each field. Anything the AI could not ground in the owner's words or profile is left empty, never guessed.

**B-8 Completeness check.** Before design: required fields per type (e.g. Offer needs what + how much + until when) are present; missing ones are asked for in one line each.

### 5.3 Design (G-1 to G-7)

**G-1 Brand kit.** Colours (primary, secondary, accent, background), logo, two fonts (headline, body, from the Noto/Google Fonts set we ship), style (rounded/sharp, light/dark, busy/calm), mascot on/off (Tween, v2).

**G-2 Path A: learn the existing look.** From website (theme colour, CSS colours, logo, fonts) and from up to 12 Instagram/YouTube images: dominant colours, light/dark, text density, where text usually sits, photo vs graphic ratio. Result: a suggested brand kit + "closest template family". The owner chooses **"Keep my look"** (match it) or **"Try a fresh look"** (Path B themes). Honest limit: we match colours, logo, mood and layout family, not the exact fonts or artwork.

**G-3 Path B: pick a look.** 6-8 themes (Clean, Bold sale, Premium, Playful, Festive, Local/traditional, Minimal dark, Fresh green), each shown already filled with the owner's details. Colours suggested from the logo, or 6 palettes to choose from.

**G-4 Layout engine** (exists in v2, extended). Code-rendered SVG → PNG with HarfBuzz text shaping and Noto fonts (Latin, Devanagari, Arabic and more). Rules:
- Visual hierarchy from the brief: primary USP largest; then offer/date; then CTA; then contact blocks.
- Auto-fit: text shrinks to a minimum size, then wraps, then the layout switches to a roomier variant; never overflows or overlaps.
- Contrast: every text/background pair ≥ 4.5:1 (3:1 for large text); otherwise add a scrim or switch colour.
- Safe zones per format (story UI areas, thumbnail timestamp corner).
- No text inside any AI image; AI images only as abstract backgrounds, never products, people or places.
- **Imagen (Vertex AI)** makes abstract theme backgrounds and textures for the theme set (G-3) and for posts without a photo, generated once per theme or brand and reused (cost control). Text, logo, QR and products are always drawn by code on top.
- **Veo (Vertex AI), stretch:** a 5-8 second animated version of a finished post (moving background; text, logo and QR still drawn by code as overlays) for Reels, Shorts and Status. Opt-in per post, with its cost shown first, because video costs far more than images.

**G-5 Formats** (each post renders all that its channels need):

| Channel | Format |
|---|---|
| Instagram feed | 1080×1080 and 1080×1350 |
| Instagram/WhatsApp status/story | 1080×1920 |
| YouTube thumbnail | 1280×720 |
| YouTube community / Facebook | 1080×1080 |
| Website banner / link preview | 1920×600, 1200×630 |
| Print (optional) | A4 PDF |

**G-6 Options and edits.** 3 design options per post (different layouts, same details). Quick edits without a full editor: swap layout, swap colour scheme, change photo, edit any text (re-checked by the guardrail), move logo corner, show/hide blocks.

**G-7 Consistency.** Once an owner approves a design, its family becomes the default for future posts of that type.

### 5.4 Captions and copy (C-1 to C-3)

**C-1** Caption per channel (Instagram, WhatsApp, YouTube description, Facebook, Google Business) with hashtags where useful; uses only the brief and profile facts.
**C-2** Guardrail (exists in v2): code checks numbers, dates, contacts, currencies; AI fact-check; anything ungrounded is flagged "Please check"; regulated categories (health, finance, legal, alcohol) never get outcome promises.
**C-3** No repetition of 6+ word phrases from the last 4 weeks (v2).

### 5.5 Scheduling and delivery (S-1 to S-6)

**S-1 Queue.** Approved posts go into a queue with a date and time per channel. The owner sets a cadence (e.g. 1 a day, 3 a week) and preferred times.
**S-2 One at a time.** Exactly one post is delivered per slot; the next waits. If a slot is missed (not shared), the queue does not pile up: it asks "Skip, post now, or move?".
**S-3 Delivery and auto-publishing.** Auto-publishing is preferred; it needs a one-time "Connect" per channel. Where a channel can't be automated, the post is delivered to the owner at the slot time (email, later WhatsApp) with one-tap Share and Download/Copy.

| Channel | How | Owner does | Our build effort | Platform approval | Running cost |
|---|---|---|---|---|---|
| Instagram (feed, carousel, Reels, Stories) | Instagram API with Instagram Login: `instagram_business_basic` + `instagram_business_content_publish`; create a media container, then publish; the image must be at a public URL | Taps "Connect Instagram", logs in, Allow (business or creator account) | 3-4 days (connect, encrypted tokens with 60-day refresh, publishing, status checks, retries, per-account daily limit) | Meta App Review + Business Verification, usually 2-4 weeks; app testers work before that | Free API |
| Facebook Page | Same Meta app, Facebook Login: `pages_manage_posts`, `pages_read_engagement` | "Connect Facebook", pick the Page | +1-2 days | Same review | Free |
| YouTube Shorts | YouTube Data API `videos.insert` (OAuth `youtube.upload`); needs a video (Veo, or a still-to-video render) | "Connect YouTube" | 3 days + video rendering | Google OAuth verification for a sensitive scope + YouTube API audit (uploads stay private until then), several weeks; the default quota allows only a few uploads a day per project, more on request | Free API; video cost (G-4) |
| YouTube community posts | No API | Share/download | – | – | – |
| WhatsApp Status | No API | One-tap Share | – | – | – |
| WhatsApp to customers | WhatsApp Business Platform, marketing templates to opted-in contacts | Verified business number, template approval, customer opt-ins | 4-6 days | Meta business verification, template review | Paid per message, by country (roughly 1-15 US cents) |
| LinkedIn page, Google Business Profile | Partner APIs | "Connect" | 2-3 days each | Partner programme approval (weeks) | Free |

Recommended order: Instagram + Facebook first (one Meta app, one review, covers most small businesses), YouTube Shorts together with the video stretch, everything else as delivery to the owner.

**S-3.1 Publishing rules.** Only approved posts publish (S-4). A failed publish retries 3 times, then the owner is told with a one-tap "Share it yourself". Tokens are encrypted at rest; a disconnected or expired connection pauses auto-publishing for that channel and tells the owner. Every published post stores its platform post ID and link (results, deletion). Meta requires a data-deletion callback and a privacy policy URL; both are part of the build.

**S-4 Approval.** Nothing is published or delivered without the owner's approval (v2 rule), unless they turn on "Auto-approve posts with no flags" for a channel.
**S-5 Expiry.** A post with a date range is never delivered after its end date; it is moved to "Expired".
**S-6 Pause / holiday.** One switch pauses the queue; reminders stop.

### 5.6 Results (R-1 to R-2)

**R-1** QR scans and link clicks counted through our short links (exists); per post and per USP kind.
**R-2** One-tap weekly check-in ("Did these bring customers?") (exists).

## 6. Edge cases

| Area | Case | Behaviour |
|---|---|---|
| Import | Instagram is a personal account | One line: "Instagram doesn't share personal accounts' posts. Add screenshots instead." |
| Import | Website is JavaScript-only / blocks robots | Reader service / title-description fallback / "add facts yourself" (W-1) |
| Import | Website and Instagram disagree (price, hours) | Show both with sources; owner picks; newest is suggested |
| Import | Imported caption mentions an old offer | Old offers are never reused without owner confirmation (date check) |
| Details | Discount with no end date | Ask once; allow "no end date" explicitly |
| Details | End date in the past / start after end | Blocked with a one-line fix |
| Details | Price in a different currency than the country | Flagged (v2 currency check) |
| Details | "Best in town", "No.1", "guaranteed results" | Flagged; regulated brands blocked |
| Details | Rating without platform or count | Asked for; not shown until given |
| Details | Phone number invalid or for another country | Blocked with an example of the right format |
| Details | Very long business name or USP | Auto-fit → wrap → roomier layout → asks to shorten (never cut silently) |
| Details | Too many USPs for the format | Warning + carousel offer |
| Details | Mixed scripts (Hindi + English), RTL (Arabic, Urdu) | HarfBuzz shaping; numbers and phone spans stay left-to-right |
| Design | No logo | Text logo from the name, in the brand font |
| Design | Low-resolution or white-background logo | Warning; auto-remove plain white background when safe |
| Design | Brand colour too close to background / text | Contrast rule picks the next brand colour or adds a scrim |
| Design | Photo dark, blurry, or with people | Usable check (exists); people → consent reminder |
| Design | QR on a busy photo | QR always on a light plate with a quiet zone |
| Schedule | Owner in another time zone / DST change | Slots stored in UTC, shown in the owner's zone (v2) |
| Schedule | Post approved after its slot passed | Offered "post now" or next slot |
| Schedule | Festival post approved after the festival | Not delivered; marked expired |
| Account | Owner deletes account | All rows, files and imported posts removed (exists, Req 22) |
| Cost | Owner regenerates many times | Per-week caps with a plain message (exists) |

## 7. Non-functional

- **Speed:** a post's 3 design options in under 15 s; a format render under 1.5 s.
- **Cost:** under $0.50 AI cost per owner per week for text and images (cap enforced); one-off imports under $0.05; video (Veo) is opt-in, priced per clip and shown before it runs.
- **Privacy:** read only public pages and public business posts, only when the owner asks; third parties used: Google Cloud (Vertex AI, Speech, Translation, BigQuery, Storage, Run), Jina Reader (JS sites), Meta (Business Discovery, publishing), YouTube Data API, Resend; listed in the privacy text. Publishing tokens encrypted at rest; payment IDs never touched by AI.
- **Security:** row-level security on every table, scoped by brand; signed no-login links that never act on GET; secrets only in env.
- **Accessibility:** WCAG AA contrast in the app and on posts; keyboard use; screen-reader labels.
- **Languages:** UI in English first; posts in 20+ languages with Noto fonts.

## 8. Tech stack

**Product (runtime).** The competition suggests Google Cloud; we use it wherever it fits and keep what already works where it doesn't.

| Need | Google Cloud | Use in the product | Status |
|---|---|---|---|
| Text AI | **Gemini on Vertex AI** | Fact extraction, brief from text or voice, captions, style reading from images, fact-check, review replies | In use |
| Images | **Imagen (Vertex AI)** | Abstract theme backgrounds and textures only (never products, people or text) | New |
| Video | **Veo (Vertex AI)** | Animated versions of posts for Reels, Shorts and Status (stretch, opt-in) | New, stretch |
| Voice in | **Speech-to-Text (Chirp)** | Owner describes a post by voice in any language | New (today Gemini transcribes) |
| Voice out | **Text-to-Speech** | Tween's optional voice; voice-over for animated posts | New |
| Languages | **Cloud Translation** | App interface in more languages, with a glossary so brand names and prices stay untouched. Captions are written in the target language by Gemini | New |
| Analytics | **BigQuery** | Scans, clicks, approvals and publish results per post, USP kind, theme and channel; what works for similar businesses | New |
| Media | **Cloud Storage** | Photos, renders, videos, mascot files; signed public URLs for auto-publishing | Move from Supabase Storage (small change behind our storage interface) |
| App and APIs | **Cloud Run** + **Cloud Scheduler** | The Next.js app, publishing and render workers; the queue sweep | Move from Vercel (container build, about 1-2 days) |
| Database, sign-in | Supabase Postgres (row-level security) | Keep: connected and tested. Option: Cloud SQL for PostgreSQL later (same SQL, about 2-3 days) | Keep |
| Email | Resend | Keep (Google Cloud has no email-sending service) | Keep |
| Rendering | HarfBuzz + resvg + Noto fonts | Text, logos and QR codes always drawn by code | In use |

**How it is built (AI development)**

Claude Code with an orchestrator (Opus) that plans, owns the schema and prompts and reviews; builder agents (Sonnet) implement one task at a time with tests; helper agents (Haiku) for data, docs and test runs. Every task is checked against this PRD's acceptance criteria before it is marked done.

*Competition:* the suggested technologies are Google Cloud (Gemini, Imagen, Veo, Speech-to-Text, Text-to-Speech, Translation, BigQuery, Cloud Storage, Cloud Run); the table above maps each to a real use.

## 9. Acceptance criteria (headline)

| # | Criterion |
|---|---|
| 1 | Path B: a new owner with no website makes a finished, correct post in under 5 minutes (timed, 5 testers) |
| 2 | Path A: website URL or @handle → profile pre-filled with sourced facts and a suggested brand kit in under 90 s |
| 3 | 100% of numbers, dates, contacts and ratings on posts trace to the brief or profile; planted false facts are flagged ≥ 95% |
| 4 | Every post passes contrast, safe-zone and no-overflow checks in all its formats (automated, 200 random briefs) |
| 5 | QR codes scan on 3 phones from 30 cm at the minimum size; scans are counted |
| 6 | Queue delivers exactly one post per slot, never after a post's end date, across time zones and DST |
| 7 | "Keep my look": 4 of 5 owners say the suggested kit matches their current posts |

## 10. Reuse from v2 (already built)

| Exists | Reused for |
|---|---|
| Website reader with sourced facts, JS-site reader (W-1) | D-2 |
| Instagram import by @handle (I-1, in progress) | D-2, G-2 |
| Brand memory, facts, voice, photos with usable check | D-4, B-5 |
| Guardrail (code + AI), regulated rules, repetition | B-2, C-2, C-3 |
| Renderer (HarfBuzz, Noto, 3 formats, safe zones), Tween | G-4, G-5 |
| Weekly generation, approvals by link, reminders, share kit, short links, check-ins, export/delete, cost caps | S-1 to S-6, R-1, R-2 |
| Supabase backend, desktop-first layout (L-1, in progress) | All |

**New for v3:** path choice and Path B questions; USP library and the brief editor (B-1 to B-8); contact blocks and QR; style learning and brand kit (G-1 to G-3); theme set and 3 options; YouTube import; queue with cadence and one-at-a-time delivery; expiry; extra formats.

## 11. Decisions and open questions

**Decided (2026-10-14):** Google Cloud stack as in section 8; auto-publishing preferred, Instagram + Facebook first; international market; QR codes for links (tracked) and payments (UPI first, more by country).

**Open:**
1. Move hosting to Cloud Run and media to Cloud Storage now (about 2-3 days together), or after the core v3 features?
2. Veo animated posts: in the competition demo (opt-in, priced per clip) or later?
3. One Meta app serves Instagram import (Business Discovery) and publishing; its App Review should request both at once.
4. Competition deadline and demo format.
5. Product name.
