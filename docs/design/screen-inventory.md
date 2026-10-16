# Weekly Posts: inventory of every screen (for the visual redesign)

Project root: `C:\Users\RITS\Projects\Post`. All UI text is in `src\lib\i18n\strings.ts` (the `s` object), apart from four side copy files I name below. The app name is the constant `APP_NAME = "Weekly Posts"` in `src\lib\app.ts`.

**A file you'll want:** `docs\design\11-theme-fish-style.md` (dated 2026-10-15) is a draft of the new "Fish-style" theme. It specifies Onest font, a warm-neutral palette, pill shapes, and keeps the coral `#E4572E` accent. That is probably the target theme.

**Uncommitted work:** `git status` shows uncommitted changes in the create flow (StepBar, brief editor, describe box, design studio, the create pages) and in `strings.ts`. This inventory reflects the working tree, not the last commit.

---

## 0. Global look (current)

### Fonts
- `src\app\layout.tsx` loads **Noto Sans** (latin, `--font-noto-sans`) and **Noto Sans Devanagari** (`--font-noto-devanagari`) from `next/font/google`.
- `src\app\globals.css`, in full:
  ```css
  @import "tailwindcss";
  @theme inline { --font-sans: var(--font-noto-sans), var(--font-noto-devanagari), system-ui, sans-serif; }
  body { font-family: var(--font-noto-sans), var(--font-noto-devanagari), system-ui, sans-serif; }
  ```
- There is **no tailwind.config file**. The app uses Tailwind v4 with stock colours only, plus arbitrary hex values.
- `<body>` has: `min-h-full bg-stone-50 text-stone-900 antialiased`.
- Viewport `themeColor` is `#E4572E`. Meta description: "Posts for your business, in your language."

### Palette (as used)
- **Brand coral** `#E4572E`: primary buttons, active states, progress bar, the wordmark.
- **Brand dark** `#B93A15`: text of selected chips and active nav.
- **Tints:** `bg-[#E4572E]/10` for selected items, `ring-[#E4572E]/30` and `/40`.
- **Neutrals:** Tailwind stone (50, 100, 200, 300, 500, 600, 700, 800, 900). Cards are `bg-white border-stone-200`.
- **Status colours** (Tailwind defaults):
  - amber-50/100/200/300 with text amber-800/900: "Please check" flags and warnings
  - green-100/800, emerald-50/800: success and approved
  - red-50/100/300 with text red-700/800/900: errors and blockers
  - blue-100/800: posted and publishing
  - sky-100/200/300/900: "From your description" badge and the website source badge
- **Tween overlay** (`src\components\tween\tween.css`) has its own blue tokens:
  - ink `#0b1c30`, muted `#444656`, raised `#fff`, sunk `#eff4ff`, line `#d9e1f2`
  - brand `#002fdf`, brand-soft `#dee0ff`, accent `#2b4cff`
  - Mascot "Tween blue" is `#2B4CFF`.
- **Brand-palette presets** (`src\lib\brand\colors.ts`, shown as primary / secondary / accent):

  | Preset | Primary | Secondary | Accent |
  |---|---|---|---|
  | Saffron | `#E4572E` | `#FFF3E0` | `#1B998B` |
  | Red and gold | `#B5121B` | `#FFF4E0` | `#F2A900` |
  | Fresh green | `#1B7F3B` | `#F1F8E9` | `#FFB400` |
  | Trust blue | `#1F4E9C` | `#EAF1FB` | `#F59E0B` |
  | Royal purple | `#7B2D8E` | `#FBEFFC` | `#F4A261` |
  | Charcoal and gold | `#222831` | `#F5F5F5` | `#D4A017` |

### Class helpers: `src\components\ui.ts` (exact strings)
- `inputClass` = `"w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-base outline-none focus:border-[#E4572E] focus:ring-2 focus:ring-[#E4572E]/30"`
- `primaryButton` = `"w-full rounded-lg bg-[#E4572E] px-4 py-3 text-lg font-semibold text-white disabled:opacity-50 md:w-auto md:min-w-48 md:px-6"`
- `secondaryButton` = `"w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-base font-medium text-stone-800 disabled:opacity-50 md:w-auto md:min-w-48 md:px-6"`
- `linkButton` = `"py-2 text-sm text-stone-600 underline"`
- `labelClass` = `"mb-1 block font-medium"`
- `hintClass` = `"mb-2 text-sm text-stone-500"`
- `errorClass` = `"mt-1 text-sm text-red-700"`
- `unsureClass` = `"rounded-lg ring-2 ring-amber-400 bg-amber-50 p-2"`
- `chipClass(selected)` = `` `min-h-12 rounded-lg border px-4 py-2 text-base font-medium ${selected ? "border-[#E4572E] bg-[#E4572E]/10 text-[#B93A15]" : "border-stone-300 bg-white text-stone-800"}` ``

### Local button and card styles repeated across files
- `smallButton` = `"min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-base font-medium text-stone-800 disabled:opacity-50"`
- `strongButton` = `"min-h-11 rounded-lg bg-[#E4572E] px-4 py-2 text-base font-semibold text-white disabled:opacity-50"`
- Create editor cards (`EditorCard`): `rounded-2xl border bg-white p-4`. When filled from the description they become `border-sky-300 ring-2 ring-sky-200` with a pill badge "From your description" (`bg-sky-100 text-sky-900 rounded-full`).
- `pickClass(selected)`: `flex min-h-12 ... rounded-xl border p-3`. Selected is `border-[#E4572E] bg-[#E4572E]/10`.
- Status pills: `rounded-full px-2 py-0.5 text-xs font-medium` plus a colour pair.
- `focusRing` = `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E4572E]`.

### Logo / brand mark
- **There is no image logo.** `public\` is empty and there is no favicon file.
- The mark is the text "Weekly Posts", bold, coral `#E4572E`:
  - `text-xl font-bold` in the sidebar
  - `text-lg` in the phone and tablet headers
  - `text-2xl` on the auth cards
- The only character art is the mascot **Tween**, an SVG drawn in code (`src\lib\mascot\tween.ts`). It appears as the floating guide overlay and on the mascot screens.

---

## 1. App shell / navigation (signed-in pages)

Files: `src\app\(app)\layout.tsx`, `src\components\app-shell\{app-shell,sidebar,top-bar,nav-items,nav-icon}.tsx`, `src\components\bottom-nav.tsx`.

**Redirects:**
- Signed out goes to `/login`.
- Setup not finished: every app page goes to `/setup`.
- `/` goes to `/login`, `/setup` or `/week`.

**Breakpoints:**
- **1024 px and up:** left sidebar plus main area. Main is `max-w-[1200px]`, padding `px-10 pt-8`.
- **768 to 1023 px:** top bar with tabs.
- **Below 768 px:** a 480 px column with a phone header and a fixed bottom nav.

**Sidebar** (`w-64`, white, `border-r`, sticky full height):
- Top: "Weekly Posts" in coral, with the business name under it (`text-sm text-stone-700`, truncated).
- Nav (aria "Main navigation"). Each item is a 24×24 stroke icon (1.8 stroke) plus a label, `min-h-11 rounded-lg`. The active item is `bg-[#E4572E]/10 font-semibold text-[#B93A15]`. Items in order:
  1. **Create**: plus icon (`M12 5v14M5 12h14`)
  2. **Queue** → `/week`: calendar/grid icon
  3. **Brand**: house icon
  4. **Mascot**: smiley face icon
  5. **Results**: three vertical bars
  6. **History**: clock with a counter-clockwise arrow
  7. **Connections**: chain-link icon
- Bottom, after a border-top: a **"Sign out"** button.

**Tablet top bar:**
- Row 1: "Weekly Posts" in coral, the business name, then **"Sign out"** on the right.
- Row 2: the same 7 tabs as text only (no icons). The active tab has a coral bottom border and `text-[#B93A15]`.

