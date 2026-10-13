# Stage 6: PRD — WhatsApp-first Indian-language content assistant for SMBs

Working name: **PostMitra** (placeholder). Type: software feature, so this spec is a PRD.

Stack assumed (Stage 4): Next.js on Vercel, Supabase (auth, Postgres, storage), an LLM API, a speech-to-text API with Indian-language support, WhatsApp Business Cloud API via Meta or a BSP (e.g. Gupshup, Interakt).

## 1. Problem statement

Small business owners in India (shops, clinics, salons, coaching centres, restaurants) know they need a regular social presence but have no time, design skill or marketing know-how. Existing AI tools are English-first, priced in USD and built as dashboards, while these owners work from a phone, mostly inside WhatsApp, and their customers respond best to Hindi, Hinglish or a regional language. The result is irregular, inconsistent posting with no link to enquiries (US-1 to US-9).

## 2. Objective

Let an SMB owner turn a photo, a line of text or a voice note into ready-to-post, on-brand content in their customers' language, in under a minute, and know which posts bring enquiries.

## 3. Goal

| Measure | Target |
|---|---|
| Photo/voice input to finished posts | Under 60 seconds |
| Posts used with light or no edits | 70% or more |
| Language quality, rated by native speakers | 4/5 or higher for Hindi, Hinglish and English |
| Pilot: SMB owners onboarded | 20 |
| Pilot: owners still creating posts in week 3 | 60% or more |
| Eligible pilot brands that adopt a mascot | 50% or more; mascot posts get more clicks than non-mascot posts |
| Business goal | Proof that SMBs adopt it weekly, as a base for paid plans and the agency wrapper |

## 4. Scope (MVP)

- Mobile-first web app: sign-in, brand setup, create, review/edit, download/share, history.
- Brand memory captured through a short chat or a voice note.
- Weekly plan of suggested posts using an Indian festival and occasion calendar.
- One input becomes posts for Instagram feed, Instagram/WhatsApp status, Facebook and Google Business Profile text.
- Languages: Hindi (Devanagari), Hinglish (Roman script), English.
- Template-rendered images with brand colours, logo and Indian-script fonts.
- Basic photo clean-up.
- Facts-only guardrail.
- No-login approval link for a second person.
- Click-to-WhatsApp tracked link per post and a simple weekly summary.
- WhatsApp layer: send input to a business number, receive finished posts.
- Brand mascot: for eligible brands, a custom character created once and reused across posts as the face of the brand.

## 5. Future scope / out of scope

| Item | Status |
|---|---|
| Auto-posting to Instagram/Facebook via Meta APIs | Future |
| More regional languages (Tamil, Bengali, Marathi, Telugu...) | Future (not committed for MVP; one may be added as a stretch only after R1-R15 are done) |
| Agency multi-brand workspace UI (option C) | Future; data model supports it now (R14) |
| Brand/distributor-funded plans (SOL-4) and payments | Future |
| Google Business Profile review replies (US-7) | Out of scope |
| Video creation and editing | Out of scope |
| Animated or voiced mascot, mascot stickers and merchandise | Future |
| AI product shoots (US-34), UGC/rights (US-33) | Out of scope |
| Full multi-touch attribution, ROAS/CAC (US-37) | Out of scope |
| Stories deferred in the QA map (US-7, 10, 11, 16, 17, 19, 20, 21, 28-38): marketer, agency and D2C features | Out of scope for MVP; backlog for the agency and D2C wrappers |

## 6. Requirements

