# Mascot: Tween (D9)

Owner decision 2026-10-13: **Tween** is the only mascot. It replaces the per-brand generator described in the old version of this file (D4, kept in git history). Source kit: `vendor/tween-mascot-kit/`.

Tween has two jobs:

1. **App guide (M-1).** The live Tween (rigged SVG, CSS animation, state machine, movement, speech bubbles) guides owners inside the app. Its words are scripted in `src/content/tween.json`; no AI. Code: `src/components/tween/`, `src/lib/tween/`.
2. **Brand mascot in posts (M-2).** Each business gets Tween with its scarf in the brand's colour. Gemini only writes the bubble line and picks one pose; it never designs the character.

## In posts

| Part | How |
|---|---|
| Drawing | `src/lib/mascot/tween.ts` builds a still SVG with plain `transform` attributes (resvg can't run the live rig's CSS variables). Same parts, joints and pose angles as the kit. |
| Likeness check | `tests/mascot/tween-reference.test.ts` compares 16 poses with the kit's 1100×1100 reference PNGs: silhouette IoU ≥ 0.99 (measured 0.9988-0.9993) and mean colour difference ≤ 1.5/255; a 30° arm change fails. Sheet: `test-results/tween/compare.png`. |
| Poses | `TWEEN_POST_POSES`: wave, talk, point, think, celebrate, present, idle (`src/lib/mascot/poses.ts`). `point` turns toward the post's text. Unknown or empty → wave. Sensitive occasions → no mascot. |
| Colours | `tweenColorsFor` (`src/lib/mascot/colors.ts`): body navy `#0B1C30`, eyes and feather stay Tween's. Scarf = brand primary, else secondary, else accent, else Tween blue `#2B4CFF`; a colour under 3:1 contrast with the navy body, or near white, is skipped. Confetti and the letter seal use the brand accent. The owner can pick the scarf colour. |
| Halo | A thin white halo when the background behind the mascot is dark (luminance < 0.35; photo templates measure the photo; full-photo templates always). |
| Bubble | Drawn by code with HarfBuzz text, and checked by the guardrail like any other post text. |
| Data | `mascots` row per brand, edited in place: `spec = { v: 2, base: 'tween', scarf }`, `name` (default "Tween", blocklist-checked, max 20 characters). Old v1 rows draw as Tween. `posts.mascot_id` null = mascot off. Stored post images never change; editing a post redraws it in the current colours. |
| Downloads | Pose SVG/PNG files and a sheet in `mascots/{brand_id}/{mascot_id}/`, redrawn when brand colours change. |
| Terms | "Your mascot is Tween, the Weekly Posts character, drawn in your colours. You can use the images we make of it in your own posts and marketing, and download them any time. The character itself stays ours, so please don't register it as your own trademark or logo." (for the lawyer review) |

## Eligibility rules (deterministic)

1. `isRegulatedCategory(category)` (health, finance, education) → **not eligible**, with no override. Mascot speech could carry claims in a regulated business.
2. **Formal** → not eligible by default, but the owner can choose "Try anyway". Formal means:
   - the category contains: law, legal, advocate, lawyer, notary, funeral, cremation, government, contractor, consultancy, real estate, property; or
   - the tone is "Premium". ("Simple and respectful" does not count: many ordinary kirana shops pick it.)
3. Otherwise → **eligible**.

Store the result in `brand_memory.mascot_eligibility` as `{ "eligible": bool, "reason": "regulated|formal|ok", "checked_at": "..." }`. Re-check it when the category or tone changes.
**Test:** all 20 brands in `test-data/mascot-eligibility-20.json` must give `expected_eligible`.
