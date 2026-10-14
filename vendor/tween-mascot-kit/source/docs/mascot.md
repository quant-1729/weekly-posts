# Tween, the on-site mascot: build spec

Status: ready to build. Owner decisions made on the user's behalf are marked **[DEFAULT]** and can be changed later.
Scored by `mascot/mascot_eval.md`. Read both files fully before writing code.

## 1. What this is

Tween is the Tweencrew mascot (`brand/tween-mascot.svg`: navy rounded-square body, white eyes, cobalt scarf, morpankh feather).
Today it is a still, docked widget (`components/TweenPet.tsx`) with route-aware tips.
This build turns it into a **host for the site**: a character that moves, gestures, talks in speech bubbles, guides a visitor
through the site, presents work and plans, and can take a pilot request conversationally.

Inspiration: petclaw.ai (a desktop pet that idles, reacts, talks and helps). We replicate the *feel*, not the product.
Tween is **not** an AI assistant in this build. Every line it says is written content. The design must make a live AI brain
a later, swappable addition (section 9) without rewriting the character or the UI.

Primary job **[DEFAULT]**: get a qualified visitor to a pilot request, and show real work and plans on the way.
Never block, never nag, easy to hide.

## 2. Non-negotiables (inherited from the site)

1. **Honesty.** The studio is new and says so. No invented clients, results, prices, timelines, awards or testimonials in any
   Tween line. Anything unknown uses the existing marker grammar (`[PLACEHOLDER: ...]`, `[CONFIRM: ...]`, tied to a PH id) and
   the existing production guard must keep refusing to ship while markers remain. Tween's copy goes through the same
   banned-phrase lint (`lib/lint-honesty.ts`) as all other content.
2. **No third-party runtime.** No external scripts, fonts, images, CDNs or analytics beyond what the site already allows. Respect the CSP in `next.config.ts`.
3. **Accessibility (WCAG 2.2 AA).** Full keyboard use, screen-reader-correct, reduced motion respected, a visible way to pause or hide Tween, no motion longer than 5 s without a control.
4. **Performance.** Tween must not harm LCP or CLS. It loads after the page is idle and is code-split. Home Lighthouse performance must not drop versus the current baseline (90 to 96).
5. **Privacy.** Only non-personal UI state is stored on the device (hidden, tour seen, voice on). Name and email typed into the chat flow are sent only on explicit submit, with consent, to the existing lead endpoint.
6. **Content is data.** All words live in typed JSON under `content/` validated by zod in `lib/content-schema.ts`, like the rest of the site. No copy hard-coded in components (the current "Another tip" string is a known miss and must be fixed).

## 3. Features

### 3.1 Character and animation (Phase A)

Tween becomes a rigged SVG character built from separate parts: body, head or face group, eyes (white, pupil, lids), mouth
(several shapes), two arms, two legs and feet, scarf with a tail that trails, feather, shadow.

Required poses and states, each a named state in one state machine:

| State | Description |
|---|---|
| `idle` | Gentle bob, blink on a random 3 to 6 s interval, occasional look-around. |
| `walk` | Leg and arm cycle, body bob, scarf trails opposite to direction, faces direction of travel. |
| `wave` | Raised arm waves. Used for greeting and goodbye. |
| `point` | Arm points left or right (or up) toward a target, eyes look at it. |
| `talk` | Mouth cycles through shapes while a line is being displayed. Duration follows text length. |
| `think` | Hand to chin or eyes up, small dots bubble. Used before answering a choice. |
| `celebrate` | Hop with both arms up. Used on a sent request. |
| `sleep` | Eyes closed, slow breathing, "z" glyph. After 60 s of no input, docked only. |
| `peek` | Half-visible at the screen edge. This is the hidden or dismissed state (replaces the current tab). |
| `shrug` | Used when a choice has no answer yet or a placeholder is unresolved. |

Eyes follow the pointer on devices with a fine pointer (already prototyped). Each state transition eases, never snaps.
Animation uses CSS transforms and the Web Animations API or a tiny dependency-free controller. **No animation library** unless
bundle impact is shown and justified in `DECISIONS.md` (budget in section 8).
`prefers-reduced-motion: reduce`: no walking, no bobbing, no hopping. State changes use a still pose swap or a fade, and speech still works.

### 3.2 Movement (Phase A)

