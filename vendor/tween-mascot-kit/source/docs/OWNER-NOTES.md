# Tween: owner notes

Tween is the Tweencrew mascot on the site. Every word it says is written content in `content/mascot.json`. There is no AI behind it.

## Edit Tween's words

1. Open `content/mascot.json`. Each entry under `nodes` is one thing Tween can say: `say` is a list of lines (one speech bubble each, keep each under 140 characters), `choices` are the buttons under it.
2. Route tips (`tips`), the idle nudges (`nudges`), the greeting, and every label and screen-reader text (`ui`, `lead`) are in the same file.
3. Rules: no prices, no client names, no results, no dates or promises that are not already on the site. If a fact is not known yet, write it as a marker, for example `[CONFIRM: what we claim, PH-17]`. Markers show as amber tags in preview and the production build refuses to ship while any remain, exactly as for the rest of the site.
4. Check your edit: `npx vitest run tests/unit/mascot.test.ts` (lint, graph, length) and `npm run check:content:preview`.
5. Price answers are never typed: the line `{priceLines}` is replaced at build time with exactly what the Plans page shows (nothing while prices are hidden).
6. The line `{tip}` inserts the tip for the page the visitor is on.

## Add a dialogue node

1. Add a key under `nodes`, for example `"referrals": { "say": ["..."], "pose": "talk", "choices": [ { "label": "Back to the start", "next": "root" } ] }`.
2. Link to it from another node's `choices` (`"next": "referrals"`). A node nothing links to fails the graph test. A node has at most four choices.
3. To take the visitor somewhere, add `do`: `{ "goto": "/plans" }` then `{ "point": "capacity" }`. `goto` must be a real route. `point` and `scroll` name a `data-tween-target` on that page: every section already has one, equal to its `id` (for example `pilot`, `capacity`, `steps`, `index`). To add a new target, put `data-tween-target="my-id"` on any element.
4. Other `do` actions: `{ "lightbox": "first-published" }` (opens the first published work item), `{ "leadFlow": true }` (starts the chat request), `{ "quiet": true }` (Tween stays silent for the rest of the visit).
5. `variants` lets a node change with the build: `hasWork`, `slots` (preview placeholders), `empty`, `priceHidden`, `pricesShown`. See the `work` and `cost` nodes.
6. Run `npx vitest run tests/unit/mascot.test.ts`, then rebuild.

## Add a pose

1. Name it in `lib/mascot/machine.ts` (`STATES`, `faceFor`) and, if a dialogue node should be able to ask for it, in `MASCOT_POSES` in `lib/content-schema.ts` and `poseEvent`.
2. Draw it in `components/mascot/rig.css`: one `[data-state="yourpose"]` block that sets the arm, leg and face variables (`--ual --fal --uar --far --ll --lr --turn --tilt ...`). Add a face to `TweenRig.tsx` only if the existing ones do not fit.
3. Add it to the state lists in `mascot/tools/shots.mjs` and `tests/e2e/mascot.both.spec.ts`, run `node mascot/tools/shots.mjs` and look at the pictures before shipping it.

## Turn Tween off site-wide

Either of these removes Tween from every page (no script, no request, `/api/mascot` answers 404):

- set `"enabled": false` in `content/mascot.json`, or
- set the environment variable `TWEEN_ENABLED=0` (or `false`, `off`) when you build.

Rebuild and redeploy. This is covered by unit tests (`H4` in `tests/unit/mascot.test.ts`). A visitor can also hide Tween for themselves with the Hide button; that is remembered on their device only.

## Where things are

- Character: `components/mascot/TweenRig.tsx` and `rig.css` (parts and poses); `lib/mascot/machine.ts` (states).
- Movement: `lib/mascot/motion.ts`. Dialogue: `lib/mascot/dialogue.ts`. Limits on unprompted speech: `lib/mascot/limits.ts`.
- Chat request: `components/mascot/LeadFlow.tsx` and `lib/mascot/lead.ts`; it posts to the same `/api/lead` as the form.
- Future AI brain: only the interface exists, `lib/mascot/brain.ts`. Nothing calls a model.
- Review pictures: `node mascot/tools/shots.mjs` (needs the preview on :3100). The `?tween=walk` style address works only in preview and test builds.
