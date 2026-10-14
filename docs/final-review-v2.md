# Final review: v2 against every acceptance criterion (V-24)

Date: 2026-10-13. PRD: [6-prd-v2.md](6-prd-v2.md). Plan and hardening list: [8-build-plan-v2.md](8-build-plan-v2.md).

**How this was checked:**
- **Automated:** 112 test files, 2,503 tests, green on two full runs in a row; typecheck, lint (no warnings) and build pass. Hardening H-1 to H-4 and H-9 to H-13 are fixed; H-5 to H-8 need real accounts or are polish.
- **Live with Gemini:** scripts in `scripts/live-*.mts` and `scripts/eval-*.mts`. Each run stayed under the $0.50 approval line; about $1.60 in total.
- **Browser:** a full pass in the app's browser on the local dev server, with the local stand-ins for Supabase and email.

**Status key:** **Pass**: the AC is met and proven. **Pass (local)**: met against the local stand-ins; the real service is not connected yet. **Manual**: needs a person or a real device or account. **Gap**: not met yet.

| Req | Acceptance criterion | Evidence | Status |
|---|---|---|---|
| 1 | Magic link lands in setup within 1 min | V-2/V-3. Browser pass: link to Continue to /setup in about 1.3 s warm. Scanner-safe Continue step; single use; 15-minute expiry. Same flow verified on real Supabase (D8) | Pass. Real email delivery needs Resend |
| 2, 6 | Setup completes with no website in under 5 min | V-3: 10 short screens (about 3 minutes for a person). Browser pass done; the website read never blocks | Pass |
| 3 | 80% of listed facts extracted; robots.txt respected | Live end to end with the real reader: 22/22 and 23/23. The robots-blocked site fetched only robots.txt. SSRF protection: 103 tests | Pass |
| 4, 5 | Every fact shown with its source; edits persist | V-6: source badge, page link and quote per fact. Edits survive reloads and re-reads (the owner's edit wins) | Pass |
| 7 | Cron generates at local time in 3+ time zones | V-10: London, New York and Kolkata, including DST weeks (fake clock). Hourly sweep and "Generate now" | Pass. Vercel Cron not deployed yet |
| 8, 10 | All fields; images in 3 formats; vertical fits Stories/status | Live demo: 4 posts, 12 images (1080², 1080×1920, 1200×630); story safe zones tested | Pass |
| 9 | No AI imagery of products or premises | No AI image generation anywhere (D5). Owner photos or code-drawn designs only | Pass by design (manual 50-post review not needed: no AI images exist) |
| 11 | Every price, offer or hour matches brand memory or is flagged | Live eval through `runGuardrail`: 27/27 planted facts caught; 2 cautious false positives. The business name and location from setup count as facts, so they are not flagged | Pass |
| 12 | Regulated posts contain no outcome promises | Live: 12/12 promises flagged, 0 on clean posts. Prompt rules per group; reminder on every regulated post | Pass (manual 20-post review recommended once) |
| 13 | No 6+ word phrase repeated from the previous 4 weeks | 20/20 cases incl. Hindi; one automatic rewrite, then a flag | Pass |
| 14 | Email renders in Gmail/Outlook; links work without login, expire in 14 days | Links: tested at 13 d 23 h (works) and 14 d 1 min (refused); they never act on GET. HTML built to email-safe rules with a lint test | Links: Pass. Rendering in real clients: Manual (`docs/email-checklist.md`, needs a sending domain) |
| 15 | Rewrite with instruction under 15 s; instruction saved | Live: 8.1 s and 7.5 s; both instructions in `voice_feedback`. A missing fact is not invented | Pass |
| 17 | Native share sheet with image and caption on iOS/Android; WhatsApp status reachable | Share code tested with a mocked browser. Browser pass: ready page script runs, Download gives a real PNG, the copy fallback works | Manual (real phones, checklist). Share is hidden where the browser can't share files (H-11, fixed) |
| 19 | Clicks logged within 1 min; redirect adds 300 ms or less | Handler p95 3.4 ms (local); click visible immediately; bots and prefetch not counted | Pass (local) |
| 20, 21 | One-tap check-in; month-over-month, time saved, "not measured" line | V-19 tests incl. time-zone month edges; the email summary line; browser pass shows the empty state and "not counted" line | Pass |
| 22 | Delete removes all rows and storage | V-20: schema-driven test: 0 rows in every table, 0 files in every bucket, no auth user. Export ZIP verified. On real Supabase: integration tests plus a browser pass deleted the account to 0 auth users, 0 rows and 0 files | Pass |
| 23 | Weekly cost logged and under cap (under $0.50) | Heavy week simulated at $0.17; all caps maxed at $0.29. Live demo account: $0.027 a week. Failed and retried AI calls are costed too (H-2) | Pass |
| 25 | Exactly one reminder 3 days after approval; none if posted | V-17: fake-clock tests at 71.9 h, 72 h and after; retries; never for paused, unsubscribed or posted | Pass |
| 26 | Review reply under 10 s, in voice, no outside facts | Live: 1.7-4.9 s; serious reviews flagged for attention; promises of refunds or free items flagged | Pass |
| Demo | Website URL to a finished week of posts in under 3 min | Live: 51-76 s from website read to 4 fact-checked posts, 12 images and the weekly email | Pass |
| Extra | Mascot (owner decision) | 20/20 eligibility; 17 blocked hints with no AI call; one consistent character in 8 poses (checked by eye); bubble fact-checked | Pass |

## Before the pilot (needs the owner or real accounts)

1. **Supabase project:** connected and working (2026-10-13). Migrations 0001-0012 and 5 private buckets applied; RLS on all 26 tables. The app runs on it end to end (H-7): sign-in, setup, a week generated in under 84 s, images from storage, account delete to zero rows and files. Before real owners: reset the database password and keys (they were shared in chat), turn off public sign-ups in Supabase Auth, and see H-14 to H-16.
2. **Vercel project:** deploy; add `vercel.json` crons (hourly `/api/cron/weekly` and `/api/cron/reminders` with `CRON_SECRET`); set the env vars from `.env.example`.
3. **Resend and a sending domain:** set up SPF, DKIM and DMARC, then run `docs/email-checklist.md` (Gmail and Outlook rendering, real-phone share sheets).
4. **Dedicated Google Cloud project for Gemini (H-6):** the shared project stalled or failed on about 1 in 5 calls during the build. Retries and time limits contain it, but a dedicated project will make the weekly email reliable.
5. **Lawyer review** of the terms and privacy draft (`/terms`).
6. **Pilot checks the PRD asks for with real owners:** the blind test against a generic tool, and the "60% approved with light edits" goal. Edits are measured against `posts.original`.

## Demo script (about 5 minutes)

1. **Sign in** (30 s): enter an email, open the link from the inbox, press "Continue". Point out that scanners can't use the link.
2. **Setup** (1 min): business name, what you sell, customers, location (auto-detected), goal, tone, language, minutes per post, website URL, email day. Done: "We read 4 pages and found 22 facts."
3. **Brand page** (45 s): facts with "From your website" and the quote; edit a price; words to avoid; the mascot card.
4. **This week** (1 min): press "Generate this week's posts", about 30-60 s. Show 4 posts in 3 formats. Show a "Please check" flag on an invented claim, confirm or remove it, then Approve.
5. **The email** (1 min): the dev outbox shows the weekly email. Open "Edit", rewrite with "shorter and less salesy" (about 8 s), approve, then open the ready page: Share on a phone, Download and Copy on a laptop, "Mark as posted".
6. **Results** (30 s): the one-tap check-in, the "not counted" line, and "Reply to a review" with a pasted complaint.
7. **Close:** cost about $0.03 per owner per week; nothing is posted without the owner's tap.