**Phone:**
- Header: "Weekly Posts" in coral on the left, the business name centred, a "Sign out" underlined link on the right.
- Bottom nav (fixed, white, border-top), 4 items, each an icon over a `text-xs` label. The active item is coral and semibold. Items in order:
  1. **Queue**
  2. **Brand**
  3. **Results**
  4. **History**
- There is no Create tab on phones: the Queue page shows a coral "Create a post" button instead. Connections and Mascot are links in the Brand page header.

**Setup mode** (`/setup`): minimal header only (app name and Sign out). No sidebar, top bar or bottom nav.

**Tween overlay:** a floating mascot guide pinned bottom-left on app pages.
- Pieces: a speech panel, typing bubbles, reply chips and a spotlight ring.
- UI words: "Open Tween, your guide", "Hide Tween", "Pause Tween", "Resume Tween", "Turn on/off Tween's voice", "Start over", "Don't roam" / "Let Tween roam", "Settings", "Show/Hide conversation", "Skip typing", "Dismiss", "Close", "Tween is thinking".
- Copy lives in `src\content\tween.json`.

**Unused component:** `BrandSwitcher` (`src\components\brand-switcher.tsx`) exists but is not shown. It is a bottom-sheet dialog "Your businesses" with a "Close" button.

---

## 2. Login: `/login`
Files: `src\app\(auth)\login\page.tsx`, `login-form.tsx`.

- **Purpose:** passwordless sign-in by emailed magic link.
- **Layout:** centred column, `max-w-[480px]` (560 on desktop). On md+ it sits in a white card: `rounded-2xl border p-10 shadow-sm`.
- **Heading:** "Weekly Posts" (coral, 2xl bold), then the subtitle "Sign in with your email".

**Step "email":**
- Label "Email address", placeholder "you@example.com", hint "We email you a link. No password needed."
- Consent checkbox (coral accent): "We store your email and business details to make your posts. You can delete your data any time in settings." followed by the link "Terms and privacy".
- Primary button "Send me a link" (shows "Sending..." while working). It is disabled until the box is ticked.
- Errors: "Enter a valid email address." / "Please tick the box to continue." / "Too many requests. Please wait a few minutes and try again." / "We could not send the email. Please try again in a minute." / "Sign-in is not available right now." / "Something went wrong. Please try again."

**Step "sent":**
- h2 "Check your inbox".
- Body: "We sent a sign-in link to {email}. It works once and expires in 15 minutes."
- Muted line: "Nothing there? Look in your spam or promotions folder."
- Primary button "Send the link again". During the cooldown it reads "You can send it again in {seconds} seconds". After resending, a green note: "A new link is on its way."
- Dev only: the link "Dev: open the link".
- Text link "Use a different email".

**Related auth pages:**
- **`/auth/invalid`** (`src\app\auth\invalid\page.tsx`): same card. "This link does not work" / "It may have expired or been used already. Links work once and last 15 minutes." / full-width coral button "Send a new link".
- **Continue page** (HTML from `src\lib\auth\continue.ts`): "Continue to {appName}" / "Tap the button to finish signing in." / button "Continue".

---

## 3. Setup wizard: `/setup`
Files: `src\app\(app)\setup\page.tsx`, `setup-wizard.tsx`, `choice-card.tsx`, `hours-editor.tsx`. Step order is in `src\lib\setup\steps.ts`.

- **Frame:** a centred card, `max-w-[640px] md:rounded-2xl md:border md:p-8 md:shadow-sm`.
- **Above each question:**
  - Progress bar: `h-2` stone-200 track with a coral fill.
  - "Step {n} of {total}" in `text-sm text-stone-500`.
  - h1 with the question (`text-xl font-bold`).
- **Footer:** "Back" (secondary), "Skip" (secondary, where allowed), "Next" (primary). While saving, the button reads "Saving...".
- **ChoiceCard:** a big tappable card. Label `text-lg font-semibold` with a hint `text-sm` under it. Selected is coral border plus coral/10 background.
- **Paths:** Path A (online) shows all 14 screens. Path B (not online yet) skips "addresses".

| # | Step | Question (h1) | Contents |
|---|---|---|---|
| 1 | business | **Tell us about your business** | "Business name" (placeholder "e.g. Corner Bakery"). "What do you sell?", hint "One line is enough. For example: sourdough bread and cakes; hair salon services; accounting for small shops.", placeholder "e.g. fresh bread, cakes and coffee". Button: Next |
| 2 | online | **Are you online already?** | Hint "Choose all that apply. We read them in the background, so you type less." Checkbox ChoiceCards: **Website** / "We read it to learn your products and contact details"; **Instagram** / "We read your recent public posts"; **YouTube** / "We save your channel for now"; **Not yet** / "No problem. A few short questions and we are done". Buttons: Back, Skip, Next |
| 3 | addresses (Path A only) | **Where can we find you online?** | Hint "Only the ones you chose. You can skip any of them." "Website address" (hint "We read up to 5 pages to learn about your business.", placeholder "e.g. www.yourshop.com"). "Instagram name" (hint "Only your own business's account.", placeholder "@yourbusiness"). "YouTube channel" (hint "A channel address or @name. We only save it for now.", placeholder "e.g. @yourchannel"). Grey status box: "We'll read these while you answer the rest." Buttons: Back, Skip, Next |
| 4 | location | **Where are you?** | "Country" select (placeholder "Choose your country"). "State or region" select (only if the country has regions; hint "Optional. We use it for local holidays.", placeholder "Choose (optional)"). "City or town" (hint "Optional.", placeholder "e.g. Manchester"). Line "Your time zone: {zone}" with the link button "Change time zone", which opens a "Time zone" select. Buttons: Back, Next |
| 5 | customers | **Who are your customers?** | "Your customers, in one line", hint "For example: families nearby, office workers on lunch break, small business owners.", placeholder "e.g. families and office workers nearby". Buttons: Back, Next |
| 6 | reach | **How do customers reach you?** | Hint "These can appear on your posts. Leave out anything you do not want shown." "Phone number" (hint "With the country code, like +44 20 7946 0000. If you leave it out we read it in your country.", placeholder "e.g. +44 20 7946 0000"). Checkbox "This number is on WhatsApp too". "WhatsApp number" (shown only if unticked; hint "Only if it is a different number."). "Email address" (placeholder "e.g. hello@yourshop.com"). Prefilled fields show the note "We found this on your website. Check it is right." Buttons stacked: Back, Skip, Next |
| 7 | hours | **When are you open?** | Hint "Optional. Only the hours you give are shown on posts." Radio cards: "I will set my hours" / "Always open" / "By appointment". The first one shows an editor: rows Monday to Sunday, each with a checkbox and day name, then time "from" / "to", or "Closed". Under it the secondary button "Use the first day's times for every open day". Buttons: Back, Skip, Next |
| 8 | logo | **Your logo** | Hint "Optional. A clear PNG, JPG or WebP picture works best." Uploader: 96 px preview box ("No logo yet."), secondary button "Choose logo" / "Replace logo" / "Uploading...", link "Remove logo", green "Logo saved." Buttons: Back, then Next if a logo exists, otherwise "Skip for now. We'll use your name" |
| 9 | likes | **What do customers like about you?** | Hint "Add one to three short lines, in your own words. They can appear on your posts." Inputs "Line 1", "Line 2", "Line 3" (placeholder "e.g. Friendly service"). "Tap an example to add it" with chips, which vary by trade. Food example: "Made fresh every day", "Friendly service", "Simple, tasty food", "Made with care". General: "Friendly service", "Helpful, honest advice", "Easy to get in touch", "Careful, tidy work". Buttons: Back, Skip, Next |
| 10 | goal | **What do you want from your posts?** | Radio cards: **More enquiries** / "People message, call or book"; **More visits** / "People come to your shop or place"; **Get known** / "More people hear about you". Buttons: Back, Next |
| 11 | style | **How should your posts sound?** | Radio cards: **Friendly** / "Warm and easy"; **Professional** / "Clear and polished"; **Playful** / "Light and fun"; **Like my past posts** / "We copy the way you write". The last one adds a note: "You can add past posts on your Brand page." Then the select "Which language are your posts in?" with hint "This is the language we write your captions in." Buttons: Back, Next |
| 12 | minutes | **Roughly how many minutes does one post take you today?** | Number input "Minutes per post", hint "Include thinking, writing and making the picture. A rough guess is fine." Quick chips: "10 min", "20 min", "30 min", "60 min". Buttons: Back, Next |
| 13 | schedule | **When should we email your posts?** | "Day" select (Monday to Sunday), "Time" time input, note "In {zone}." Buttons: Back, primary "Finish setup" |
| 14 | done | **You are all set** | "Your weekly posts will be emailed on {day} at {time}." and "Nothing is posted anywhere until you approve it." Path A adds an h2 "What we found so far" with status boxes (grey, or amber for warnings). These include "Reading your website...", "Reading your Instagram...", "We read {pages} and found {facts}. Check them on your Brand page.", "{n} contact details from your website", "{n} selling points suggested from your website". Then the line "Review what we found: Your facts · Your contacts · Your selling points · Your Instagram" (links). Primary link-button "Go to your Brand page" |

