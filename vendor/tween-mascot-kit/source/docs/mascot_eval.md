# Tween mascot: evaluation rubric

Scores `mascot/mascot.md`. Each check is **PASS / FAIL / NOT RUN**. Evidence is saved to `mascot/eval-results/` (command output,
screenshots, Lighthouse JSON). A check with no evidence is NOT RUN and scores zero. Never mark PASS from reading code alone
unless the check says "review".

## Verdict rules

- **Any Blocker (B) check failing = overall FAIL**, whatever the score.
- Otherwise: 90 to 100 = ship, 75 to 89 = ship with listed fixes, below 75 = not ready.
- Points per group are below. A group's points are earned proportionally to checks passed, Blockers counted first.

## Groups

### M-A Honesty and content (15 pts)

| Id | Check | How | Level |
|---|---|---|---|
| A1 | All Tween copy passes the banned-phrase lint and the fabrication lint. | `npx tsx scripts/check-content.ts` plus a unit test over `content/mascot.json`. | **B** |
| A2 | No Tween line states a price, client, result, date or capacity that is not in existing content. Any unknown uses a PH marker. | Review plus a unit test that every digit sequence or currency symbol in `content/mascot.json` also appears in the content it cites, or is a marker. | **B** |
| A3 | Production guard still refuses to build while any marker (including those in `content/mascot.json`) remains, and passes on the complete fixture. | Run the existing guard against preview and `tests/fixtures/content-complete`. | **B** |
| A4 | Tween never claims to be human or an AI assistant. Self-description is "the Tweencrew mascot". | Review. | B |
| A5 | No copy hard-coded in components; every visible or aria string comes from `content/mascot.json`. | Grep components for string literals in JSX, plus review. | |

### M-B Accessibility (20 pts)

| Id | Check | How | Level |
|---|---|---|---|
| B1 | axe-core: zero serious or critical violations on `/`, `/work`, `/plans`, `/contact`, with Tween closed, open, and mid-conversation. | Playwright + axe, desktop and mobile projects. | **B** |
| B2 | Everything is operable by keyboard: open, choose, skip typewriter, close, hide, pause, voice, restart. Visible focus on every control. Esc closes the panel and returns focus to the Tween button. No focus trap that cannot be left. | Playwright keyboard script. | **B** |
| B3 | `prefers-reduced-motion: reduce`: no walking, bobbing, hopping, typewriter or smooth scroll; state still conveyed; all features still work. | Playwright with `reducedMotion: "reduce"` asserting computed animation and transform values. | **B** |
| B4 | Pause or hide control is reachable within the first Tab sequence into Tween and persists. Hidden state survives reload. | Playwright. | **B** |
| B5 | Live-region behaviour: unprompted greeting is not announced; lines in an open panel are announced once each; transcript lists the conversation. | Playwright reading `aria-live` regions and DOM. | |
| B6 | Touch targets of every Tween control are at least 44 px; text contrast of bubbles, chips and controls passes AA (add Tween pairs to `lib/contrast.ts`). | Existing touch-target test extended plus contrast unit test. | |
| B7 | Tween never obscures focused elements on the page (WCAG 2.4.11). | Playwright: tab through the page with Tween docked and assert focused element is not covered. | |
| B8 | No content depends on audio. Voice is opt-in and off by default. | Playwright asserts no `speechSynthesis.speak` call without user action. | **B** |

### M-C Performance and robustness (15 pts)

| Id | Check | How | Level |
|---|---|---|---|
| C1 | Lighthouse (mobile preset as in `lighthouserc.cjs`) on `/`, `/work`, `/plans`: performance not below the pre-mascot baseline minus 2 points; LCP element unchanged; CLS contribution from Tween is 0. | Run `lhci` before (stash) and after. Save both JSON. | **B** |
| C2 | Tween chunk is lazy: not in the initial JS of `/`; gzipped size of the Tween chunk(s) is 30 KB or less. | Inspect build output and network log. | |
| C3 | No horizontal scroll and no layout shift at 320, 375, 768, 1024, 1440, 1920 px with Tween docked, open, and roaming. | Playwright. | **B** |
| C4 | No console errors or warnings, no failed requests, no third-party requests while using every feature. | Playwright console and network capture. | **B** |
| C5 | No leaked listeners or running animation frames when hidden, paused, or tab not visible. | Playwright evaluate counters, or review of cleanup code. | |
| C6 | Works when `localStorage` or `sessionStorage` throws, and with JavaScript disabled (the site still fully works; Tween is simply absent). | Playwright with blocked storage; existing no-JS test still passes. | **B** |
| C7 | Survives route changes (client navigation) without duplicating, resetting wrongly, or losing the panel state rule (panel closes on route change, conversation transcript persists per tab session). | Playwright. | |

### M-D Character and movement (15 pts)

