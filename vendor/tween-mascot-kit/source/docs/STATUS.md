# Tween mascot: status

## Done

- Phase A: rigged SVG character (brand shapes and colours), ten states in a pure state machine, docked and roaming movement, pointing with a spotlight ring, pause/hide/voice/restart/"do not roam" controls, reduced motion.
- Phase B: content graph in `content/mascot.json`, bubbles with a skippable typewriter, reply chips, transcript, live region, six entry points, route tips, idle nudge, optional browser voice (off by default), conversational lead flow on the existing `/api/lead`, site-wide off switch (content flag or `TWEEN_ENABLED=0`).
- Gates: tsc, eslint, 170 unit tests, 418 e2e (0 failed), three builds, production refusal on real content, Lighthouse before and after. See `eval-results/SCORECARD.md`.

## Not done, or changed on purpose

- The spec's seventh entry point ("How do you use AI?") is removed on the owner's instruction; Tween makes no statement about AI use. The `/trust` page no longer exists and no node points to it.
- Phase C (recorded voice, cross-visit memory, AI brain) is not built; only the interface in `lib/mascot/brain.ts` exists.
- Tween has no free-text chat (out of scope), so the narration fact the owner supplied is not used.
- Changes to shared files are uncommitted (another agent's edits are in the same tree); `mascot/CHANGELOG.md` lists them.

## Known visual weaknesses (from looking at `eval-results/shots/sheet-1440.png` and `sheet-375.png`)

- Arms are thin sticks with round hands. The "think" pose (hand at the cheek) and the shrug read as gestures but not as hands; the think hand is abstract.
- Navy on the dark stage band has little contrast. A thin white halo (CSS drop-shadow) fixes legibility but is not in the original brand art.
- The scarf tail overlaps the right foot (as in the brand art) and in the walk pose crosses the legs; mid-walk frames look busy.
- The walk screenshot is one frame of a loop; I judged it from that frame plus a still contact sheet, not from video.
- Sleep "z" glyphs are small at 375 px. The "peek" pose is a half-cropped, mirrored Tween with a raised hand; cute, but the crop cuts one eye in half by design.
- On viewports narrower than about 1366 px the side gutters are too narrow to stand in, so Tween stands over the page edge or bottom corner when pointing; the planner reports `clear: false` and takes the least-covered spot.
- The face turn for walking is a shift of the face group, not a true 3/4 view.

## Known behavioural weaknesses

- Lighthouse: Home performance 94 to 92 (the rule allows minus 2) and TBT 59 to 110 ms in the final run; the "before" baseline was taken before the other agent's content changes to Home, so some of that change is not Tween's. Absolute LCP on all three pages is about 2.8 to 3.2 s, over the 2.5 s lab budget; that was already recorded in `DECISIONS.md` section 7.
- One greeting per page view means a first visit to /plans or /work gets the idle nudge, not the greeting.
- A fast, repeated choice can interrupt the previous line (by design: a new choice cancels the run).

## Unverified

- Real screen readers (NVDA, VoiceOver, TalkBack), real phones and tablets, real speech output and voices, other browsers than installed Chrome.
- The off switch was unit-tested but the site was not rebuilt with it off.
- Paused and background-tab idle cost (no animation-frame loop exists by review; not profiled).
- Unprompted-behaviour blocking while the menu, lightbox or form is active is covered by unit tests, not by a browser run.
- B7 (focus never covered) ran on desktop /plans only.
- The time-trap at its default (3 s) was exercised through the route handler in a unit test, not through the browser.
