# Tween: every action

Tween has 19 exported actions: the 10 core states from the site's state machine, the 4 intro poses, the cover gag, direction variants of walk and point, and the landing squash. Each action ships in these formats:

| Folder | Format | Notes |
|---|---|---|
| `poses/png/` | PNG, 1100 × 1100, transparent | Still key pose (no landing; that one is motion only) |
| `poses/svg/` | SVG, still | Vector, styles inline, opens anywhere |
| `animations/svg/` | SVG, animated | Loops in any browser, also as an `<img>`. Smallest file, infinitely scalable |
| `animations/gif/` | GIF, 480 × 480 | On the brand canvas `#F8F9FF` (GIF transparency has jagged edges) |
| `animations/mp4/` | H.264, 1080 × 1080, 25 fps | On `#F8F9FF`, two loops per file. For slides, socials, editors |
| `animations/webm/` | VP9 with alpha, 720 × 720 | Transparent video for web and for After Effects or Premiere |
| `animations/spritesheets/` | PNG grid, transparent | 220 × 220 frames, 10 per row, 25 fps. Frame counts are in `spritesheets.json` |

All files share one 550 × 550 canvas, so Tween stands on the same spot in every file and actions can be cut together without re-aligning. Every loop in a clip divides the clip length, so GIFs and videos loop without a jump.

## Core states (the site's state machine)

| Action | Face | Loop | What it does | When the site plays it |
|---|---|---|---|---|
| `idle` | neutral | 3.6 s | Gentle bob, scarf and feather sway, blink | Default resting state |
| `walk-right`, `walk-left` | neutral | 3.2 s (5 strides) | Legs stride, arms swing, body leans and the face turns toward travel, scarf tail flutters behind | Roaming along the bottom of the screen (desktop only) |
| `wave` | happy | 4.16 s | Right arm up, forearm waves | Greeting, "Just browsing", goodbye |
| `point-right`, `point-left`, `point-up` | neutral | 3.6 s | Arm out with an extended index finger, eyes on the target | Showing a section with a spotlight ring. Up is used when docked on mobile |
| `talk` | neutral, mouth cycles | 3.9 s | Three mouth shapes cycle, hand gestures | While a speech bubble types out |
| `think` | think (one brow up) | 4.8 s | Hand at the cheek, eyes up, three thought dots pulse | Before answering a choice |
| `celebrate` | joy (closed happy eyes) | 2.24 s | Hops with both arms up, confetti | A pilot request is sent |
| `sleep` | sleep | 9.6 s | Eyes closed, slow breathing, z's float up | 60 s with no input, docked only |
| `shrug` | worried | 3.6 s | Arms out, worried brows, wavy mouth | No answer yet, or an unresolved placeholder |
| `peek` | neutral | 3.6 s | Mirrored, one hand raised | The hidden state. On the site it sits half off the right edge; the mirror keeps the feather in view |

## Intro sequence (first visit to Home)

Tween walks in, lands with a squash, `reach`es into its scarf, `present`s a letter and tosses it onto the hero, walks under the wordmark, `climb`s the page and `perch`es on the header. A click or Escape skips to the end.

| Action | Face | Loop | What it does |
|---|---|---|---|
| `reach` | think | 3.6 s | Rummages in the scarf |
| `present` | happy | 3.6 s | One hop, then holds out the letter (white envelope with a coral seal) |
| `climb` | neutral | 3.0 s | Arms and legs alternate as it climbs |
| `perch` | happy | 5.6 s | Sits on the header with legs dangling |

## Extras

| Action | Loop | What it does | When the site plays it |
|---|---|---|---|
| `cover` | 3.6 s | Both hands over the eyes, one eye peeks over the fingers, giggles | While the visitor types an email address in the chat (a privacy gag) |
| `land` | 1.2 s | Short drop, then squash and stretch | After a jump (hard) or at the end of a walk (soft) |

Blink runs on every state whose eyes are open. The site blinks at random every 3 to 6 s from JavaScript; the exports use a fixed CSS blink so they stay self-contained.

## How the site drives Tween (behaviour, not animation)

Tween is scripted, not AI. Every line lives in `source/content/mascot.json`; a node has `say` (bubbles), `pose` and `do` steps.

| `do` step | Effect |
|---|---|
| `{ "goto": "/plans" }` | Navigates to a route |
| `{ "scroll": "id" }` / `{ "point": "id" }` | Scrolls to an element with `data-tween-target="id"`; with `point` Tween walks beside it, points, and rings it with a spotlight |
| `{ "lightbox": "first-published" }` | Opens the first published work item |
| `{ "leadFlow": true }` | Starts the in-chat pilot request (same `/api/lead` as the form) |
| `{ "quiet": true }` | Tween stays silent for the rest of the visit |

Entry points from the first bubble: what a pilot involves, show me work, what it costs, agency or startup, plan a pilot, just browsing. Unprompted speech is capped at one bubble per page view and three per session. Controls: hide, pause, voice (browser speech, off by default), restart the tour, do not roam.

## Rig anatomy (for animators)

Parts, back to front: shadow, legs (hip pivots at 172,340 and 228,340), arms (shoulders at 108,256 and 292,256; elbow 54 units down; paddle hand with thumb), body (rounded rect, rx 66), face (eyes, pupils, brows, six mouths), cover hands, feather (pivot 266,112), scarf tail (pivot 126,314), scarf band, then props (thought dots, z's, confetti).

A pose is a set of CSS variables on the `<svg>`: `--ual --fal --uar --far` (upper and fore arm angles, left and right), `--ll --lr` (legs), `--turn` (face shift), `--lean`, `--tilt`, `--drop`, `--tail`, `--ex --ey` (look direction). See `source/components/mascot/rig.css`.

| Pose | Left arm (upper, fore) | Right arm (upper, fore) | Other |
|---|---|---|---|
| rest | 24°, 10° | -24°, -10° | |
| talk | rest | -64°, -46° | |
| wave | rest | -150°, -20° | tilt -3° |
| point right | rest | -90°, 0° | turn 9px, lean 2° |
| point left | 90°, 0° | rest | turn -9px, lean -2° |
| point up | rest | -168°, -4° | look up |
| think | rest | -80°, -118° | tilt -4°, look up-right |
| celebrate | 150°, 14° | -150°, -14° | legs ±12° |
| shrug | 46°, 80° | -46°, -80° | tilt 4°, drop 2px |
| sleep | 16°, 4° | -16°, -4° | drop 8px, tilt 5° |
| peek | rest | -118°, -34° | tilt -5° (then mirrored) |
| reach | rest | 18°, -64° | tilt 4°, look down |
| present | rest | -112°, -38° | letter shown |
| climb | 165°, 10° | -165°, -10° | look up |
| perch | 58°, -30° | -58°, 30° | |
| cover | -140°, 0° | 140°, 0° | front hands over the eyes |
