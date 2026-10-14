# Tween mascot kit

Everything for Tween, the Tweencrew mascot, pulled out of the Tweencrew site (`tweencrew-site-updated-2026-10-10.zip`).

**Start here:** open `index.html` in a browser. It plays every action live, lets you switch backgrounds, makes the eyes follow your pointer, and links each action's files. It works offline.

## What's inside

| Folder | Contents |
|---|---|
| `index.html` | Offline player for every action |
| `ACTIONS.md` | Every action: what it does, when the site plays it, loop length, pose angles |
| `poses/` | 18 still key poses as transparent PNG (1100 × 1100) and SVG |
| `animations/` | 19 looping actions as animated SVG, GIF, MP4, transparent WebM and sprite sheets |
| `brand/` | Reference mascot (SVG, PNG, transparent and on canvas), character sheet with the palette, favicon, social avatar |
| `brand/concepts/` | AI-generated concept sheet of extra poses (clap, thumbs-up, sign, present, sit, run). Not built into the rig yet |
| `illustrations/` | The six site illustrations with Tween (presenting, dashboard, sky, waving banner) as WebP, AVIF and PNG |
| `reference/on-site-screenshots/` | How each state looks on the live site, desktop and mobile, plus the rig contact sheets |
| `source/` | The mascot code from the site: rig (`components/mascot/TweenRig.tsx` and `rig.css`), state machine, movement, dialogue, lead flow, copy (`content/mascot.json`), tests, and the spec and owner notes in `docs/` |

## Actions

Core: idle, walk (left and right), wave, point (left, right, up), talk, think, celebrate, sleep, shrug, peek.
Intro: reach, present, climb, perch. Extras: cover (hands over eyes), land (squash and stretch).
Details in `ACTIONS.md`.

## Palette

| Colour | Hex | Use |
|---|---|---|
| Ink navy | `#0B1C30` | Body, limbs |
| Cobalt | `#2B4CFF` | Scarf (dark `#203CD9`, light `#5B78FF`) |
| White | `#FFFFFF` | Eyes, mouth |
| Peacock teal | `#119C9A` | Feather only (dark `#0B6F73`, light `#3CC6A8`) |
| Feather gold | `#F3B63A` | Feather eye |
| Feather orange | `#F26A21` | Feather eye |
| Feather eye blue | `#1D5FA8` | Feather eye |
| Coral | `#FF6B4A` | Highlights only (confetti, letter seal) |
| Canvas | `#F8F9FF` | Background used for GIF and MP4 |

Navy on a dark background needs a thin white halo to read; the site adds `drop-shadow(0 0 1.5px rgba(255,255,255,0.9))`. The exports leave it off.

## How these were made

All poses and animations are rendered from the site's own rig code (`TweenRig.tsx` + `rig.css`), so they match the site exactly. Changes made only for the exports:

- One-shot gestures (wave, celebrate, reach) loop forever instead of playing 3 to 4 times.
- Blink is a fixed CSS loop (the site blinks at random from JavaScript).
- Ambient sways (bob, scarf, feather) are retimed slightly so every clip loops without a jump.
- `land` adds a short drop before the site's squash so it reads on its own.
- `peek` is the full mirrored pose; on the site it is cropped by the screen edge.

## Known weaknesses (from the site's own `source/docs/STATUS.md`)

- Arms are thin with round paddle hands, so the think hand reads as abstract.
- The scarf tail crosses the legs mid-walk, which makes those frames look busy.
- The walk turn shifts the face sideways; it is not a true three-quarter view.
