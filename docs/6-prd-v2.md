# Stage 6: PRD — Weekly brand-memory content assistant (global version)

Status: **Final** (Stage 7 QA fixes applied 2026-10-13). Working name: TBD. Type: Software feature. Build window: 2-4 weeks. Stack: Next.js on Vercel + Supabase + LLM API.

## 1. Problem statement

Small business owners and founders worldwide know they should post regularly, but they don't know what to post, have no time or design skills, and can't tell whether posting brings customers (US-1, 2, 3, 8). Their posts look inconsistent and rarely sound like them (US-4, 5). Existing AI post tools produce generic copy that needs heavy editing, depend on the owner coming back to a dashboard, and fail when auto-posting (Stage 3). Owners typically give up after 2-3 weeks (US-6), and fear paying for something with no visible result (US-9).

## 2. Objective

Every week, deliver to the owner's inbox a ready set of on-brand posts, built from their real business facts, photos and voice, that they can approve and share in about two minutes, and show them honestly whether it is working.

## 3. Goal

| Level | Measure | Target |
|---|---|---|
| Hackathon demo | Website URL (or 5 answers) to a week of ready posts, live | Under 3 minutes end to end |
| Pilot (3-5 owners, 3 weeks) | Posts approved with no or light edits | 60% or more |
| Pilot | Weekly emails acted on (approve, edit or skip) | 2 of 3 weeks per owner |
| Pilot | Time to review a week of posts | Under 5 minutes |
| Pilot | Blind test vs. a generic AI tool | Owners prefer ours in at least 3 of 5 cases |
| Business | Owners still approving posts in week 3 | Leading signal for retention and willingness to pay |

## 4. Scope (MVP)

- Sign-up by email magic link; one business per account.
- Brand memory from the owner's website (optional), a 5-question setup, and 3-5 uploaded past posts or photos.
- Country and region, plus owner-added dates, for occasions.
- Weekly plan of 3-5 posts tied to a goal the owner picks (enquiries, footfall, awareness).
- For each post: caption, hashtags, suggested channel (Instagram, Facebook, LinkedIn, Google Business Profile post text), and an image built from the owner's photo in a branded template.
- Weekly email with all posts; approve, edit or skip through one no-login link.
- One-tap share on mobile and download on desktop. No auto-posting.
- Short trackable link per post, plus a one-tap weekly check-in on enquiries.
- Fact guardrail and regulated-category handling.
- Simple web dashboard: brand memory, this week's posts, history, results.

## 5. Future scope / Out of scope

| Item | Status |
|---|---|
| Auto-posting via Buffer or Meta APIs | Future |
| Google Business Profile API (profile updates, posting, review sync) | Future. Copy-paste review replies are in as stretch Req 26 |
| WhatsApp delivery | Out (PostMitra covers it; keep the two separate) |
| Multiple businesses or locations, agencies, team approvals | Out (other personas) |
| Video generation, AI product photos | Out |
| Paid plans, billing | Future; pilot is free |
| Full multi-language UI | Out; post language is a setting (default English) |
| Personas other than SMB owner (US-10 to US-39) | Out of this version |

## 6. Requirements

### Setup and brand memory
1. The owner signs up with email (Supabase magic link). No password.
2. Setup asks for: business name, what they sell, who their customers are, location (country, region, city), goal, tone (3 options plus "like my past posts"), post language, roughly how many minutes a post usually takes them today, and an optional website URL.
3. If a website URL is given, the system reads up to 5 public pages (home, about, menu or services, contact), respecting robots.txt, and extracts business facts: offers, prices, hours, address, phone, and differentiators.
4. The owner uploads 3-5 past posts (screenshots or text) and/or photos. Photos are stored in Supabase Storage.
5. The system builds a **brand memory** record: facts (each with its source), voice description, example phrases, words to avoid, colours and logo (if found or uploaded), and photo library. The owner can view and edit every field.
6. If the website is missing or unreadable, setup continues without it, using the answers and uploads only.

