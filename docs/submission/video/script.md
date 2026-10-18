# Demo video script: Weekly Posts (AI Builder Cup, JAPAC)

Team **zerochills**. Product **Weekly Posts**. No other company name or branding appears anywhere in the video.

| | |
|---|---|
| Target length | 3:00 to 3:15 (hard max 3:30). Narration plus the fixed 16.5 s setup clip comes to about 3:07; live actions may add a few seconds. |
| Narration | 415 words, 15 scenes, about 2,300 characters (inside the Text-to-Speech free tier) |
| Voice | Google Cloud Text-to-Speech, Chirp 3 HD, **`en-IN-Chirp3-HD-Aoede`** (Indian English, female). Alternative: `en-IN-Chirp3-HD-Charon` (male). `languageCode` en-IN, `speakingRate` 1.0 |
| Machine-readable version | `docs/submission/video/scenes.json` (same narration, exact steps) |
| Live app | https://weekly-posts-526531409571.australia-southeast1.run.app |
| Demo brand | **Corner Cup Café**, Pune (fictional), set up on the live app in scene s02b. Face: **Tween**, the code-drawn mascot. No AI Brand Face, no payment QR, no phone or WhatsApp number. |

## Scene list

Times are from the narration length (words / 140 per minute, plus 0.6 s); s02b is the recorded clip cut at 66 s and played at 4×. Live scenes stretch if their actions take longer.

| # | Start | Length | Type | What is on screen | Depends on |
|---|---|---|---|---|---|
| s01 | 0:00 | 12 s | Card | The problem, 2 sourced numbers | |
| s02 | 0:12 | 10 s | Card | The idea: details first, then design | |
| s02b | 0:22 | 16.5 s | Live (recorded, 4×) | Setup wizard → Brand page → Face: Tween, "Use the mascot in my posts" | |
| s04 | 0:38 | 15 s | Live (sped up) | Create a post: type the offer, "Fill in the details", post type | |
| s05 | 0:53 | 12 s | Live | "On the post": email stays, opening hours off | |
| s06 | 1:05 | 12 s | Live (sped up) | Design Studio opens with 5 starting designs | |
| s07 | 1:17 | 12 s | Live (sped up) | Pick a design, change font pair, words panel, "Use this design" | |
| s08 | 1:29 | 15 s | Live (sped up) | Review: owner adds a claim, "Please check" flag, fix, approve | |
| s09 | 1:44 | 10 s | Live | Schedule: pick a time later today on the calendar, Confirm | |
| s10 | 1:54 | 16 s | Live (separate take, 4×) | Queue card goes Scheduled → Sent to you live, no reload | firebase |
| s11 | 2:09 | 10 s | Card | Firestore rule, code view, and the custom token | firebase |
| s12 | 2:20 | 12 s | Live (sped up) | Plan a week from one sentence | |
| s13 | 2:32 | 13 s | Card | Architecture | |
| s14 | 2:45 | 14 s | Card | Guardrails and measured facts | |
| s15 | 2:59 | 8 s | Card | End card: live URL, team zerochills | |

---

## s01. The problem (card, 0:00, 12 s)

**On screen:** kicker "The problem"; title "Posts every week. No designer. No time."; subtitle "Small shops and cafés need regular, truthful posts."; bullets: "Only 13% of Indian MSMEs use social media marketing", "56% of small businesses have an hour or less a day for marketing", "Generic AI tools can put a wrong price or a garbled word on a post". Footnote with sources in small text.

**Narration:** Small businesses need posts every week, but most owners have no designer and little time. Over half get an hour or less a day for marketing.

