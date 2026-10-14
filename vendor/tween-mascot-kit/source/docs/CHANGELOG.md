# Mascot changelog

Work was done in a tree that also held another agent's uncommitted edits (removal of the AI-use statement, Trust page and per-piece AI disclosure, new /careers). To avoid committing their work, only files that are wholly Tween's were committed. These shared files carry Tween hunks and are left uncommitted for the owner:

- `app/layout.tsx`: `TweenPet` replaced by `{mascotEnabled(getMascot()) && <TweenLoader />}`.
- `app/globals.css`: old prototype `.tween-*` rules removed.
- `components/ui/Layout.tsx`, `components/sections/Hero.tsx`, `components/sections/LandingPage.tsx`, `components/sections/HomeSections.tsx`: `data-tween-target` attributes.
- `components/forms/LeadForm.tsx`: uses `LEAD_ERROR_MESSAGES`; reads and clears the chat prefill once.
- `lib/lead-fields.ts`: exports `LEAD_ERROR_MESSAGES`.
- `lib/content-schema.ts`: `mascotSchema` added, `pet` removed from `systemSchema`.
- `lib/content.ts`: `getMascot()`.
- `lib/tracking.ts`: five `tween_*` event names.
- `lib/contrast.ts`: Tween colour pairs.
- `content/system.json`: `pet` block removed (moved to `content/mascot.json`).
- `components/TweenPet.tsx`: deleted.

Steps: (1) baseline Lighthouse of the still prototype; (2) content schema and `content/mascot.json`; (3) pure modules `lib/mascot/*` with unit tests; (4) rig and poses, looked at on a contact sheet; (5) Tween shell, panel, roaming, spotlight, controls; (6) dialogue, lead flow, nudges, voice; (7) layout-shift fixes (reserved layout, transform positioning); (8) e2e specs and evidence; (9) docs and scorecard.