- **Docked mode** (default, and the only mode on viewports under 768 px): Tween sits bottom-right, above the mobile sticky CTA, never over the footer text or form.
- **Roaming mode** (desktop only, 768 px and up, motion allowed): Tween can **walk along the bottom edge of the viewport** between docked positions and a point near a target. It does not walk across content and never covers the text the visitor is reading.
- **Pointing at things:** to draw attention to an element Tween (1) walks to the nearest viewport edge or gutter beside it, (2) faces it and points, (3) a soft spotlight ring appears around the target element itself, (4) after the line, the ring fades and Tween walks home. Targets are addressed by `data-tween-target="<id>"` attributes added to sections, not brittle selectors.
- Tween stays inside the viewport at every size from 320 px to 1920 px, survives resize and scroll, and never causes horizontal scroll or layout shift (it is `position: fixed` and out of flow).
- Smooth scrolling to a target respects reduced motion (instant jump).

### 3.3 Speech (Phase B)

- Speech bubble with a tail toward Tween, typewriter reveal at a readable rate (skippable by click, instant under reduced motion), max about 140 characters per bubble, multi-bubble sequences for longer lines.
- Bubbles are real DOM text, readable by screen readers: a polite live region announces each new line **only when the panel is open**; the unprompted greeting is not announced.
- Choice chips under the bubble (2 to 4 buttons). Free text input is not part of this build.
- A transcript list is available to keyboard and screen-reader users (the conversation so far), visually collapsible.
- Optional spoken voice **[DEFAULT: off, opt-in]** using the browser's built-in `speechSynthesis`, toggled by a visible button, remembered on device. Mouth animates while speaking. If `speechSynthesis` is unavailable the toggle is not shown. Pre-recorded or generated audio is a later phase, not this build.

### 3.4 Guided tour and presenting (Phase B)

A written dialogue graph (section 5). Starting points a visitor can pick:

1. **"What does a pilot involve?"** Tween walks to and points at the How-it-works steps, then Plans.
2. **"Show me work"** Tween opens the Work page content: points at the work grid. If published work exists it opens one item in the existing lightbox. In preview it points at the placeholder slots and says plainly that real work is not published yet.
3. **"What does it cost?"** Honors `priceDisplay`. If prices are hidden it says that pricing is scoped per pilot and points at Plans. It never states a number that is not in `content/plans.json`.
4. **"How do you use AI?"** Short honest summary pulled from existing Trust content, then link to `/trust`.
5. **"I am an agency / a startup"** Routes to `/for/agencies` or `/for/startups` and points at the relevant section.
6. **"Plan a pilot"** Starts the lead flow (3.5).
7. **"Just browsing"** Tween says a short line, goes to `idle`, and stays quiet.

Tween may react to the page: a short, once-per-session tip on route change (existing behaviour, kept), and a nudge after 45 s of idle on Plans or Work (once per session, dismissible, never on the form page).

### 3.5 Conversational lead capture (Phase B)

A short in-chat flow that collects the same required fields as the form, using the **existing lead API and schema** (`app/api/lead/route.ts`, `lib/schema.ts`, `lib/lead-fields.ts`): name, work email, company website, what they want to make, and a consent checkbox with the existing consent wording. Rules:

- Each step validates with the real zod rules and shows the same error copy as the form.
- Honeypot and time-trap fields are carried over. A bot filling it instantly gets the same generic success behaviour as the form.
- "Open the full form" is always one click away and keeps any answers already given (prefill via `sessionStorage`, cleared on submit).
- On success Tween plays `celebrate` and shows the same success copy as the form. On failure it shows the form's error copy and the fallback email.
- Analytics events reuse `lib/tracking.ts`; new event names are added there, not ad hoc.

### 3.6 Controls and settings

A small gear or menu on the Tween panel with: Hide Tween, Pause animation, Voice on or off, Restart the tour, "Do not roam" (docked only). All remembered on device.
Tween is hidden by default in print and in `prefers-reduced-data` contexts is optional.

### 3.7 Safe limits

- Tween never covers the primary CTA, form fields, the mobile menu or an open lightbox. It hides while the lightbox, menu or form is in view.
- Tween never auto-plays audio.
- No more than one unprompted bubble per page view and three per session.

## 4. Code structure

New, under `components/mascot/` and `lib/mascot/` (the old `components/TweenPet.tsx` is removed once the new one is wired; keep its Esc, outside-click and storage-safety behaviour):