| # | Requirement | Stories |
|---|---|---|
| R1 | Owner signs in with phone number and OTP on a mobile web app. | US-3 |
| R2 | Brand setup by chat or voice note captures: business name, category, city, key products/services and prices, audience, tone, languages, script (Devanagari or Roman Hinglish), logo, brand colours, WhatsApp contact. All fields are editable later. Voice notes are transcribed in Hindi and English. | US-3, 4, 5, 12 |
| R3 | The system proposes a weekly plan of 3-5 post ideas, using brand memory, the owner's goal (footfall, enquiries, an offer) and an Indian festival/occasion calendar for the coming week. Each idea has a suggested posting day; owners who opt in get a WhatsApp reminder that day (F1). | US-1, 2, 10 |
| R4 | From one input (photo, text or voice note), the system creates a set of outputs: Instagram feed post (1:1), status/story (9:16), Facebook post, Google Business Profile update text. Each has a caption, a CTA and hashtags where relevant. | US-3, 6, 13, 15, 23, 24 |
| R5 | Output language and script follow the brand setting; the owner can switch any output to Hindi, Hinglish or English in one tap. | US-5, 16, 36 |
| R6 | Images are built from at least 3 templates per format, using brand colours, logo and the owner's photo. All text on images is rendered by code with Indian-script fonts (e.g. Noto), never generated inside the AI image. | US-4, 12, 39 |
| R7 | Uploaded photos get automatic crop, brightness correction and optional background removal. | US-4 |
| R8 | Facts-only guardrail: prices, discounts, dates, timings, phone numbers and claims appear only if present in the input or brand memory. Anything else is marked for the owner to confirm before download. Health, finance and education claims get an extra warning. | US-14 |
| R9 | Review screen lets the owner edit text, regenerate, change template, switch language, then download images or share straight to WhatsApp. | US-14, 22 |
| R10 | Owner can send a no-login approval link to a helper or manager, who can approve or comment per post. Status (pending, approved, changes requested) shows on the owner's screen. A "Nudge" button resends the link to the approver via WhatsApp share (F2). | US-11, 20, 22, 25 |
| R11 | Each post includes a click-to-WhatsApp short link with a post code. The app counts clicks per post and shows a weekly summary: posts made, clicks, top post. The summary can be shared as an image or a no-login link (F3). | US-8, 9, 18, 26, 27 |
| R12 | WhatsApp layer: the owner sends a photo, text or voice note to the business number and receives finished images, captions and a review link. The weekly plan is sent as an approved template message, only to owners who opt in. | US-6 |
| R13 | All created posts are stored per brand with date, language and status, and can be reused. | US-13 |
| R14 | Data model supports a user belonging to several brands and a brand having several users, so the agency wrapper needs no migration. | US-21 |
| R15 | Brand mascot. (a) An eligibility check uses category, audience and tone from brand memory; regulated or formal brands are not offered a mascot by default. (b) Eligible owners get 3 mascot concepts based on their business, city and audience, and pick one. (c) The chosen mascot is a parametric SVG character (Duolingo-style), defined once and saved to the brand; a character sheet of at least 8 poses/expressions is drawn from that one definition as transparent SVG/PNG. (d) Templates place mascot poses in posts, with speech bubbles rendered by code. (e) The owner can switch the mascot on or off per post and regenerate the sheet. (f) The owner owns the mascot; this is stated in the terms. (g) Real-person likeness, religious and political figures, and close copies of known brand mascots are blocked. | US-40, US-4, US-12 |

## 7. Acceptance criteria