### Weekly plan and posts
7. Each week (Vercel Cron, owner-chosen day and time in their timezone), the system generates 3-5 posts in one LLM call, using brand memory, the goal, upcoming occasions (public holiday dataset by country plus owner dates), and past performance.
8. Each post contains: a caption in the owner's voice, 3-8 hashtags, a suggested channel, a call to action matched to the goal, and a short link where the channel allows clickable links.
9. Each post image is composed server-side from an owner photo in a branded template (logo, colours, short text overlay). AI-generated images may be used only as abstract backgrounds, and never to depict the owner's products, premises or people.
10. Channel formats: square (Instagram/Facebook feed), vertical (Instagram/Facebook Stories and messaging status such as WhatsApp and Messenger), and landscape (LinkedIn/Google Business Profile).

### Guardrails
11. Posts may only state prices, offers, hours, claims and contact details found in brand memory. Any other factual claim is flagged as "please check" in the email and dashboard.
12. Businesses in regulated categories (health, finance, alcohol, legal, and similar, chosen at setup or detected) get a stricter prompt with no outcome promises, and a visible reminder to check local advertising rules.
13. Captions are checked against brand memory's "words to avoid", and for repeated phrasing within the last 4 weeks.

### Weekly email and approval
14. The weekly email shows every post (image and caption) with Approve, Edit and Skip buttons. Each button opens a signed, expiring no-login link.
15. Edit lets the owner change the caption, swap the photo or ask for a rewrite with a short instruction ("less salesy"). Instructions are saved to brand memory as voice feedback.
16. Approved posts appear in a "ready to share" page reachable from the email.

### Sharing
17. On mobile, each approved post has a one-tap Share button (Web Share API with image and caption), which reaches social apps and messaging status (WhatsApp, Messenger). On desktop, Download image and Copy caption.
18. The owner can mark a post as "Posted".