**Notes:** Two numbers only, from `docs/submission/market-size.md` (#7 SIDBI via Entrepreneur India, 2025; #8 Constant Contact, 2024, US/UK/AU/CA sample). "Over half" is the 56% figure. The third bullet is our problem statement, not a statistic.

## s02. The idea (card, 0:12, 10 s)

**On screen:** kicker "The idea"; title "Weekly Posts: details first, then design"; subtitle "On-brand posts for small businesses, approved by the owner before anything goes out."; bullets: "The owner says what is true", "AI drafts the words; code draws every word, logo and QR", "Nothing is published without approval". Footnote "Team zerochills".

**Narration:** Meet Weekly Posts, from team zerochills: details first, then design. Every post is built only from what the owner says is true.

**Notes:** Check how TTS says "zerochills". If it sounds wrong, change the narration text only to "zero chills".

## s02b. Setup and Tween (live, recorded, 0:22, 16.5 s)

**On screen:** the recorded setup of the café on the live app, played at 4× (`"speed": 4`), cut at 66 s of recording: business name and what it sells, "Not yet" online, city Pune, customers, email, opening hours, logo skipped (text logo), what customers like, goal, tone, "Finish setup", "Go to your Brand page", the Face section with "A mascot", Tween, "Use this character in my posts" and "Use the mascot in my posts" ticked. The clip ends there (the palette step comes after the cut).

**Narration:** Setup takes a few minutes, shown four times faster: the café's name, what it sells, its city, an email, opening hours and what customers like. No website needed. Then the owner picks a face: Tween, our mascot.

**Notes:** The scene object (id, type, start `/setup`, steps, `"speed": 4`) is copied verbatim from `docs/submission/video/setup-scene.json`; only the narration is new. It replaces the old brand-page scene s03. Show a small "4×" label.

## s04. Write the brief (live, 0:38, 15 s)

**On screen:** sidebar "Create a post" → the Details step. The offer is typed into the box, "Fill in the details" is pressed, Gemini's answer fills the post type ("Offer or discount" with the "Main" badge, fields marked "From your description"). The channel is Instagram (the default when a brand has no Instagram, Facebook or WhatsApp contact). "Next".

**Narration:** To make a post, the owner types the offer in plain words. Gemini on Vertex AI fills in the details, like the post type, and marks each field so the owner can check it.

**Typed text:** `20% off cold coffee on weekdays, 2 to 5 pm, until 31 Oct. Visit us in Pune.`

**Notes:**
- "call us" was replaced by "Visit us in Pune": the café has no phone number. The offer is not saved on the Brand page; the owner's description is itself a fact source for the check (`factsForBrief`, `src/lib/create/content.ts`).
- The AI wait is marked `"speedup": 3` with a small "sped up 3×" label.
- If the "Main" badge is missing on "Offer or discount", retake; do not click the type by hand (a click on a ticked type unticks it).

**UI labels:** "Create a post" (`nav.createPost` in `src/lib/i18n/strings.ts`; `src/components/app-shell/nav-items.ts`, `sidebar.tsx`); "Describe what kind of post you want." (`create.describe.hint`); textarea name "Describe your post" (`create.describe.textLabel`, `aria-label` in `src/components/create/describe-box.tsx`); "Fill in the details" (`create.describe.button`); "We filled in what your words covered." (`create.describe.done`); "Tick every kind that fits. ..." (`create.type.hint`); "Offer or discount", "Main" (`create.type.*`); "Next" (`create.save.next`, `src/components/create/brief-editor.tsx`).

## s05. On the post (live, 0:53, 12 s)

**On screen:** "What to show on the post": chips with the exact text. "Email" (hello@cornercup.example.com) stays on; "Opening hours" is clicked off. "Next: Design".

**Narration:** Next, the owner picks the contact lines for the post: here the email stays and the opening hours come off. Each chip shows the exact words.

**Notes:**
- Setup saves its contacts as "Show on new posts", so both chips start on (`src/lib/setup/details.ts`, `is_default true`). Check this on the Brand page before recording; if hours start off, the click would switch them on, so remove that click.
- Hours come off on purpose: the café opens 09:00 to 17:00, but the offer runs 2 to 5 pm. See "Open issue" below.

**UI labels:** "What to show on the post" (`create.show.title`, `src/components/create/show-editor.tsx`); "Email", "Opening hours" (`create.blocks.labels.email`, `.hours`, via `blockLines` in `src/lib/briefs/editor-state.ts`); "Next: Design" (`create.save.nextDesign`).

## s06. Five designs appear (live, sped up, 1:05, 12 s)

**On screen:** "Writing your post..." (Gemini writes the headline, caption and button text once), then the Design Studio with the Designs panel "5 designs for you": Big offer, Photo hero, Elegant arch, Clean card, Playful pop, in the Saffron colours, with Tween.

**Narration:** Gemini writes the words once, and the Design Studio opens with five starting designs, every word, logo and contact drawn by code, not an image model.

**Notes:** Single posts open in the Design Studio with five starting designs (`src/components/create/design-body.tsx` → `PostStudio`); the older 3-option designer is only used for carousels. With no logo, the business name is drawn as a text logo. AI wait `"speedup": 3`.

**UI labels:** "Writing your post..." (`create.design.writingTitle`); "5 designs for you" (`src/components/studio/panels.tsx`); design names (`TEMPLATE_LABEL`, `src/lib/studio/templates.ts`).

## s07. Design Studio quick edit (live, sped up, 1:17, 12 s)

**On screen:** "Designs" → "Big offer"; "Brand" → font pair "Sweet" (the poster redraws at once); "Text" → "Words on the poster"; "Use this design" ("Drawing every size…"), then Review loads.

**Narration:** The owner picks one, tries another font pair, and can edit any word, redrawn live. Use this design draws every size and checks the words again.

**Notes:** "Use this design" runs `finishStudio`: the words go through the guardrail and the server draws every size. Wait marked `"speedup": 3`.

**UI labels:** rail "Designs", "Brand", "Text" (`RAIL`, `src/components/studio/panels.tsx`); "Big offer" (`src/lib/studio/templates.ts`); "Sweet" (`FONT_PAIRS`, `src/lib/studio/fonts.ts`); "Words on the poster" (`panels.tsx`); "Use this design" (`src/components/studio/post-studio.tsx`).

## s08. Review: a "please check" flag and the fix (live, sped up, 1:29, 15 s)

**On screen:** Review with the Instagram post. "Edit caption" → the caption is replaced with one that adds **"Free home delivery across Pune."** → "Save". The fact check runs; a "Please check" box shows the line. "Edit caption" again, the caption without that sentence, "Save", "Nothing to check", "Approve this post" → "Approved".

**Narration:** In Review, the owner adds free home delivery across Pune to the caption. That is not in the brief, so the fact check, code plus Gemini, flags it. The owner removes it and approves.

**Typed text (1st save):** `Cold coffee, 20% off on weekdays, 2 to 5 pm, until 31 Oct. Visit us in Pune. Free home delivery across Pune.`
**Typed text (2nd save, the fix):** `Cold coffee, 20% off on weekdays, 2 to 5 pm, until 31 Oct. Visit us in Pune.`

**Why the flag is real:** the caption save runs the guardrail (`src/lib/create/check.ts` → `runGuardrail`). Its code layer always flags "free home delivery" when it is not in the owner's sources (`RISKY_PHRASES`, `src/lib/ai/checks.ts`; located in `src/lib/guardrail/deterministic.ts`), and the Gemini layer flags unsupported claims. The café has no delivery fact; every other word repeats the owner's description.

**Notes:** The fix is a second caption edit (deterministic) rather than the "Remove" button, which cuts only the flagged span. Both fact-check waits are `"speedup": 3`. If any other flag appears, retake.

**UI labels:** "Caption and hashtags", "Edit caption", "Caption", "Save", "Nothing to check", "Approve this post", "Approved" (`create.review.*`, `src/components/create/review-captions.tsx`, `review-screen.tsx`); "Please check" (`approvals.flags.title`, `src/components/create/review-checks.tsx`).

## s09. Schedule for later today (live, 1:44, 10 s)

**On screen:** "Next: Schedule" → "Pick another time" → the calendar ("Time for Instagram") → today → the time `{{SLOT_TIME}}` → zoom on the picker → "Done" → "Confirm" → "Scheduled" with "See the Queue".

**Narration:** The owner picks a time on the calendar, here later today, or keeps the suggested slot. Nothing goes out until they confirm.

**Placeholders (fill in just before recording):**
- `{{SLOT_DAY}}`: today's day button. Its accessible name is the long date in the browser's locale, for example `Monday 20 October 2026` (en-GB) or `Monday, 20 October 2026` (en-IN); it may end with ", Suggested". The match is a substring, so the date part is enough. Set the recording browser's locale explicitly so the format is known.
- `{{SLOT_TIME}}`: a time option, shown in the browser locale, for example `4:15 pm` (en-IN) or `16:15` (en-GB). It may end with "Suggested".

**Timing limit:** the picker offers times in 15-minute steps, and only times **at least 10 minutes** after now (`MIN_LEAD_MS`, `src/lib/queue/slots.ts`); the server refuses anything sooner ("That time is too soon..."). A slot about 3 minutes after the recording starts is therefore not possible: pick the first quarter hour at least 12 minutes after the moment you will press Confirm (so 12 to 27 minutes ahead). Record s10 after that time has passed.

**UI labels:** "Next: Schedule" (`create.review.nextSchedule`); "Here is when each post goes out. ..." (`create.schedule.intro`); "Pick another time", "Time for {channel}", "Confirm", "Scheduled", "See the Queue" (`create.schedule.*`, `src/components/create/schedule-screen.tsx`); day buttons, `role="option"` time buttons, "Times are in {zone}.", "Done" (`src/components/ui/date-time-picker.tsx`, `picker.*`).

## s10. Queue with Firestore live status (live, separate take, 1:54, 16 s) — depends on firebase

**On screen:** `/week`, "Coming up" with the green "Live" dot and the café's card with "Scheduled". The recorder runs the Cloud Scheduler job; without any reload, the card changes (briefly "Sending now") to "Sent to you".

**Narration:** On the Queue, the card is live. When the time has passed, Cloud Scheduler calls our Cloud Run service, which emails the post to the owner, and Firestore pushes the new status here, no reload.

**Notes:**
- Recorded on its own (`"start": "/week"`), after `{{SLOT_TIME}}` has passed. The sweep sends an item only when `slot_at <= now`.
- The `shell` step runs `gcloud scheduler jobs run weekly-posts-queue` (the real Cloud Scheduler job, which calls `/api/cron/queue` on Cloud Run). The wait is `"speedup": 4`, timeout 120 s.
- No account is connected, so the post is emailed ("Sent to you"); with a connected account the label would be "Published". "Sending now" lasts only a moment, so the script waits for the final label only.
- The email lands in the owner's inbox; never show it.

**UI labels:** "Coming up" (`queue.sections.upcoming`, `src/components/queue/queue-screen.tsx`, which now uses `useLiveKind` and `LiveDot`); "Live" (`live.label`, `src/components/live/live-dot.tsx`); "Scheduled", "Sending now", "Sent to you" (`queue.statuses.*`).

## s11. Firestore rules (card, 2:09, 10 s) — depends on firebase

**On screen:** kicker "Firestore rules"; title "Read your own brand. Never write."; subtitle "Cloud Run mints a Firebase Auth custom token with claims { b: brandId, until }, valid 60 minutes, without a key file."; the bullets are the rule as code (render them in a monospace font, no bullet marks):

```
match /brands/{brandId}/live/{docId} {
  allow get, list: if request.auth.token.b == brandId
    && request.time.toMillis() < request.auth.token.until;
  allow create, update, delete: if false;
}
```

Footnote: "firestore.rules (abridged). Status only: no captions, emails or payment IDs."

**Narration:** Firestore rules mirror our database security: a one-hour custom token lets a browser read only its own brand's status, and never write.

**Notes:** Abridged from `firestore.rules` (the full rule also checks `request.auth != null` and `until is int`). Token lifetime: `LIVE_TOKEN_TTL_MS` = 60 minutes (`src/lib/realtime/token.ts`).

## s12. Plan a week (live, sped up, 2:20, 12 s)

**On screen:** `/plan`. The sentence is typed, "Fill my week" fills the days ("Got it: 7 days with offers on all pastries. Check them below."), "Button on the post" is set to "Visit us", "Design my week" opens the Design Studio in plan mode ("5 designs for you", "Changes apply to every day; each day keeps its own offer.").

**Typed text:** `Mon to Thu 10% off, Fri 20%, Sat & Sun 15% off on all pastries`

**Narration:** Plan a week turns one sentence into one offer per day, read by plain code so nothing is invented. One shared design becomes a week of posts.

**Notes:**
- The default button is "Order on WhatsApp", but the café has no WhatsApp number, so the step sets "Visit us". That control is a `<select>`: the `type` step (no `clear`) relies on the browser's type-to-select on a focused select. If the recorder's `type` uses `fill`, this fails; then add a `select` step, or skip this scene.
- The textarea has no label; it is found by its placeholder ("Monday 10% off, Tuesday 20%, ...").
- The scene stops in the studio; the week is not approved. Each take adds a dated selling point and a plan; remove them between takes.

**UI labels:** "Tell us your week in one line", "Fill my week", "Got it: ...", "Button on the post", "Visit us", "Design my week" (`src/components/plan/plan-form.tsx`); "5 designs for you" (`panels.tsx`); "Changes apply to every day; ..." (`src/components/studio/studio.tsx`).

## s13. Architecture (card, 2:32, 13 s)

**On screen:** kicker "How it works"; title "Built on Google Cloud"; subtitle "One Next.js app on Cloud Run (australia-southeast1)"; bullets: Cloud Run and Cloud Scheduler; Gemini on Vertex AI (brief from plain words, captions, fact check, grounded Ideas with Google Search); Firestore live status with Firebase Auth custom tokens and read-only brand-scoped rules; Supabase Postgres with row-level security as the system of record; code draws every word, logo and QR (HarfBuzz + resvg). Footnote: "Firestore holds only short-lived status: never captions, emails or payment IDs."

**Narration:** Under the hood: one Next.js app on Cloud Run. Gemini on Vertex AI drafts, fact-checks, and grounds Ideas in Google Search. Supabase Postgres with row-level security holds the data.

**Notes:** The Firestore bullet is only true once Firebase is deployed; otherwise drop it with s10 and s11.

## s14. Guardrails and impact (card, 2:45, 14 s)

**On screen:** kicker "Guardrails"; title "Truthful by design"; bullets: facts only from the owner's brief, anything else flagged "Please check"; nothing published without approval; AI spend capped at $0.50 a week; row-level security on 49 of 49 tables; 4,646 automated tests passing. Footnote: "Codebase figures, October 2026. Time to first post is not yet measured."

**Narration:** Posts state only the owner's facts, and nothing goes out without approval. AI spend is capped at fifty cents a week, row-level security covers all 49 tables, and 4,646 automated tests pass.

**Notes:** `WEEKLY_USD_CAP = 0.5` (`src/lib/usage/caps.ts`). Re-check the test count on the day of rendering.

## s15. End card (card, 2:59, 8 s)

**On screen:** "Try it live"; "Weekly Posts"; the live URL; "Team zerochills"; "Google Cloud AI Builder Cup (JAPAC)".

**Narration:** Weekly Posts is live on Cloud Run today, at the link on screen. Team zerochills, thank you.

---

## Open issue: offer hours vs opening hours

The setup saved opening hours **09:00 to 17:00**, but the offer typed in s04 is **2 to 5 pm**, so the last hour of the offer is after closing. The script keeps the offer as decided and keeps "Opening hours" off the poster (s05), so the two never appear together on screen. The text still says "2 to 5 pm" though. To remove the mismatch, change the offer to "2 to 5 pm" in `brand.demoTexts` and the s04/s08 typed texts, or change the café's hours to close at 18:00 or later.

## Step conventions in scenes.json

- `"start": null` = continue in the same page from the previous scene (s04 to s09 are one take). s02b (`/setup`), s10 (`/week`) and s12 (`/plan`) start at a path.
- `"clear": true` on `type` (s08 only) clears the caption before typing.
- `{{SLOT_DAY}}` and `{{SLOT_TIME}}` in s09 are filled in just before recording (see s09).
- `shell` runs only in s10.
- Every `speedup` or `speed` gets a visible label ("sped up 3×", "4×"). Nothing is cut to a fake result.

## Prep checklist (before recording)

### Already done
- [x] Café account created on the live app and set up on camera (s02b): business name, what it sells, Pune, customers, email `hello@cornercup.example.com`, hours Mon to Sun 09:00 to 17:00, text logo, two "likes", goal More visits, tone Friendly, English (India), weekly email Monday 08:00, Tween as the mascot in posts.

### Still to do
- [ ] Deploy, then set the **Saffron** palette on the Brand page ("Logo and colours" → "Saffron" → "Save my look").
- [ ] The live revision has the Design Studio, Plan a week and Firestore live status (`docs/14-firebase-plan.md` T-FB9 checks pass). If Firebase is not live, drop s10, s11 and the Firestore bullet in s13.
- [ ] Brand page: both contacts (email, opening hours) show "Show on new posts" on (needed for s05). No phone, WhatsApp, Instagram or Facebook contact; no connections; no payment QR; no AI Brand Face.
- [ ] Queue settings (`/week/settings`): "Email me posts I share myself" on; "Auto-approve posts with no flags" off; queue not paused.
- [ ] The recorder's browser is signed in to the café account (session saved by the owner's one email-link sign-in; file git-ignored and deleted afterwards). Never film the inbox.
- [ ] Browser locale set explicitly (for `{{SLOT_DAY}}` / `{{SLOT_TIME}}` formats); 1920×1080; 100% zoom; no bookmarks bar or extensions.
- [ ] Record before 31 Oct 2026 (the offer's end date).
- [ ] `gcloud` is signed in on the recording machine with permission to run `weekly-posts-queue` (for s10).

### Between takes
- [ ] Take earlier test posts out of the queue ("Take out of the queue" or "Skip" on `/week`).
- [ ] Remove the selling point and plan that each s12 take creates.

### AI cost (approve before going over $0.50)
- One take of s04 to s09 plus s12 makes about 6 Gemini calls (describe, post copy, 3 fact checks, plan copy): about **$0.03 to $0.05**. No Imagen, Veo or Brand Face.
- The account's weekly limits (`src/lib/usage/caps.ts`: $0.40 non-batch, 30 fact checks a week) allow about 8 to 10 takes. Ask the owner before passing $0.50 in total. TTS is about 2,300 characters ($0).

### Owner does by hand
- Sign in once by email link for the recording browser.
- Set the Saffron palette after the deploy.
- Fill in `{{SLOT_DAY}}` and `{{SLOT_TIME}}` right before recording s09.
- Approve any AI spend over $0.50, and watch the final video before submitting.

## Honesty notes

- Everything shown is the running app; waits are sped up with a label, never replaced.
- The "please check" flag is real: the owner types a claim that is not in the brief.
- "Five designs", "Sending now" and "Sent to you" are the app's real behaviour and labels.
- Firebase is claimed only in s10, s11 and s13, and only once it is deployed.
- No phone or WhatsApp number appears anywhere (an invented number could belong to a real person).
- Numbers: 13% and 56% (sourced, footnoted), 4,646 tests, 49 of 49 tables, $0.50 weekly cap (from the code).