| # | Criteria |
|---|---|
| R1 | New owner signs in on a phone browser in under 1 minute; returning owner stays signed in for 30 days. |
| R2 | Setup completes in 5 minutes or less by chat or one voice note; a Hindi voice note produces a correct profile for review; every field can be edited. |
| R3 | Plan appears in under 15 seconds with 3-5 ideas; at least one idea references an upcoming occasion when one falls in the week; reminders reach only opted-in owners on the suggested day. |
| R4 | One input produces all 4 outputs in under 60 seconds; each output fits its format size. |
| R5 | Switching language regenerates the text in under 10 seconds; native speakers rate output 4/5 or higher on a 30-post test set. |
| R6 | No misspelled or broken characters in rendered Devanagari text across the test set; logo and colours match brand settings. |
| R7 | A dim test photo is visibly brighter and cropped to the format; background removal can be undone. |
| R8 | On a test set with planted made-up prices, 100% of unsupported facts are flagged; download is blocked until the owner confirms or removes them. |
| R9 | Edits save instantly; "share to WhatsApp" opens WhatsApp with image and caption on Android. |
| R10 | Link opens without login on any phone; approval status updates on the owner's screen within 10 seconds; Nudge opens WhatsApp with the link pre-filled. |
| R11 | Each click is counted against the right post; the weekly summary matches the raw click log; the shared summary opens without login and shows the same numbers. |
| R12 | Sending a photo to the number returns finished posts in under 90 seconds; weekly template message reaches only opted-in owners. |
| R13 | Owner can find and re-download any past post by date or language. |
| R14 | A test user can switch between two brands with fully separate data. |
| R15 | Eligibility gives the expected yes/no on a 20-brand test set; 3 concepts appear in under 60 seconds; reviewers recognise the same character across all 8 poses; mascot appears correctly in every template; prompts naming a celebrity or religious figure are refused. |

## 8. Edge cases and risks

| Case | Handling |
|---|---|
| WhatsApp API approval or Meta verification is delayed | Web flow is complete without it (R1-R11); demo uses web + share-to-WhatsApp |
| Owner messages after 24 hours | Only an approved template can start the conversation; otherwise wait for the owner's next message |
| Meta policy on AI chatbots | Keep the bot task-specific (content creation for the business); confirm current policy before launch |
| Voice note in an unsupported language or noisy | Ask the owner to retry or type; never guess facts from a bad transcript |
| Very poor or irrelevant photo | Suggest a text-only design template instead |
| Owner gives no prices or offer | Create brand/awareness posts without numbers |
| Regulated categories (clinics, coaching, finance) | Warn on claims such as "guaranteed results" or "cure"; owner must confirm |
| Wrong script for the audience | Script is a brand setting and can be switched per post |
| Helper approves something the owner didn't want | Owner sees every approval and can revoke before sharing |
| Costs: LLM, speech-to-text, WhatsApp messages | Cap generations per brand per day in the pilot; send weekly plan only on opt-in |
| Owner drops off after week 1 | Weekly plan nudge (opt-in) and a 10-minute weekly routine design |
| Mascot looks different from post to post | Never regenerate per post; only reuse the saved character sheet |
| Mascot resembles another brand's character | Similarity check at creation; owner confirms; regenerate if flagged |
| Owner dislikes or outgrows the mascot | Turn it off or regenerate; old posts stay unchanged |
| Owner leaves PostMitra | They keep their mascot images; new poses need PostMitra |
| Personal data (phone numbers, photos) | Consent at sign-up; store in Supabase with row-level security; delete on request (DPDP Act) |

## 9. Changes elsewhere (blast radius)

This is a new product, so nothing existing breaks. What it touches:

| Area | What changes |
|---|---|
| Meta / WhatsApp | Business verification, a dedicated WhatsApp number, template approvals, a BSP account and per-message billing |
| External APIs | LLM, speech-to-text (Indian languages), background removal; each adds cost and a failure point |
| FigitalLabs | Owner for the pilot (onboarding 20 SMBs, support on WhatsApp); API keys and billing; whether it joins the product roadmap after the hackathon |
| Legal | Privacy notice and consent; terms on owner responsibility for published claims |
| Assets | Licensed fonts (Noto is open licence), template designs, festival calendar data |
| Mascot | An SVG character rig drawn by code (no image model); LLM cost for concepts only, once per brand; terms stating owner IP |

## 10. Build order (hackathon)

1. Week 1: R1, R2, R4, R5, R6 (core engine and web flow).
2. Week 2: R3, R7, R8, R9, R13, R14, R15 (mascot: generate sheet and place in templates).
3. Week 3: R10, R11, R12 (WhatsApp layer) and demo with pilot owners.