---

## 4. Create a post: 5-step flow
**StepBar** (`src\components\create\steps.tsx`):
- A 5-column grid of rounded tiles, aria "Steps to a finished post".
- Each tile shows a number and a label: **1 Details · 2 On the post · 3 Design · 4 Review · 5 Schedule**.
- Current tile: solid coral with white text. Done: coral/10 with `#B93A15` text. To do: stone-100 with stone-600 text.

### 4a. Details: `/create` and `/create/[briefId]`
Files: `src\components\create\brief-editor.tsx`, `describe-box.tsx`, `photo-picker.tsx`, `card.tsx`.

- **Purpose:** describe the post, then pick its type, photo, language and channels. It autosaves.
- **Layout:** a single column, `max-w-3xl`. StepBar first, then stacked EditorCards. There is no separate h1; the first card's title is "Create a post".

Cards, in order:

1. **Create a post** (DescribeBox)
   - Hint: "Describe what kind of post you want."
   - Textarea (aria "Describe your post"), placeholder "For example: 20% off all cakes this weekend. Call us to order."
   - A round mic button sits inside the textarea's bottom-right corner (coral/10 background, aria "Speak your post").
   - While recording, the textarea is covered by a red-50 bar holding a cancel "×" button ("Cancel the recording"), animated red level bars, a timer, and a coral check button ("Done, use my words").
   - While transcribing: a spinner and "Listening...".
   - Primary button "Fill in the details" ("Reading your words..." while working).
   - Result notes: "We filled in what your words covered." or "We could not find anything to fill in. Please use the fields below."
   - Amber box "Still to decide" with a bulleted list of questions.
   - Error: "Please write or say a few words first."
   - Under the card: "Fields marked "From your description" came from your words. Please check them."
2. **What kind of post is this?** (hint "Pick one.")
   - Radio pick cards in a 2-column grid, each a label plus a hint:
     - Offer or discount / A deal with a price or a date
     - New product or service / Something new to show
     - Event / Something happening on a date
     - Announcement / Opening, closing, holiday hours
     - Festival or occasion / A greeting for a special day
     - Review or testimonial / A customer's kind words
     - Hiring / A job to fill
     - General brand post / Say hello to your customers
   - Error: "Please pick what kind of post this is."
3. **Supporting photo or design**
   - Hint: "Add a photo or a design for this post, or go without one."
   - Radio card "No photo (design only)" / "A clean typographic design".
   - Photo grid, 2 to 4 columns of square thumbs. Notes on thumbs: "This photo may be dark or blurry." / "People in this photo: check they agree to be shown."
   - Empty state: "Your photo library is empty."
   - Secondary button "Upload a photo" ("Uploading...").
4. **Post language**
   - Hint: "The language the words on the post are written in."
   - One select with the language list.
5. **Where will it be posted?**
   - Hint: "We make the right sizes for each."
   - Toggle chips: Instagram · Facebook · WhatsApp · YouTube · LinkedIn · Google Business.

**Footer:** save status on the left ("Saving..." / "Draft saved" / "We could not save just now. Your changes are still here; we will try again."), primary **"Next"** on the right ("Saving your details..." while working).

### 4b. On the post: `/create/[briefId]/show` (new)
Files: `src\app\(app)\create\[briefId]\show\page.tsx`, `src\components\create\show-editor.tsx`, `qr-picker.tsx`.

- **Purpose:** choose which contact details appear on the post, and an optional QR code.
- **Layout:** `max-w-3xl`, StepBar (step 2 current), then h2 **"What to show on the post"**. No "Create a post" h1 here.

Sections:

1. **Contact-block chips** (no card frame)
   - Toggle chips (`chipClass`). Each shows the label in base medium with the exact text under it (`text-xs text-stone-600`).
   - Possible labels: Logo ("Your logo") · Phone · WhatsApp · Website · Email · Address · Opening hours · Instagram · YouTube · Facebook. Only the ones the brand has are shown; Dates is never offered here.
   - If any are missing: the link "Add more on your Brand page".
2. **QR code** (EditorCard)
   - Hint: "Only if you want one. We never add a QR code you did not ask for."
   - Three radio pick cards in a row:
     - "No QR code"
     - "A link" / "Scans are counted. Label on the post: "Scan to visit"."
     - "Payment" / "Payment QR codes need a confirmed payment ID." (disabled when there is none)
   - Link when no payment ID: "Set up a payment QR on your Brand page".
   - Link mode adds:
     - Select "Where should it go?": My website / WhatsApp chat / Google Maps / Booking page / Another link
     - Input "Link", placeholder "https://"
     - Hint: "You have not added this link yet. Add it to your contact details, or type one here."
     - Status lines: "Checking the link..." / "This link can be used."
   - Payment mode adds a grey box: "Pays {payee}, {address}" and "Label on the post: "Scan to pay". Payment scans are not counted."
   - QR link errors: "Please type a link." / "Use a link that starts with https://" / "We could not find that website. Check the spelling." and others.

**Footer:**
- Problems show as an error line plus an amber bullet list of missing items, with the link "Back to the details".
- Save status line.
- Buttons: secondary **"Back"**, primary **"Next: Design"** ("Saving your details...").

### 4c. Design: `/create/[briefId]/design`
Files: `src\app\(app)\create\[briefId]\design\page.tsx`, `src\components\create\design-body.tsx`, `design-studio.tsx`.

- **Header:** h1 "Create a post", StepBar, h2 "Design". Width `md:max-w-5xl`.
- **Loading card:** "Writing your post..." / "This takes a few seconds. The words are written once; coming back here does not write them again."
- **Not-ready / error card:** "This brief is not ready yet. Please finish the details first." with the secondary button "Back to the details".

Content, in order:

1. **Intro:** "Pick the look you like best. Everything on the post comes from your details."
2. **Optional note:** "Your pictures are drawn. Choosing a design again replaces them."
3. **Flags**
   - Amber box "Please check" / "We could not find these in your details. You can confirm or remove them in the next step." with list items "{Kind} · In {field}: <highlighted text>".
   - Or a green line: "Nothing to check. Every figure and claim comes from your details."
