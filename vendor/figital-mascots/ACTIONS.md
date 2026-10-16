# Parchi: every action

41 actions: the 19 from the Tween kit (same names and loop lengths, so site code carries over) and 22 of Parchi's own. Each ships as a still pose (PNG, SVG) and as animated SVG, GIF, MP4, transparent WebM and a sprite sheet.

## Core states

| Action | Loop | What she does |
|---|---|---|
| `idle` | 3.6 s | Gentle bob, the paper flutters, she blinks. Her eyes follow the pointer. |
| `walk-right` | 3.2 s | Strides on ink legs, leans into travel, paper flaps. |
| `walk-left` | 3.2 s | Strides on ink legs, leans into travel, paper flaps. |
| `wave` | 4.16 s | Waves hello. Greeting and goodbye. |
| `point-right` | 3.6 s | Points at a section on the right, eyes on the target. |
| `point-left` | 3.6 s | Points at a section on the left, eyes on the target. |
| `point-up` | 3.6 s | Points up. Used when docked on mobile. |
| `talk` | 3.9 s | Mouth cycles while a speech bubble types out. |
| `think` | 4.8 s | Hand to cheek, one brow up, teal thought dots. |
| `celebrate` | 2.24 s | Hops; the last step on her checklist ticks and the done stamp lands. |
| `sleep` | 9.6 s | Leans, eyes closed, slow breathing, z's float up. |
| `shrug` | 3.6 s | Arms out, worried brows, wavy mouth. No answer yet. |
| `peek` | 3.6 s | Mirrored, one hand up. Sits half off the screen edge when hidden. |

## Intro sequence

| Action | Loop | What she does |
|---|---|---|
| `reach` | 3.6 s | Reaches behind her top edge and brings out a teal pen. |
| `present` | 3.6 s | One hop, then holds out a small slip with a tick. |
| `climb` | 3.0 s | Arms and legs alternate as she climbs the page. |
| `perch` | 5.6 s | Sits on the site header, legs swinging. |

## Extras

| Action | Loop | What she does |
|---|---|---|
| `cover` | 3.6 s | Hands over her eyes, one peeks. Plays while a visitor types an email. |
| `land` | 1.2 s | Drops in, squashes, settles. |

## Greetings and feelings

| Action | Loop | What she does |
|---|---|---|
| `namaste` | 3.6 s | Palms together at her chest with a small bow. The Indian greeting for first visits. |
| `thumbs-up` | 3.6 s | Thumbs up and a wink. Approvals, “looks good”. |
| `clap` | 2.4 s | Claps with happy eyes. A colleague finished a training scenario. |
| `heart` | 3.6 s | Holds a heart. Thank-you moments and positive patient feedback. |
| `nod` | 2.4 s | Nods yes. |
| `shake-no` | 2.4 s | Shakes no, gently. A wrong option, never a scolding. |
| `surprised` | 3.6 s | Eyes wide, small jump, an alert badge. Something needs attention. |
| `oops` | 3.6 s | Hand to her head, a sweat drop. Errors and empty states. |

## Work

| Action | Loop | What she does |
|---|---|---|
| `check-off` | 4.8 s | Ticks her three steps one by one with a pen, then hops. The signature action. |
| `write` | 3.6 s | Writes the next step onto her checklist. |
| `stamp` | 2.4 s | Raises a rubber stamp and lands the done stamp on herself. |
| `search` | 3.6 s | Scans with a magnifying glass. Bill Audit and search states. |
| `remind` | 3.6 s | Taps the air with a small alert bubble. A gentle reminder, not a nag. |
| `hold-sign` | 3.6 s | Holds a blank board in front of her. Put any short message on it in templates. |
| `phone` | 3.6 s | Reads a message on her phone, then shows it. WhatsApp follow-ups and NotedAI. |
| `send` | 2.4 s | Throws a paper plane. A message or ticket sent to the right desk. |
| `loading` | 3.6 s | Arms crossed, foot tapping, typing dots. Loading and waiting states. |
| `point-down` | 3.6 s | Points down at something below her. |

## Movement

| Action | Loop | What she does |
|---|---|---|
| `jump` | 1.6 s | Jumps for joy, arms up. |
| `run-right` | 1.6 s | Runs with speed lines. Urgent follow-ups. |
| `run-left` | 1.6 s | Runs with speed lines. Urgent follow-ups. |
| `sit` | 5.6 s | Sits on the ground, legs out, relaxed. |

## Rig anatomy (for animators)

Parts, back to front: shadow, optional ledge, legs (hips at 104,204 and 136,204), body (slip with torn top, Hospital OS band, face, three-row checklist, done stamp, folded corner), sign board, arms (shoulders at 80,132 and 160,132; upper 22, fore 20), held props (pen, slip, stamp, phone, magnifier, paper plane, heart), effects (thought dots, z's, confetti, speed lines, alert bubbles).

A pose is a set of values: arm angles (upper, fore) per side, leg angles, body offset, tilt, squash, skew, face (eyes, mouth, look) and checklist state. Arms can also be placed by target point with the built-in two-link solver. See `source/parchi-rig.js`.