### Measurement
19. Short links (`/r/[code]`) redirect to the owner's chosen destination and log clicks by post.
20. The weekly email includes a one-tap check-in: "Did posts bring enquiries this week?" (None / A few / Many).
21. The dashboard and email show a plain-language summary: posts shared this month vs. last month, clicks per post, check-in answers, estimated time saved (posts shared x the owner's minutes-per-post answer from Req 2), and a line stating what is **not** measured (DMs, calls and walk-ins are counted only through the check-in).

### Data, privacy and cost
22. The owner can export or delete their account and all data (photos, brand memory, posts) from settings.
23. LLM calls are limited to one batch per week plus edits; image generation is limited per week. Usage is logged per account.
24. All emails include an unsubscribe and pause option.

### Follow-through
25. If approved posts are not marked "Posted" within 3 days, the system sends one short reminder email with their share links. At most one reminder per week.
26. *(Stretch)* Review replies: the owner pastes a customer review and gets a reply in their voice to copy into Google or another site. No Google API. Facts in replies follow Req 11.

## 7. Acceptance criteria

| Req | Criterion |
|---|---|
| 1 | Owner receives a magic link and lands in setup within 1 minute |
| 2, 6 | Setup completes with no website in under 5 minutes |
| 3 | For a test site, at least 80% of listed facts are extracted correctly; robots.txt disallow is respected |
| 4, 5 | Brand memory shows every fact with its source; edits persist |
| 7 | Cron generates a week's posts at the scheduled local time for test accounts in at least 3 time zones |
| 8, 10 | Each post has all fields and images in all 3 formats; the vertical format fits Stories and messaging status |
| 9 | No generated post depicts the owner's products or premises using AI imagery (manual review of 50 posts) |
| 11 | In a test set of 30 posts, every price, offer or hour matches brand memory, or is flagged |
| 12 | Regulated-category posts contain no outcome promises (manual review of 20 posts) |
| 13 | No caption repeats a phrase of 6+ words from the previous 4 weeks |
| 14 | Email renders in Gmail and Outlook (web and mobile); links work without login and expire after 14 days |
| 15 | Rewrite with instruction returns within 15 seconds; instruction appears in brand memory |
| 17 | Share opens the native share sheet with image and caption on iOS Safari and Android Chrome, and WhatsApp status is reachable from it |
| 19 | Clicks are logged within 1 minute; the redirect adds no more than 300 ms |
| 20, 21 | Check-in answer recorded in one tap; summary shows month-over-month posts shared, estimated time saved, and the "not measured" line |
| 22 | Deleting an account removes all rows and storage objects |
| 23 | Generation cost per account per week is logged and stays under the agreed cap (target: under $0.50) |
| 25 | A test account with approved but unposted posts receives exactly one reminder 3 days later; none if all are marked Posted |
| 26 | A pasted review returns a reply within 10 seconds, in the owner's voice, with no facts outside brand memory |
| Demo | Website URL to finished week of posts in under 3 minutes, live |

## 8. Edge cases, risks and exceptions

| Case | Handling |
|---|---|
| No website, or website blocks reading | Continue with answers and uploads (Req 6) |
| Owner uploads no photos | Use text-only branded templates; nudge for photos in the email |
| Owner never opens the email | After 2 missed weeks, send a shorter "3 posts, 1 tap" email; after 4, pause and ask whether to continue |
| AI states an unverified fact | Flag it (Req 11); never auto-approve |
| Regulated business not detected | Owner can set the category in settings; default to cautious wording for health-like terms |
| Email lands in spam | Authenticate the sending domain (SPF, DKIM, DMARC); plain-text fallback |
| Approval link forwarded to someone else | Links are signed per post and expire; actions are logged |
| Upcoming holiday is sensitive (for example, a day of mourning) | Holiday list marks such days; posts for them are respectful or skipped |
| LLM outage or timeout | Retry once; if it still fails, send the week's email late with a notice, never a partial set without saying so |
| Caption too long for a channel | Trim to the channel limit and keep the call to action |
| Owner's photos contain other people | Remind the owner to have consent; no face recognition |
| Cost spike from heavy editing | Per-account weekly cap on rewrites (Req 23) |

## 9. Changes elsewhere (blast radius)

| Area | Change | Risk |
|---|---|---|
| Vercel | New project, separate from PostMitra. Cron for weekly generation | Shared account limits; confirm which Vercel login to use |
| Supabase | New project (not PostMitra's): auth, tables for business, brand memory, posts, links, clicks, check-ins; Storage for photos | Mixing with PostMitra data if a project is reused |
| Email | New vendor for sending (for example, Resend), plus DNS records on a sending domain | Deliverability; needs a domain you control |
| LLM provider | API key and per-account usage logging | Cost overrun; rate limits during the demo |
| Holiday data | Public holiday API or bundled dataset | Coverage gaps for some regions; owner dates fill them |
| Privacy | Stores emails, photos and business data from multiple countries | Needs a privacy notice, deletion (Req 22) and consent for photos of people |
| PostMitra | None, by design | Two similar SMB products. Keep the positioning distinct: global, email, web |

## 10. Build sequence (2-4 weeks)

| Week | Deliver | Reqs |
|---|---|---|
| 1 | Sign-up, setup, website reading, uploads, brand memory view and edit | 1-6 |
| 2 | Weekly generation, image templates, guardrails | 7-13 |
| 3 | Weekly email, no-login approval and edit, share and download, posting reminder | 14-18, 24, 25 |
| 4 | Short links, check-in, summary, export and delete, cost caps; review replies if time allows; pilot with 3-5 owners; demo polish | 19-23, 26 |

If the window is 2 weeks: generation runs on demand (button) instead of Cron; short links, the check-in, the reminder and review replies move to stretch; the email is the demo's centrepiece.