| Id | Check | How | Level |
|---|---|---|---|
| D1 | All ten states exist and are individually reachable: idle, walk, wave, point, talk, think, celebrate, sleep, peek, shrug. A dev-only `?tween=state` URL param or test hook may be used, and must be absent in production. | Screenshot set per state at 1440 and 375 px saved to evidence. | **B** |
| D2 | **Visual review** by the builder, honestly: every state looks like the brand mascot (navy body, white eyes, cobalt scarf, feather), limbs attach correctly, no clipped or floating parts, no part crosses the face, scarf and feather read clearly. Record what is still weak. | Look at the screenshots; write the review in `mascot/STATUS.md`. | |
| D3 | The state machine is pure and unit-tested: all legal transitions, illegal ones ignored, sleep wakes on input, reduced motion maps motion states to still ones. | vitest. | |
| D4 | Roaming: on desktop with motion allowed, Tween walks to a target's nearest gutter or bottom edge and back, never leaving the viewport, never over the target text, never over the form or CTA. | Playwright geometry assertions across scroll positions. | **B** |
| D5 | Pointing: spotlight ring appears on the correct element (`data-tween-target`), tracks scroll and resize, and clears after the line. | Playwright. | |
| D6 | The movement planner is pure and unit-tested including clamping, targets taller than the viewport, targets off-screen, and tiny viewports. | vitest. | |
| D7 | Docked-only on viewports under 768 px, and when "Do not roam" is set. | Playwright. | |

### M-E Dialogue and guide (10 pts)

| Id | Check | How | Level |
|---|---|---|---|
| E1 | The dialogue graph validates: no dangling `next`, no unreachable node, every `point`/`scroll` target exists on its page, every `goto` is a real route, max four choices, max about 140 characters per line. | vitest walking `content/mascot.json` and the built routes. | **B** |
| E2 | Each of the seven entry points works end to end in the browser and lands the visitor somewhere correct and true. | Playwright script per entry point. | **B** |
| E3 | Price answers obey `priceDisplay`: hidden mode shows no number; priced fixture shows exactly the numbers in `plans.json`. | Playwright on :3100 and :3300. | **B** |
| E4 | Work entry in preview points at placeholder slots and says honestly that none is published; on the complete fixture (:3200) it opens a real item in the lightbox. | Playwright on both servers. | |
| E5 | Unprompted behaviour limits hold: at most one unprompted bubble per page view, three per session, none on `/contact`, none while the menu, lightbox, or form is active, idle nudge only once per session. | Playwright with fake timers or short waits. | |
| E6 | Dismissing Tween stops all unprompted behaviour on that device until brought back. | Playwright. | **B** |

### M-F Lead flow (10 pts)

| Id | Check | How | Level |
|---|---|---|---|
| F1 | A complete conversational request is accepted by the real endpoint and stored in the `file` store in preview, with the same fields as the form. | Playwright on :3100, then read the store file. | **B** |
| F2 | Validation uses the real schema: bad email, missing consent, empty required fields are rejected with the form's exact error copy. | Playwright. | **B** |
| F3 | Honeypot and time-trap behave as on the form (a bot-like instant submit does not create a real record and still shows a generic success). | Playwright with default `LEAD_MIN_FILL_MS`. | **B** |
| F4 | "Open the full form" carries answers into the form and no personal data remains in storage after submit or after the tab closes. | Playwright reading `sessionStorage`. | |
| F5 | Tracking events fire once each with the names added to `lib/tracking.ts`; no new vendor. | Existing events spec extended. | |
| F6 | Failure path: server error shows the form's error copy and the fallback email; the flow can retry. | Playwright with route interception. | |

### M-G Regression and quality gates (10 pts)

| Id | Check | How | Level |
|---|---|---|---|
| G1 | `npx tsc --noEmit` is clean. | Run. | **B** |
| G2 | `npx eslint .` is clean. | Run. | **B** |
| G3 | All existing unit tests (85 before this work) still pass, plus the new ones. | `npx vitest run`. | **B** |
| G4 | The full existing e2e suite (220 passed, 25 skipped by project before this work) still passes across all projects, plus the new specs. | `scripts/evidence.sh` or the project's Playwright command with all servers up. | **B** |
| G5 | `npm run build` in preview succeeds; production build against `tests/fixtures/content-complete` succeeds; production against the real content refuses while markers remain. | Run all three. | **B** |
| G6 | The old `components/TweenPet.tsx` is removed and nothing imports it. | Grep. | |

### M-H Documentation and honesty of the report (5 pts)

| Id | Check | How | Level |
|---|---|---|---|
| H1 | `DECISIONS.md` has a "Mascot" section covering library choices (or none), movement approach, voice default, and every deviation from `mascot.md`. | Review. | |
| H2 | `mascot/STATUS.md` lists what is done, what is not, known visual weaknesses, and anything not verified, with no overclaiming. | Review. | |
| H3 | `mascot/eval-results/SCORECARD.md` lists every check with PASS, FAIL or NOT RUN and an evidence path, with the final score and verdict computed by the rules above. | Review. | |
| H4 | Owner-facing notes: how to edit Tween's words, add a dialogue node, add a pose, and turn Tween off site-wide (a single content or env switch, tested). | Review plus a test of the off switch. | |

## Point weights

| Group | Points |
|---|---|
| M-A Honesty and content | 15 |
| M-B Accessibility | 20 |
| M-C Performance and robustness | 15 |
| M-D Character and movement | 15 |
| M-E Dialogue and guide | 10 |
| M-F Lead flow | 10 |
| M-G Regression and quality gates | 10 |
| M-H Documentation and report honesty | 5 |
| **Total** | **100** |

## Phase gates

- **Phase A done** when M-B (except lead-flow-related items), M-C, M-D, and M-G pass.
- **Phase B done** when M-A, M-E, M-F, and M-H also pass and the final scorecard has no Blocker failing.

## Honest-report rule

The builder must not describe a check as passing, a state as looking right, or the work as finished unless the evidence is in
`mascot/eval-results/`. "Not run" is an acceptable answer. An overclaim is a worse outcome than a failing check.
