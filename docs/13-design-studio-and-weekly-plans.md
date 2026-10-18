# Design Studio and weekly offer plans (owner request 2026-10-16)

The product is three stages that hand over to each other:

| Stage | Single post | A week of offers |
|---|---|---|
| 1. Requirements | Create a post: Details, On the post | **Plan a week** (`/plan`): one sentence ("Mon 10%, Tue 20% … on all cakes") is read by code into one offer per day; days, time, channels, button and photo |
| 2. Design | **Design Studio** (`/create/[id]/design`) | **Design Studio in plan mode** (`/plan/[id]/design`): one look for every day, each day keeps its own offer; any day can be edited on its own |
| 3. Automation | Review, Schedule | **Automate** (`/plan/[id]`): every day's picture, caption and checks; "Approve and schedule the week" puts each post in the queue at the plan's time (published if the channel is connected, else emailed ready to post) |

## Design Studio

- **Five starting designs** (`src/lib/studio/templates.ts`): Big offer, Photo hero, Elegant arch, Clean card, Playful pop. Made from the details (headline, offer, offer line, button, contacts, QR, logo, mascot, photo), the brand colours and font pairs. "Shuffle" gives the same compositions in other colours and fonts. Each works with and without a photo and in square, portrait 4:5 and story 9:16 (words stay inside the story safe zone).
- **Live editing**: every change redraws at once in the browser. Click to select, drag to move (snapping to the centre and to other layers, pink guides), corner handles resize (text corners scale the type), the round handle rotates (snaps every 15°), double-click words to type on the poster, arrows nudge, Ctrl+Z / Ctrl+Shift+Z, Ctrl+D duplicates, Delete removes.
- **Tool rail + one panel** (no long scrolling): Designs, Text (add text, every word on the poster in one list, text effects), Add (phone, WhatsApp, website, Instagram, Facebook, YouTube, Reddit, any link, email, address, hours; QR for this post or any link; offer stickers; shapes; icons; the mascot), Photos (upload, library, **Blend into poster**, remove background, frames, edge fade, duotone/tint, light and colour, crop), Brand (logo, name, brand colours, font pairs), Colours (colour sets from the brand, from the photo and curated; background), Layers (show/hide, lock, delete). The bar above the canvas holds everything for the selected thing (font, size, colour, bold, italic, capitals, alignment, spacing, effects; frame/blend for photos; arrange, duplicate, lock, delete). A floating **Add** button opens the Add panel.
- **Design check** in the top bar: words cut off or under the story bars, tiny text, text that is hard to read on the background, a QR too small to scan, and any words the fact check asks about.
- **Photo blending** ("Blend into poster"): code reads the photo (main colours, plain background or not, where the subject is; `src/lib/studio/photo.ts`). With live AI, Gemini looks at the photo once (about $0.002) and suggests the treatment, frame shape and palette (`src/lib/studio/smart-fit.ts`); offline the same answer comes from code. The studio then recolours the whole poster from the photo, centres the subject, warms the light, and frames, fades or **cuts out** the photo (flood fill from the edges in the browser, stored as a PNG of the brand). Every step can be changed or undone. The AI never draws or changes the photo and never writes text.
- **Sizes**: the owner edits any size; a size not opened yet is laid out again from the design (words, colours, fonts, photo treatment and added items carried over). Sizes the studio does not make (YouTube thumbnail, LinkedIn/GBP landscape, banner) are drawn by the existing engine; a brief that needs only those, and carousels, keep the old option designer.

### How it is built

- `src/lib/studio/types.ts`: the document (layers: text, image, shape, QR, contact chip, badge, icon, character) with zod validation.
- `src/lib/studio/shaper.ts`: HarfBuzz shaping into SVG paths, **the same code and font files in the browser and on the server**, so wrapping, sizes and Devanagari glyphs match exactly. The browser loads harfbuzzjs from `public/vendor/harfbuzz` (`npm run vendor:harfbuzz` after upgrading harfbuzzjs: its Node branch imports `module`, which the client bundle cannot resolve).
- `src/lib/studio/scene.ts`: document → SVG tree (masks, fades, duotone, sticker outlines, shadows, QR modules). The browser renders it as React SVG; the server serialises it and resvg rasterises (`src/lib/studio/server.ts`). Images are resolved only from this brand's own files or browser-made data URIs; nothing is fetched from the network.
- `src/lib/studio/service.ts`: what the studio starts from (`loadStudioPage`), save (`post_briefs.studio`), and "Use this design" (`finishStudio` → `applyStudioDesign` in `src/lib/create/posts.ts`): the words on the picture go through the guardrail like any edit (flags in Review), the engine draws every size, then the studio's sizes replace the engine's pictures; a QR that does not scan back exactly is a blocker. Review redraws (removing a flagged phrase, Undo all, filters) draw the studio sizes again (`restampStudio`).
- Fonts added (OFL, `assets/fonts`, licences beside them): Poppins, Montserrat, Anton, Bebas Neue, DM Serif Display, Pacifico, Lobster, Caveat, Baloo 2 and Yatra One (both with Devanagari).

## Weekly plans

- `src/lib/plans/parse.ts`: the sentence reader (English day names, short forms, ranges, "weekend", "weekdays", "every day", Hindi day names; %, ₹/Rs amounts, or text offers such as "buy 1 get 1"). Pure code: nothing is invented, anything not understood is listed back.
- `src/lib/plans/service.ts`: `createPlan` makes one dated selling point (the owner's offer, so the fact check knows it) and one ready brief per day (`post_briefs.plan_id`, `plan_date`); the days of one plan are not compared with each other by the repetition check. `finishPlanDesign` draws every day from the shared design (`applyDay` swaps the offer, and the day name inside the owner's own words); `approveAndSchedulePlan` approves what has nothing left to check and schedules each post at the plan's time on its day through the existing queue (`scheduleApproved` with the owner's time).
- Migration `supabase/migrations/0025_design_studio_and_plans.sql` (post_briefs.studio, post_plans with RLS, plan_id/plan_date). **Apply it before deploying the app.**

## Checks run

- `npm run typecheck` and eslint on the new code: clean.
- `npm test`: 4,480 passing before the last nav/test updates; the studio tests (`tests/studio`), create, guardrail, queue and layout suites pass after them.
- End to end in the browser (mock backend, fixture AI): plan sentence → 6 day briefs → studio (options, palettes, fonts, inline edit, add contact/QR, upload, blend, cut-out, per-day edit, size switch) → automation page with server-drawn pictures → scheduled by email.
- `next build` could not run in the sandbox (no access to Google Fonts for `next/font`); run it once on a normal machine before deploying.
