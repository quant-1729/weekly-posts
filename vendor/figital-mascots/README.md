# Figital Labs mascot: Parchi

Parchi is the Figital Labs mascot: the OPD slip (parchi) that every Indian patient carries between desks, gone digital. She lives inside Hospital OS, carries each patient's next step, and ticks it off. Pronoun: she.

**Start here:** open `index.html` in a browser. It plays every action, follows your pointer with her eyes in idle, and shows the character sheet and sample placements.

## What's inside

| Folder | Contents |
|---|---|
| `index.html` | Player for every action, character sheet, placements (works offline; fonts fall back without internet) |
| `ACTIONS.md` | Every action: what it does, when to use it, loop length |
| `poses/` | 41 still key poses as transparent PNG (1100 × 1100) and SVG |
| `animations/` | 41 looping actions as animated SVG, GIF, MP4, transparent WebM and sprite sheets |
| `brand/` | Mascot (SVG, PNG, on canvas), favicon (SVG and 16, 32, 48, 180, 512 px), social avatar, character sheet |
| `illustrations/` | Four marketing templates as PNG, with editable HTML sources in `illustrations/source/` |
| `source/` | The rig (`parchi-rig.js`) and the scripts that produced every file |

## Formats

| Folder | Format | Notes |
|---|---|---|
| `poses/png/` | PNG, 1100 × 1100, transparent | Still key pose per action |
| `poses/svg/` | SVG, still | Vector, opens anywhere |
| `animations/svg/` | SVG, animated (SMIL), 12.5 fps | Loops in any browser, also as an `<img>` |
| `animations/gif/` | GIF, 480 × 480 | On the brand canvas `#F3F6FA` |
| `animations/mp4/` | H.264, 1080 × 1080, 25 fps | On `#F3F6FA`, two loops per file; for slides, socials, editors |
| `animations/webm/` | VP9 with alpha, 720 × 720 | Transparent video for web, After Effects or Premiere |
| `animations/spritesheets/` | PNG grid, transparent | 220 × 220 cells, 10 per row, 25 fps; frame counts in `spritesheets.json` |

Every file shares one square canvas (viewBox `-10 0 260 260`), so Parchi stands on the same spot in every clip and actions cut together without re-aligning.

## Palette

| Colour | Hex | Use |
|---|---|---|
| Slip | `#FFFDF6` | Body |
| Hospital OS teal | `#2BB5B0` | Top band, next-step highlight |
| Deep teal | `#1A8C88` | Ticks, done stamp, pen |
| Ink navy | `#17253B` | Eyes, mouth, limbs |
| Blush | `#F7A8A0` | Cheeks |
| Gold | `#F2B33D` | Confetti and alert badges only |
| Canvas | `#F3F6FA` | Background for GIF and MP4 |

On navy backgrounds, add a thin white halo: `filter: drop-shadow(0 0 1.5px rgba(255,255,255,.9))`.

## Rules

- The checklist is abstract: bars, never real words, names, medicines or prices.
- The next step is outlined in teal; tick it only when the scene shows it done.
- Never show her in clinical notes, bills, complaint replies or data-privacy messages.
- Never crumple, tear or bin her; that reads as a lost step.
- Don't pop her up uninvited.
- "Parchi" is also student slang for an exam cheat-chit: no exam or test jokes, especially in AI Guru.

## Before public use

- Trademark search in India for "Parchi" (classes 9, 42, 44). Parchaa, a Delhi healthtech, uses a similar name.
- A site behaviour spec (where she appears, her lines, speech limits), adapted from the Tween spec.

## How these were made

Everything is drawn by one rig, `source/parchi-rig.js` (`ParchiRig.svg(action, t, options)`), so every format matches. Frames were rendered with headless Chrome and encoded with ffmpeg. To regenerate:

```
node source/export-poses.js
node source/dump-frames.js <framesDir> <kitDir>
python source/export_kit.py <framesDir> <kitDir> source
python source/brand.py <kitDir> source
```
