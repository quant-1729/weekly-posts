# Image prompts for the Tweencrew site

Everything here is for an AI image generator. No real photos are needed right now (see the end).

## How to use

1. **Attach `brand/tween-character-sheet.png` as a reference image** to every prompt that includes Tween. This is the single biggest factor for keeping Tween identical across images. If your tool has no reference image, paste the TWEEN block into the prompt instead.
2. Paste the **STYLE** block after the scene text in every prompt, and the **NEGATIVE** block in the negative-prompt box (or at the end as "Avoid: ...").
3. **Never ask the model to write text.** Image models spell badly. All words go on in an editor afterwards. Every prompt leaves clean space for that.
4. Generate 4 to 8 options per image, pick the one where Tween's face, feather and scarf match the sheet, and save at the size listed.
5. Save into `public/work/<piece>/` or `brand/` as listed, and tell me. I will convert to WebP/AVIF and wire them in.

### TWEEN (paste if you cannot attach the reference)
Tween, a small cartoon character: a tall rounded-square body in deep navy (#0B1C30), two large round white eyes with dark pupils and a small white highlight, a small white smile, a bright cobalt (#2B4CFF) scarf around the middle with one tail hanging down on its left, a real peacock feather (morpankh) tilted at the upper right of the head with a teal body and a gold, orange and blue eye, thin tapered arms with flat paddle-shaped hands, thin tapered legs with wide flat oval feet turned slightly outward. Flat vector, no outline.

### STYLE (append to every prompt)
Flat 2D vector animation style, clean geometric shapes, crisp edges, no gradients, no film grain, no thick outlines. Palette: pale cool background #F8F9FF, deep navy #0B1C30, electric cobalt #2B4CFF as the main accent, white #FFFFFF cards, a small touch of warm coral #FF6B4A only for highlights, and the peacock-feather teal #119C9A with gold #F3B63A only on Tween's feather. Soft ambient shadow under objects only. Generous empty space. No text anywhere in the image.

### NEGATIVE (append to every prompt)
photorealistic people, real faces or likenesses, real brand logos, any readable text, letters, numbers or fake UI copy, watermarks, extra fingers, neon glow, gradients, robot or circuit imagery, sparkles, stock-photo look, 3D render, character design changing between images, existing cartoon characters.

---

## A. Poster frames (stand-ins until the real videos exist)

A poster is the still shown before a video plays. When the real video is made, we replace each of these with a frame from it. Until then these keep the site from showing grey boxes. Leave the bottom 20% quiet for the play button.

### A1. `hero-poster-16x9` (1920x1080)
Where: the hero of the home page.
```
[TWEEN] stands at the left third of the frame, three-quarter view, one arm raised presenting toward the right, friendly confident expression. On the right, a large simplified abstract app window made of rounded rectangles, a rising line chart, three round icons and soft bars, floating slightly. A few small floating shapes (circles, rounded squares) in cobalt and coral drift between them. Calm, spacious, balanced composition, the lower fifth of the frame left empty. [STYLE]
```
Save: `public/work/hero/poster-16x9.png`

### A2. `w2-tidewick-poster-16x9` (1920x1080)
Where: the fictional "Tidewick" product explainer card (a concept sample, labelled fictional on the site). Assumes Tidewick is a workflow dashboard; tell me if you want a different idea.
```
A clean abstract software dashboard shown as a hero shot: a large rounded window with a gentle wave-shaped line chart, two stat cards, a progress ring and a small calendar grid, all made of simple shapes with no readable text. A soft cobalt wave motif flows behind the window like a tide. [TWEEN] peeks in from the bottom right corner, holding a small round magnifier, curious expression. Lots of empty space, lower fifth quiet. [STYLE]
```
Save: `public/work/tidewick/poster-16x9.png`

### A3. `w3-cutdown-poster-9x16` (1080x1920)
Where: the vertical cutdown card.
```
Vertical composition. [TWEEN] centred in the lower middle, full body, pointing upward with one arm toward a stack of three floating rounded cards above it (one cobalt, one white, one coral), the cards slightly overlapping and tilted. Plain pale background, a thin cobalt arc behind the character. The top fifth and bottom fifth left empty for captions and platform buttons. [STYLE]
```
Save: `public/work/cutdown/poster-9x16.png`

### A4. `w3-cutdown-poster-1x1` (1080x1080)
Where: the square cutdown card.
```
Square composition. [TWEEN] on the left, full body, waving, happy expression. On the right, one large rounded white card showing a simple progress ring and two bars, tilted three degrees, with a small cobalt circle badge on its corner. Even margins on all sides, centre of gravity slightly left. [STYLE]
```
Save: `public/work/cutdown/poster-1x1.png`

### A5. `w4-story-poster-9x16` (1080x1920) — only if you use the story reels
Where: the optional story and character reel card.
```
Vertical composition. [TWEEN] sitting on the edge of a floating rounded platform in a pale sky, legs swinging, looking up at a paper-plane shape drifting across, wistful but happy. Soft cobalt cloud shapes, a small coral sun circle. Quiet, storybook mood, large empty sky at the top. [STYLE]
```
Save: `public/work/story/poster-9x16.png`

---

## B. "How it was made" frames for the airport explainer

These go on the work page for "Why Is Airport Food So Expensive?". They show how the piece was made, so they must be about that video, not Tween. The video's star is an animated **burger** with a face.

### B1. `w1-process-storyboard` (1600x900)
```
A rough pencil storyboard panel, 16:9, loose graphite lines on off-white paper with slight paper texture. Scene: an animated cheeseburger character with a worried face stands on an airport counter beside a long paper receipt and a small cash register, with a large airport window and a plane behind. Simple camera arrows and a small scene-number box in the top-left corner drawn in navy ink, drawn as empty boxes with no numbers or words. Grayscale except one cobalt arrow. Hand-drawn storyboard look. [NEGATIVE]
```
Alt text to use: "A rough pencil storyboard panel of the burger character at an airport counter beside a receipt."
Save: `public/work/why-so-pricey/process-storyboard.png`

### B2. `w1-process-character-sheet` (1600x900)
```
Character model sheet for an animated cheeseburger character, 16:9 on a plain pale background. Top row: front, three-quarter and side views at equal height. Middle row: six faces (neutral, surprised, worried, thinking, smug, delighted). Bottom row: three poses (pointing left, holding a receipt, shrugging). Same proportions and colours in every view. Round sesame-seed bun, lettuce, tomato, melted cheese, patty, simple dot eyes with blush, tiny mouth. Four colour swatches along the bottom edge. Flat 2D vector style, clean shapes, no gradients, no text. [NEGATIVE]
```
Alt text: "A character sheet of the burger character in several views, faces and poses."
Save: `public/work/why-so-pricey/process-character-sheet.png`

### B3. final frame — **no generation needed**
Use a real frame from the finished video (I can extract the 0:03 receipt frame, or the 1:00 ACI-NA chart frame, whichever you prefer).

---

## C. Optional extras

### C1. Tween extra poses sheet (for a richer mascot) — 3200x1800
Only if you want Tween to gain clapping, thumbs-up, holding a sign and presenting poses. I will then redraw them as code.
```
Character pose sheet of [TWEEN], 16:9 on a plain pale background, identical design in every pose, six poses in a 3x2 grid: clapping both hands, thumbs-up with a wink, holding a blank rectangular sign board in both hands, presenting with one arm sweeping toward an empty space, sitting cross-legged, running in a hurry. Hands drawn as clear mittens with a visible thumb. Arms slightly thicker than stick lines. [STYLE]
```
Save: `brand/tween-extra-poses.png`

### C2. Tidewick logo mark (fictional product) — 1024x1024
For the concept sample only.
```
A simple app icon for a fictional product: a rounded square in cobalt (#2B4CFF) with one white wave-shaped line crossing it and a small coral dot above the wave. Flat, minimal, centred, generous padding, plain pale background. No text. [NEGATIVE]
```
Save: `public/work/tidewick/logo.png`

### C3. Social profile image — 1024x1024
For YouTube, Instagram and LinkedIn avatars (not on the site).
```
[TWEEN]'s face only, centred and large, on a solid cobalt (#2B4CFF) rounded-square tile with a small white margin; the feather inside the frame. Flat vector. [NEGATIVE]
```
Save: `brand/social-avatar.png`

### C4. Custom share image — 1200x630 (optional)
The site already generates one from the wordmark and headline. Only make this if you want something richer.
```
Wide banner. [TWEEN] on the right waving, soft cobalt wave shapes across the bottom, large empty pale area on the left for the headline. [STYLE]
```
Save: `public/og-custom.png`

---

## Real photos or images I need from you

**None right now.** The founder photo and team section were removed, and the Careers page has no images.

Real material is needed only for these, if and when you want them:
- **Screens of a real product**, if a client supplies their interface for a video. Never generate these.
- **Real client logos**, only with written permission.
- **Real footage frames** from the finished videos (the poster replacements in section A).
- **Team or studio photos**, only if you later decide to add them.

Not images, but still waiting on you: the finished videos and cutdowns, the three confirmations on the airport video (ownership, fact-check, upload date), the work titles and descriptions, and the legal entity details.