4. **Three option cards** (3 columns on md)
   - Each: preview image, h3 "Option {n}", small button "Choose this one" / "Selected". The selected card has a coral border and ring.
   - Report lines under each: "Everything fits." (green) / "No room for: {items}" (amber) / "Not shown on this size: {items}" / problem lines in red.
   - Under the cards: "We will draw: {list}". Format names: square (1080 x 1080), portrait (1080 x 1350), story (1080 x 1920), wide (1200 x 630), YouTube thumbnail (1280 x 720), website banner (1920 x 600).
   - Optional carousel note: "You picked more points than one picture holds, so we will also make a carousel with one point per slide."
5. **Quick edits** card
   - "Layout": buttons "Previous layout" / "Next layout", plus "Layout {n} of {total}: {name}".
   - "Colours" select: Brand colour / Light / Dark / Accent.
   - Note: "The logo position is set by the layout; use the layout buttons to move it."
   - "Photo": "Photos come from your library. We never draw your products or people." Photo radio grid (3 or 6 columns) plus "No photo (design only)". Empty: "You have no photos yet. Add some on the Brand page."
   - "Show on the post": "Switch lines on or off. This changes your details for this post." Checkbox rows (label plus text, or "Not added yet").
6. **Words** card
   - Hint: "Change any words. We check them against your details again when you save."
   - Inputs: "Headline (up to 7 words)", "Second line (up to 14 words)", "Button text (up to 25 characters)", "What the mascot says (up to 30 characters)" (only if the mascot is on), a "Caption for {channel}" textarea per channel, "Hashtags".
   - Secondary button "Save and check" ("Checking...").
   - Results: "Saved. We checked the words again." / "Nothing changed." / "Your words changed, so the pictures were cleared. Use a design again to draw them."
7. **Footer**
   - Primary **"Use this design"** ("Drawing your pictures...", with hint "We draw every size your channels need.").
   - Secondary "Back to the details" (goes to /show).
   - Red note when blocked: "Needs a different layout or shorter words".

### 4d. Review: `/create/[briefId]/review`
Files: `src\app\(app)\create\[briefId]\review\page.tsx`, `src\components\create\review-screen.tsx`, `share-panel.tsx`.

- **Header:** h1 "Create a post", StepBar, h2 "Review". Width `md:max-w-4xl`.
- **Empty card:** "There are no posts to review yet. Choose a design first." with the primary button "Choose a design".
- **Intro:** "Check each post. Approve it when everything is right; nothing is shared until you do."
- **"Approve all posts"** (coral, only if more than one post can be approved).

Per-post card:

- **Header:** h2 "{channel} post" with a status pill: "Needs your approval" (amber), "Approved" (green), "Posted" (blue), "Skipped" (stone).
- **Pictures:** a row of every size, `max-h-72`, each with a caption: square / portrait / story size / wide / thumbnail / banner.
- **Carousel strip:** "Carousel: {n} slides, one point each".
- **Text:** "Caption" label with the caption text, then hashtags.
- **Flag count:** "{n} to check" (amber) or "Nothing to check" (green).
- **Optional reminder:** "Check your local advertising rules before posting."
- **Red blocker box** "This design needs a change" with lines such as "The text does not fit in the {format} picture: {detail}." and the link "Back to the design".
- **Amber "Please check" box**
  - Intro: "We could not find these in your brand details. Keep only what is true."
  - Each item: kind (Price, Offer, Opening hours, Date, Contact detail, Number, Claim, Word you wanted to avoid, Same wording as a recent post, Reminder), then "In {field}", then the highlighted text.
  - Regulated items add the warning "Health, money and education claims can break advertising rules. Only confirm if it is true and you can prove it." and a checkbox "I confirm this is true and I can prove it".
  - Buttons: "This is true", "Remove" / "Remove it", or "Edit".
- **Approve:** coral **"Approve this post"** ("Approving..."). When flags are open: "You can approve once you have answered every item above."
- **After approval:** grey "Share this post" box with SharePanel buttons:
  - "Share {size}" on phones, otherwise "Download {size}" (the first one coral)
  - "Copy caption"
  - iOS hint: "On iPhone, tap Share, then choose the app"
  - Then "Undo approval".

**Footer:** secondary "Back to the design"; **"Next: Schedule"** (primary once anything is approved); green "All posts are approved."

### 4e. Schedule: `/create/[briefId]/schedule`
Files: `src\app\(app)\create\[briefId]\schedule\page.tsx`, `src\components\create\schedule-screen.tsx`.

- **Header:** h1 "Create a post", StepBar, h2 "Schedule". Width `md:max-w-3xl`.
- **Empty card:** "Nothing is approved yet. Approve a post in the review step first." with the secondary button "Back to the review".

Content:

- **Intro card (bold):** "Here is when each post goes out. Nothing is posted until you confirm."
- **Proposal card per channel**
  - Line: "{channel}: {when} · {mode}". Modes: "We'll publish it" / "We'll email it to you".
  - Button "Pick another time" / "Use the suggested time", which opens the select "Time for {channel}".
  - When no slot exists: "{channel}: there is no free time before this offer ends{end}." and "You can post it now, or skip it."
- **Buttons:** primary **"Confirm"** ("Scheduling..."), secondary **"Post now"** ("Sending...").
- **"Scheduled" card:** lines "{channel}: {when} · {mode}" or "{channel}: {status}", plus the secondary button "See the Queue".
- **Amber "Not approved yet" card:** "{channel} is waiting for your approval." with the link "Back to the review".
- **Collapsible "Download or share a post yourself now":** per post, "{channel} post" with a SharePanel.
- **Bottom:** secondary "Back to the review"; text link "Make another post".

---

## 5. Queue: `/week` (nav label "Queue")
Files: `src\app\(app)\week\page.tsx`, `src\components\queue\queue-screen.tsx`, `src\components\week\{week-view,post-card,mascot-controls}.tsx`, `src\components\share\share-buttons.tsx`, `src\components\results\checkin-card.tsx`.

- **Purpose:** what is scheduled or needs attention, settings, and the weekly AI suggestions.
- **Header:** h1 "Queue", intro "Approved posts wait here for their time. Nothing goes out until you approve it."
- **Phone only:** a coral button "Create a post" on the right of the header.

Sections, in order:

1. **Check-in card** (only if unanswered)
   - "Did last week's posts bring enquiries?" with "For the week of {date}".
   - Three equal buttons: None / A few / Many. The selected one is solid coral.
   - Status: "Saved: {answer}. You can change it."
2. **Messages**
   - Paused banner (amber): "The queue is paused. Nothing is sent until you switch it back on in the settings."
3. **Needs your attention** (only if any)
   - Intro: "Skip, post now, or move. These were not sent."
   - A grid of ItemCards.
4. **Coming up**
   - Day sub-headings (`uppercase text-sm stone-500`) over a 2-column grid of ItemCards.
   - Empty: "Nothing is scheduled yet. Approve a post, then schedule it, and it shows here." with the secondary button "Create a post".
5. **Ready to schedule**
   - Intro: "Approved, but not in the queue yet."
   - Empty: "Nothing is waiting. Approved posts you have not scheduled show here."
   - Each card: thumbnail, channel, headline. Buttons: coral "Schedule", "Pick a time", "Post now", "Open the post". Ended offers show the amber line "The offer has ended, so this was never sent."
6. **Sent lately** (only if any)
7. **Queue settings** card (details below)
8. **This week** (border-top), the weekly suggestions (details below)

**ItemCard:**
- Thumbnail 80/96 px ("No image" placeholder), h3 channel, status pill.
- Statuses: Scheduled / Sending now / Published / Sent to you / Missed / Skipped / Expired / Could not publish.
- When-line, headline, mode label ("Auto-publish" / "We'll email it to you").
- Amber reason lines:
  - "Its time passed before it was sent."
  - "We could not publish this. We emailed it to you so you can share it yourself."
  - "The offer has ended, so this was never sent."
- Links: "View on {channel}", "Open to share".
- Actions: "Move", coral "Post now", "Skip", "Take out of the queue".
- The slot picker select is labelled "Choose a new time for {channel}", with buttons "Move it here" and "Cancel".