- `components/mascot/Tween.tsx` client entry, lazy-loaded after idle from the layout.
- `components/mascot/TweenRig.tsx` the SVG character with part groups and per-state classes.
- `components/mascot/rig.css` (or Tailwind layer in `app/globals.css`) for pose and cycle animation.
- `components/mascot/Bubble.tsx`, `Chips.tsx`, `Transcript.tsx`, `Controls.tsx`, `Spotlight.tsx`, `LeadFlow.tsx`.
- `lib/mascot/machine.ts` pure state machine: `(state, event) -> state`, no DOM. Unit-tested.
- `lib/mascot/dialogue.ts` pure dialogue runner over the content graph. Unit-tested.
- `lib/mascot/motion.ts` movement planner (target rect + viewport to destination, clamped). Unit-tested.
- `lib/mascot/brain.ts` the interface a future AI brain implements (section 9). Only the scripted implementation ships.
- `content/mascot.json` all copy, graph, tips and labels. Schema in `lib/content-schema.ts`.
- `data-tween-target` attributes added to the real sections in `components/sections/*` and pages.
- Wire into `app/layout.tsx`. Keep `StickyCta` and the footer reserved space correct.

## 5. Dialogue content schema (summary)

```
{ "start": "root",
  "nodes": { "<id>": {
      "say": ["line", "line"],            // each line is one bubble, honesty-linted
      "pose": "talk|point|think|wave|shrug|celebrate",
      "do":   [ {"goto":"/plans"}, {"scroll":"plans"}, {"point":"how-steps"}, {"lightbox":"first-published"}, {"leadFlow":true} ],
      "choices": [ {"label":"...", "next":"<id>"} ]   // 0 to 4
  } },
  "tips": { "/": [ ... ], "/work": [ ... ] },          // route-aware, carried over from system.json
  "nudges": { "/plans": "...", "/work": "..." },
  "ui": { every button, label, aria text }
}
```

Every `point` and `scroll` id must exist as a `data-tween-target` on the page named by the preceding `goto` (or the current page).
A unit test walks the whole graph and fails on a dangling `next`, unknown target, unreachable node, or a lint hit.

## 6. Phases

- **Phase A, character and movement.** Rig, states, eyes, docked and roaming modes, pointing and spotlight, controls to hide and pause, reduced motion. Done when eval groups M-A to M-D pass.
- **Phase B, guide and lead flow.** Content graph, bubbles, choices, transcript, tour, lead flow, nudges, optional browser voice. Done when eval groups M-E to M-H pass.
- **Phase C (not in this build):** pre-recorded voice, memory across visits, an AI brain. Design hooks only.

## 7. Out of scope for this build

Live AI or any model call, free-text chat, generated or recorded audio, new analytics vendors, user accounts, cross-visit personal memory, a desktop app.

## 8. Budgets

- Added client JS for Tween, gzipped, lazy chunk: **<= 30 KB**. Nothing from it in the initial route bundle except a tiny loader (<= 1 KB).
- Zero effect on LCP element or CLS (measured by Lighthouse before and after on `/`, `/work`, `/plans`).
- Main thread: no animation frame work while Tween is idle off-screen, hidden, paused or the tab is hidden. Pointer tracking is throttled to animation frames (already so).
- Memory: no listeners left after unmount or hide.

## 9. Future brain interface (design only)

`lib/mascot/brain.ts` exports `interface Brain { next(input: BrainInput): Promise<BrainOutput> }` where output is the same
shape a dialogue node has (`say`, `pose`, `do`, `choices`). The scripted dialogue runner is one implementation. A later AI
implementation must be constrained to this output shape and to the site's content, must label itself as AI, and must pass the same honesty lint. Do not build it now.

## 10. Process rules for the builder

- Work only in the files named in section 4, plus `app/layout.tsx`, `app/globals.css`, `lib/content-schema.ts`, `lib/tracking.ts`, `data-tween-target` additions, tests, and docs. Do not restyle or rewrite other site features.
- Another agent or the user may have the preview server on :3100 open. Use `scripts/restart.sh` to rebuild, and do not kill other ports (3200, 3300 are fixtures).
- Commit in small steps if the project is a git repo; otherwise keep a `mascot/CHANGELOG.md`.
- Append decisions and deviations to `DECISIONS.md` under a "Mascot" heading. Record anything you could not do honestly in `mascot/STATUS.md`.
- Do not claim a gate passes without running the command in the eval. Paste the evidence into `mascot/eval-results/`.
- Visual quality matters: look at screenshots of every state at 1440 px and 375 px and fix what looks wrong before declaring a phase done.