**Queue settings card:**
- Hint: "How often, on which days and at what time posts go out. Times are in {zone}."
- "Posts per week" select (1 to 7).
- "Days": "A post goes out on one of these days." with toggle buttons Mon to Sun.
- "Time for each channel": a card per channel with the channel name and "Connected: posts are published for you." / "Not connected: we email the post to you.", a "{channel} time" time input, and the checkbox "Auto-approve posts with no flags".
- Amber note: "A post with nothing to check is approved and queued by itself, with no tap from you. Posts with a "Please check" flag always wait for you. Off unless you turn it on."
- Checkbox "Email me posts I share myself" / "At the time of a post that cannot be published automatically, we email it to you with a Share button."
- Checkbox "Pause the queue" / "Nothing is sent and reminders stop until you switch it back on. Posts that pass their time meanwhile show under "Needs your attention"."
- Primary "Save settings" ("Saving..."), link "Connections".

**This week (WeekView):**
- "Posts for the week of {date}".
- Generating box: "Generating… (about a minute)" / "You can leave this page open. The posts appear here when they are ready."
- Red failed box: "We could not make your posts this time" / "Nothing was saved. Please try again in a minute."
- Green "Your posts are ready".
- Primary "Generate this week's posts", or secondary "Generate new posts" with "New posts replace the ones below. You can do this {n} more times this week."
- Empty: "No posts for this week yet."

**Weekly post cards** (2-column grid on lg):
- Picture: on phones 96 px beside the text; on lg on top, `h-80`.
- Header line: "{Day} · {channel}" plus a status pill: Not approved yet / Approved / Skipped / Posted on {date}.
- Optional "For {occasion}".
- Caption, then "{n} to check" or "Ready".
- Flags box, the same as Review.
- When approved: "Share this post" with ShareButtons:
  - Phones: coral "Share" and "Share as story or status". Elsewhere: "Download square" / "Download story size" / "Download wide".
  - "Copy caption".
  - Divider, then "Did you post it?" and "Mark as posted".
  - After marking: "Not posted yet" (undo).
- Buttons: coral "Approve", "Skip", "Edit" / "Close", "Undo".
- **Editor** (opens inside the card, 2 columns on lg):
  - "Your mascot on this post": radios "Show my mascot" / "No mascot", a "Pose" select (Wave, Talk, Point, Think, Celebrate, Present, Rest), "What the mascot says (up to {max} characters)", coral "Save mascot choice".
  - "The words": "Caption", "Call to action (also on the image)", "Hashtags (separate with commas or spaces)", "Headline on the image", "Second line on the image", coral "Save changes".
  - "The photo": "Pick a photo from your library, or none for a text-only design." Grid plus "No photo (text only)". Buttons "Use this photo" and "Use it anyway". Thumbs can show "Looks dark or blurry".
  - "Rewrite with an instruction": "Tell us what to change in a few words. It takes a few seconds." Pill chips: Shorter / Less salesy / More friendly / Add an emoji. Input "Your instruction" (placeholder "For example: less salesy"), coral "Rewrite". While working: "Rewriting... (up to 15 seconds)".

---

## 6. Brand page: `/brand`
Files: `src\app\(app)\brand\page.tsx`, `src\components\brand\*`, `src\components\uploads\*`, `src\components\instagram\instagram-card.tsx`, `src\components\account\account-panel.tsx`, `src\components\brand-pickers.tsx`.

- **Header:** h1 "Your brand memory", intro "Your posts are built from what is on this page, and nothing else. Every fact shows where it came from. Change anything, any time."
- **Phone only:** links "Connections" and "Mascot".
- **Sections:** each is a collapsible `<details>` card (`rounded-2xl border bg-white`). The summary is a `text-lg font-bold` title with a chevron that rotates when open.
- **Layout:** Facts, Selling points and Contacts are full width. The rest sit 2 to a row on lg.

Cards, in order:

### 6.1 Your facts (open by default)
- Intro: "Posts only use facts from this list. If it is not here, a post will not state it."
- **Website box**
  - "Website address" input.
  - Hint: "We read up to 5 pages for facts. Facts you edited or added yourself are kept. If you change the address, your existing facts are kept until the new address has been read successfully."
  - "Last read: {date}." / "Not read yet." / "No website. Facts you add yourself are used."
  - Secondary button "Read my website again" or "Read my website" ("Reading your website... this can take up to a minute.").
  - Result lines, for example: "Done. We read {pages} and found {facts}."
- **Empty:** "No facts yet. Add one yourself, or read your website."
- **Groups** (h3 with a count): Products and services / Prices / Offers / Opening hours / Contact / What makes you different / Claims / Other facts.
- **Fact item card**
  - Value (medium), optional label.
  - Source pill: "From your website" (a link), "From setup", "From an upload", "Added by you", or "Edited by you (was from {origin})".
  - Collapsible "What the page said" quote.
  - Amber promise chips: "Posts won't repeat this: health, money, legal and education promises can break advertising rules." / "This promises a result. Only keep it if you can stand behind it."
  - Links: "Edit", "Remove" (red).
- **Add / edit form** (stone-50 box)
  - "Type" select: Product or service, Price, Offer, Opening hours, Address, Phone, Email, What makes you different, Claim, Other.
  - "Name (optional)", placeholder "e.g. Sourdough loaf".
  - "Fact" textarea, placeholder "e.g. £4.50".
  - Primary "Save fact", secondary "Cancel".
- Secondary button "Add a fact".

### 6.2 Your selling points
- Intro: "The points your posts can feature, like a discount, a price or a rating. Posts use only what is listed here."
- Empty: "No selling points yet. Add your first one."
- 2-column list.
- **Item**
  - Title, then "{kind} · {summary}".
  - Source pill: Added by you / From your setup answers / Suggested from your website (sky) / From Instagram / From YouTube.
  - For claims: checkbox "I confirm this is true" with "Posts will not use this until you confirm it." (amber) or "Confirmed by you." (green).
  - Links: "Move up", "Move down", "Edit", "Remove".
- **Form**
  - "Type": Discount, Price, Quality or feature, Reviews and rating, Speed and delivery, Guarantee or warranty, Experience and trust, Free extra or trial, Your own words.
  - "Short line shown on a post" (hint "Up to 60 characters. Leave it empty and we will suggest one.").
  - Kind-specific fields. Discount, for example: "Percent off", "Or an amount off", "Currency", "What it is on", checkbox "Say "up to" (only if the discount really varies)", "From (optional)", "Until (optional)".
  - Editing a claim shows: "If you change the claim, you will need to confirm it again."
  - Buttons "Save", "Cancel".
- Secondary button "Add a selling point".

### 6.3 How customers reach you
- Intro: "Phone, website, address and hours that your posts can show. Turn a line off to keep it off new posts."
- Empty: "No contact details yet. Add your phone number or website."
- **Item**
  - Kind label, value.
  - Source pill.
  - For links: "Link works" (emerald) or "Not checked yet".
  - Checkbox "Show on new posts".
  - Links: "Edit", "Check link" ("Checking..."), "Remove".
  - If unreachable: "We could not open this link".
- **Form**
  - "Type": Phone, WhatsApp, Website, Email, Address, Opening hours, Map link, Booking link, Instagram, YouTube, Facebook, Other link.
  - A value field labelled by kind, for example "Phone number" or "Address as it appears on a post" (hint "Short: street and town. Up to 120 characters."), plus "Full address (optional)" and "Name of the link".
  - Hours kind: Monday to Sunday rows with "Closed" or from/to times, the link "Copy Monday to all days", and the note "Written as text. Set the days below to use them on posts."
  - Checkbox "Show on new posts".
  - Buttons "Save", "Cancel".
- Secondary button "Add a contact detail".

### 6.4 Your voice
- h3 "How you write".
- Notes: "Updating from your posts..." / "Add a past post and we will describe your writing style here."
- Textarea "Your style" with the link "Save" and "Saved.".
- "Phrases you use": grey pills with ×, or "No phrases yet.". Input with placeholder "e.g. the kettle is always on" and an "Add" button.
- "Words to avoid": pills, or "Nothing on the list yet.". Input with placeholder "e.g. cheap" and "Add".
- "We suggest avoiding": rows with "Add to words to avoid" / "Dismiss".
- Secondary button "Update from my posts" ("Updating...").

### 6.5 Logo and colours
1. **Keep my look** (stone-50 box)
   - "We can look at your website colours and up to 12 of your own Instagram pictures and suggest colours, fonts and a theme that match. We match colours, mood and layout, not exact fonts or artwork."
   - Secondary "Read my look" ("Looking…").
   - Result:
     - Summary text and "Based on {n} of your Instagram pictures + your website colours".
     - Swatches.
     - "Theme: X · Fonts: Y (headlines), Z (text)".
     - Amber notes.
     - Buttons: primary "Keep my look", secondary "Try a fresh look", "Read my look".
2. **Website offers** (optional)
   - Coral-tinted box "Use the logo from your website?" / "We found a logo on your website. You can replace or remove it afterwards." with "Yes, use it" / "No thanks".
   - Box "From your website" with a swatch and "Yes, use it".
3. **Logo**
   - Uploader, as in setup.
   - Amber low-resolution warning: "This logo is small ({w} x {h})…"
   - "White background" choice: "With background" / "Without background" on a checkerboard, chips "Use with background" / "Use without background".
4. **Colours** ("Pick the colours your posts use. Start from a ready palette or choose your own.")
   - Palette grid, 2 columns of buttons, each a 3-part swatch with a name. "From your logo" plus the 6 presets.
   - "Pick your own colour" picker.
   - 4 pickers: Main colour / Second colour / Highlight / Background.
   - Amber contrast warning with "Use {color} instead" / "Use a white/dark background".
   - Link "Suggest a look from my colours".
5. **Fonts** ("One for big headlines, one for the smaller text.")
   - "Headline font" and "Body font", each with chips: Clean sans / Classic serif / Friendly rounded / Tall and narrow / Bold display.
   - A sample card: the business name and "A line of text in this font."
6. **Style**
   - Toggle pairs: Corners (Rounded / Sharp), Mood (Light / Dark), Energy (Calm / Bold).
7. **Your default theme** ("The look we start with for new posts. You can pick another when you make a post.")
   - A 3-column grid of 9 cards (preview or dashed placeholder, name, description):
     - Classic ("The look of your posts so far, unchanged.")
     - Clean
     - Bold sale
     - Premium
     - Playful
     - Festive
     - Local and traditional
     - Minimal dark
     - Fresh
8. **Text logo**
   - Checkbox "Use my business name as a text logo when I have no logo", with a preview "Your text logo".
   - Line "Using the mascot in posts is set in Your mascot." (link).
9. Primary **"Save my look"** ("Saving..." / "Look saved.").

### 6.6 Your mascot (brand card)
- 80 px Tween drawing plus a status line: "Tween, in your colours, can go in your posts." / "A mascot may not suit your kind of business, but you can still try it." / "A mascot is not offered for your kind of business." / "Your mascot is {name}.".
- Button "See your mascot" (primary) or "Open your mascot" (secondary).
- Checkbox "Use the mascot in my posts" / "Your weekly posts get Tween with a speech bubble. You can switch it off for any post."

### 6.7 Photos and past posts
1. **Your Instagram** ("Add your @name and we read your recent public posts. You do not log in to anything.")
   - Input "Instagram name", placeholder "@yourbusiness", note "Only add your own business's account."
   - Buttons: primary "Bring in my recent posts" (or "Save my Instagram name"), "Refresh", "Remove Instagram posts".
   - Status lines, for example: "{n} posts from @{handle} added to your past posts".
   - Sub-box "Photos from your posts" with "Choose photos from my posts", a checkbox grid, and "Add to my photos".
2. **Your photos** ("Add photos of your products, shop and work. Up to 30 photos.")
   - Secondary "Add photos" ("Adding {n} of {total}..."), count "{n} of {max} photos".
   - Empty: "No photos yet. Posts need photos, so add a few."
   - 2-column tiles: description, "This photo looks dark or blurry; it may not look good in posts", checkbox "Has people in it" with "Only use photos of people who agreed to be in your posts.", red link "Delete".
3. **Your past posts** ("Add 3 to 5 posts you have shared before, so new posts sound like you.")
   - Buttons "Paste text" / "Upload screenshot" ("Reading your screenshot..."), count "{n} of {max} posts".
   - Paste form: "Paste the post text", placeholder "Paste a caption you have used before", "Save post" / "Cancel".
   - Items: "From a screenshot", pill "From Instagram" with "View on Instagram", text, "Edit" / "Delete".
   - Empty: "No past posts yet."

### 6.8 Your dates
- Intro: "Add days you want posts to mention: an anniversary, a sale, a local event."
- List rows: name, date, "(every year)", red "Remove". Empty: "No dates yet."
- Add form: "Date", "Name" (placeholder "e.g. Shop anniversary"), checkbox "Every year", secondary "Add date".
- **"Coming up in the next 8 weeks"** ("These are the days your posts may mention. Public holidays for your country are included.")
  - "Week of {date}" headings, each with occasion rows or "Nothing coming up".
  - Pills: "Your date", and amber "Sensitive day".

### 6.9 Payment QR code
Copy lives in `src\lib\payments\copy.ts`.
- Intro: "Show a QR code on your posts that opens a payment app with your UPI ID filled in…"
- Not-India message: "Payment QR codes for your country are coming; use a payment link QR instead."
- ID rows: "UPI · {id}", payee, status ("Waiting for you to confirm by email" / "Active" / "Retired"), red "Retire this ID".
- QR preview figure: "Scan to pay", ID, name.
- Form:
  - "Payment method" (UPI, disabled).
  - "UPI ID" (hint "Looks like name@bank", placeholder "name@bank").
  - "Name shown to the payer" (hint "The name on your bank account or business name (up to 60 characters)").
  - Button "Save and send confirmation email".
  - Sent note: "We emailed you a link. Open it within 1 hour to confirm the ID."
- Non-owner: "Only the owner of this business can change the payment ID."

### 6.10 Settings (this is the "account settings" screen)
- Intro: "These answers shape every weekly set of posts."
- Fields:
  - Business name
  - What you sell (hint "One line is enough. We use it to spot regulated businesses.")
  - Your customers
  - Country
  - State or region
  - City or town
  - Time zone
  - Goal (select: More enquiries / More visits / Get known)
  - Tone (Friendly / Professional / Playful / Like my past posts)
  - Post language
  - Minutes one post takes you today
  - Weekly email day and Weekly email time, side by side, with "In your time zone."
  - "Where should "learn more" links go?" (hint "A web address starting with http or https. Leave empty to use your website.")
  - "Regulated category" (hint about stricter wording), "We think: {group}", select "Automatic (…)" / None / Health / Finance / Alcohol / Legal / Other, with the amber reminder "Check your local advertising rules before you share posts."
- Box "Weekly email": "Weekly emails are on." / paused / unsubscribed, and "You will be able to pause or restart emails here soon."
- Primary "Save settings", then "Saved.".

### 6.11 Your data
- Intro: "Your business details, photos and posts are yours. You can take a copy, or delete everything, whenever you like."
- **"Download my data"**: body text and a secondary link-button "Download my data".
- **"Delete my account"** (after a border-top): long warning body, red-outlined full-width button "Delete my account". After sending: a box "Check your inbox" / "We sent a link to {email}…".
- Link "Read our privacy notice and terms".

---

## 7. Connections: `/connections`
Files: `src\app\(app)\connections\page.tsx`, `src\components\connections\publish-card.tsx`.

- **Header:** h1 "Connections", intro "Where your business is online, and where your posts can go. Nothing is posted anywhere without your approval."
- **Result banner** (green or red):
  - "Connected. We can now post your approved designs there." / "Disconnected."
  - Or an error, for example "You did not allow access, so nothing was connected."

Cards:

1. **Instagram import card:** the same InstagramCard as on the Brand page, plus the note "Import reads your public posts; Connect lets us publish for you."
2. **"Publish for you"** heading
   - Intro: "Connect once and we post your approved designs at their time. Nothing is posted until you approve it, and you can disconnect any time."
   - Two cards (side by side on lg): **"Publish to Instagram"** and **"Publish to Facebook"**.
   - Status pill: "Connected" (green) / "Needs reconnecting" (amber) / "Setup pending" (stone).
   - Body:
     - Instagram: "Sign in to Instagram once and allow us to post your approved designs. Until then, we email you each post to share yourself."
     - Facebook: "Sign in to Facebook once and choose your Page…"
   - When connected:
     - "Account: {name}".
     - "Permission renews on its own; it currently ends on {date}." / "The permission ends on {date}. Reconnect to keep auto-posting." / "No expiry date."
   - Expired: "We stopped posting here because the permission ended…"
   - Account notes:
     - Instagram: "Business or creator account needed. A personal account cannot be posted to by apps. You can switch for free in the Instagram app: Settings > Account type and tools."
     - Facebook: "Facebook Page needed…"
   - Pending notes: "Connecting is not switched on yet…" / "Connecting is paused until the app's security key is set…"
   - Non-owner: "Only the owner of the business can connect or disconnect."
   - Buttons: "Connect" / "Reconnect", plus a collapsible "Disconnect" with "Disconnect? We stop posting there and delete the saved permission. Your posts stay safe." and the button "Yes, disconnect".
3. **YouTube** card
   - "Your channel: {handle}", or "No channel saved yet." with the link "Add it on your Brand page".
   - Note: "Reading your channel's videos for your look and voice is coming soon."

**Sub-page `/connections/facebook`:**
- h1 "Choose your Facebook Page", intro "We will post your approved designs to this Page."
- Radio list of Pages, primary "Use this Page", secondary "Cancel".
- Empty: "No Pages found. Go back and try again."

---

## 8. Results: `/results`
Files: `src\app\(app)\results\page.tsx`, `src\components\results\{checkin-card,review-reply-card}.tsx`. QR scan copy is in `src\lib\qr\copy.ts`.

- **Header:** h1 "Your results".
- **Check-in card:** the same as on the Queue.
- **Empty:** "Your results will show here after your first week of posts."
- Otherwise a 2-column grid of cards (bordered on md+):
  1. **Posts shared**
     - Line, for example "You shared {n} this month, up from {last} in {month}."
     - Two stat tiles: "This month" / "Last month", each "{n} posts".
  2. **Time saved**
     - "You saved {time} this month."
     - "Posts shared this month, {posts}, times the {minutes} minutes you told us a post takes."
     - Or the coral link "Tell us how long a post takes you to see time saved".
  3. **Clicks on your links**
     - "Your links got {clicks} this month." and "Last month: {clicks}."
     - Lists "Clicks per post: {month}". Each row: topic, "channel · date", "at least {n} clicks". Empty: "No clicks in this month."
     - Footnote: "These are the clicks we could count…"
  4. **QR code scans**
     - "Your QR codes were scanned at least {n} times this month." / "No QR code scans yet this month."
     - Lists "Scans per post: {month}".
     - Footnote: "Scans are counted separately from link clicks…"
  5. **Enquiries, from your check-ins**
     - Rows "Week of {date}" with None / A few / Many / Not answered.
- **Grey note:** "Not counted here: messages, calls and walk-ins. Your weekly check-in is how we track those."
- **Reply to a review** card (stone-50)
  - Intro: "Paste a customer review and we will write a reply in your voice. Copy it into Google or wherever the review is."
  - Textarea "The customer's review" (placeholder "Paste the review here", hint "10 to 3000 characters. We do not save what you paste.").
  - Select "Reply language" ("Same as the review" plus the language list).
  - Primary "Write a reply" ("Writing your reply…").
  - Result:
    - Amber attention box: "This review mentions something serious…"
    - "Please check" flags.
    - Textarea "Your reply. You can change it before you copy it."
    - Buttons "Copy" / "Copied" and "Try again".

---

## 9. History: `/history`
Files: `src\app\(app)\history\page.tsx`, `history-list.tsx`, `history-card.tsx`, `history-table.tsx`.

- **Header:** h1 "Past posts".
- **Filters** (aria "Filter your posts"):
  - "Date": link-chips All / Today / This week / This month, plus a date input with the secondary button "Show".
  - "Language": chips Any / हिंदी / Hinglish / English.
- **Empty states** (grey centred box):
  - "No posts yet" / "Your posts will show here once you make one." with primary "Make a post".
  - Filtered: "No posts match" / "Try a different date or language." with secondary "Show all posts".
- **Phone cards:**
  - 80 px thumbnail ("No image"), date-time, title (or "No caption").
  - Language pills, status pill: Draft (stone) / Ready to post (green) / Could not be made (red) / Still making (amber).
  - Footer "Download" dropdown: Instagram image / Story image / Facebook image. Disabled when empty: "No images to download".
- **Desktop table:** columns **Post | Created | Language | Status | Actions**, with the same content.
- Secondary "Load more" ("Loading..."). Error: "We could not load more posts. Please try again."
- Rows link to `/review/[postId]`.

## 10. Old result screen: `/review/[postId]`
Files: `src\app\(app)\review\[postId]\page.tsx`, `output-cards.tsx`. This is the v1 result screen and is still reachable from History.

- h1 "Your posts", with "Language: {Hindi (Devanagari) / Hinglish / English}".
- Cards (2 columns on md):
  - Channel title: "Instagram post" / "Story / WhatsApp status" / "Facebook post" / "Google Business Profile update".
  - 3-way language radio: हिंदी / Hinglish / English. While working: "Changing language...".
  - Image, or "Text only, no image".
  - Amber "Please check:" list.
  - "Text to post" in a grey box.
- Primary "Make another post".
- Failed / generating states: "This post could not be made" / "Something went wrong while making it. Please try again." and "Still making your posts" / "Please wait a moment and refresh this page."

## 11. Mascot: `/mascot`
Files: `src\app\(app)\mascot\page.tsx`, `mascot-screen.tsx`.

- **Header:** h1 "Your mascot", intro "Tween is the character in your posts. It wears your colours."
- Emerald note: "Tween, in your colours. Use it in your posts and download it any time."
- Regulated box: "A mascot is not offered for your kind of business" with the explanation.
- Formal box: "A mascot may not suit your kind of business" with the secondary button "Try anyway".
- **Layout on lg:** 2 columns.
  - Left:
    - "Tween, in your colours": 3 poses (Wave, Point, Celebrate) in a white card.
    - The sheet image, "Each pose comes as a transparent PNG and as an SVG. The sheet shows all 7 together.", and primary "Download all" ("Downloading..."). Before saving: "Turn Tween on or save a choice to get the files."
  - Right:
    - "Name" (hint "What your posts call the character. You can keep Tween.").
    - "Scarf colour" (hint "Pick one of your brand colours, or Tween blue."), swatch buttons: Main colour / Second colour / Accent colour / Tween blue.
    - Primary "Save".
    - Checkbox "Use the mascot in my posts" with help text.

## 12. Plan: `/plan` (not in the nav)
- h1 "This week's plan", text "Coming soon. Your weekly plan will show here."

## 13. Admin dashboard: `/admin`
Files: `src\app\admin\page.tsx`, `src\components\admin\{panels,toolbar}.tsx`. Its text is hard-coded English, not in `strings.ts`.

- **Frame:** no app shell. `main max-w-6xl px-4 py-6`.
- **Header:** h1 "Admin", "Read-only view of all brands. Times are UTC."
- **Toolbar:** "Last updated {time}", a small secondary "Refresh" ("Refreshing…"), checkbox "Refresh every 60 seconds".
- **Panels:** white `rounded-xl border p-4`, h2 `text-lg bold`. Stat tiles are stone-50 with a big number and a label. Tables have bordered rows; problem rows are red-50.
  1. **Overview:** stats "Owners signed up", "Brands", "New owners, last 7 days", "New owners, last 30 days", "Active brands, last 7 days". Note "Active means…".
  2. **AI cost:** note "Weekly cap per brand: $X. In fixture mode every cost is $0."
     - Stats: Today (UTC) / Last 7 days / Last 30 days.
     - "By kind of AI call" table: Kind | Calls, 7 days | Cost, 7 days | Calls, 30 days | Cost, 30 days. Empty: "No AI usage in the last 30 days."
     - "Top 10 brands this week (against the $X cap)" table: Brand | Cost this week | Calls | Cap ("OVER CAP" / "under"). Empty: "No AI usage this week yet."
  3. **Posts, last 14 days:** table Day | Created | Approved | Published | Delivered, with mini bars (stone-400, coral/60, emerald-600). Empty: "No posts in the last 14 days."
  4. **Publishing queue:**
     - Status count pills.
     - "Stuck for more than N minutes" table: Brand | Channel | State | Planned for | Minutes late | Tries. Empty: "Nothing is stuck."
     - "Latest failures" table: When | Brand | Channel | Tries | Error. Empty: "No failed posts."
  5. **Side by side:**
     - **Connected accounts:** pills "{provider} {status}: n". "Recent problems" table: When | Brand | Account | State | Error.
     - **Meta data-deletion requests:** count pills, "Oldest waiting request: … (n days ago)".
  6. **Email, last 7 days:** table Kind | Sent | Failed | Waiting. "Recent failures" table: When | Kind | Brand | To | Error.

## 14. Public and no-login pages

**`/terms`** (`src\app\terms\page.tsx`)
- White column, 720 px on md.
- h1 "Terms of use", amber pill "Draft — to be reviewed by a lawyer before launch", intro.
- Sections: "Your mascot", "Facts in your posts", "Delete your data".
- **"Privacy"** with sub-heads: What we store / Why / We never sell your data / Download or delete / Photos of people / AI by Google Gemini / Email by Resend.
- "Holiday data", then the link "Back to Weekly Posts".

**`/account/deleted`**
- Auth-style card: "Your account has been deleted" with body text and the link "Back to sign in".

**`/account/delete`** (HTML from `src\lib\account\delete-page.ts`)
- "Delete everything?" / "This can't be undone."
- What-is-deleted text.
- Input "Type your business name to confirm" (hint "Type: {name}").
- Buttons "Delete everything" and "No, keep my account".
- Invalid link page: "This link does not work" with the link "Go to my Brand page".

**`/meta/deletion/[code]`**
- Auth-style card: "Data deletion request".
- Status text: received / done / "We could not find a request with this code.", plus "Requested {date}".

**`/r/[code]/card`** (public business card from a short link)
- h1 business name, city.
- Sections Phone / Email / Address / Opening hours, as underlined links.
- Empty: "Contact details are not available yet."
- **`/r/[code]` not found:** "This link has expired or doesn't exist" / "Please check the link, or ask the business that shared it."

**`/e/[token]`** (no-login email action pages)
- Rendered as inline-styled HTML by `src\lib\links\page.ts`.
- Shell: 560 px column (a 640 px white card with border and radius 16 on md+, page background `#fafaf9`), system font, coral "Weekly Posts" wordmark, h1 22 px.
- Buttons: full-width primary (coral, 18 px semibold) or secondary (`#f5f5f4` with a `#d6d3d1` border).
- Pages:
  - **view_week:** "Your posts for the week of {date}". Cards: "{day} · {channel} - {status}", image, caption, amber "Please check: n things", stacked buttons Approve / Edit / Skip. Empty: "There are no posts for this week."
  - **approve:** "Approve this post?" / "This is how it will look. Check it, then approve." / "Approve this post". Then "Approved" / "Your post is approved and ready to share." with Undo / "See posts ready to share" / "Edit this post".
  - **skip:** "Skip this post?" / "We will leave it out. You can change your mind." / "Skip this post". Then "Skipped".
  - **edit:** "Edit this post" / "Change the words, swap the photo, or ask for a rewrite." with the same text, photo and rewrite forms as the dashboard editor, plus "Review and approve".
  - **ready:** "Ready to share" / "Approved posts for the week of {date}". Per post: Share / Share as story or status / Download square, story size or wide / Copy caption / collapsible "Text to paste" / "Did you post it?" / "Mark as posted", or a blue pill "Posted on {date}" with "Not posted yet". Footer link "See all posts for this week".
  - **checkin:** "Did last week's posts bring enquiries?" / "For the week of {date}", big radio rows None / A few / Many, "Save my answer". Then "Thank you".
  - **pause:** "Pause emails for 2 weeks?" / "Pause for 2 weeks". Then "Emails paused" / "Resume now". Then "Emails are back on".
  - **unsubscribe:** "Stop weekly emails?" / "Stop weekly emails". Then "You are unsubscribed" / "Resubscribe". Then "Welcome back".
  - **resume:** "Send my weekly posts again?" / "Yes, send them again". Then "Weekly posts are back on".
  - **Error pages:** "This link has expired" / "This page has timed out" / "Something went wrong" / "We could not find that" / "Weekly emails are turned off" / "This is coming soon", each with a secondary "Sign in".
  - **Queue delivery "ready" page** (`src\lib\queue\ready-page.ts`): "Your post is ready" / "It is time to post this on {channel}. Share the picture and paste the caption." / "For {channel}" / "Pictures".

**`/p/[token]`** (payment ID confirmation, `src\lib\payments\confirm-link.ts`, copy in `paymentCopy.page`)
- "Confirm your payment ID" with ID / Name / Business, "This replaces your current ID…", button "Confirm this ID".
- Then "Payment ID confirmed".
- Other states: expired / used / invalid / replaced titles.

**`/i/[token]`** serves images only (no UI).

**Dev only** (404 in production):
- `/dev/outbox`: "Dev outbox", email cards with sandboxed iframes, "Show plain text" / "Show HTML".
- `/dev/costs`: "Dev costs" table Week | Brand | Cost | Cap | Calls.

---

## 15. Other notes for the designer
- **Copy outside `strings.ts`:**
  - `src\lib\kit\copy.ts`: Look / colours / fonts / themes
  - `src\lib\style\copy.ts`: Keep my look
  - `src\lib\payments\copy.ts`: Payment QR
  - `src\lib\qr\copy.ts`: QR scans
  - Admin page text is hard-coded in `src\components\admin\panels.tsx` and `toolbar.tsx`.
- **Built but not on any page:**
  - `ProfileForm`, `VoiceAnswer`, `BrandSwitcher`
  - Create pickers `UspPicker`, `DatesPicker`, `NewUspCard`, `BlocksPicker`
  - Their strings are still in `strings.ts` (`create.usps`, `create.dates`, `create.blocks`, `create.cta`, `brand.*`, `setup.*`).
- **Recurring patterns to restyle consistently:**
  - Status pill colour pairs.
  - Amber "Please check" boxes with `<mark class="bg-amber-200">` highlights.
  - Grey stone-50 info boxes.
  - Coral selected-state ring.
  - Collapsible `<details>` sections.
  - Bordered white cards: `rounded-xl` or `rounded-2xl`, `border-stone-200`, `p-3`/`p-4`.