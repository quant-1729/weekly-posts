# Demo video: tools and plan

Goal: a 3–4 minute video that shows Weekly Posts working, for judges. Live app: https://weekly-posts-526531409571.australia-southeast1.run.app

Checked on 2026-10-18 through the GitHub API (stars, last push, licence) and the project pages. Nothing was installed or run. Stars are rounded.

Licence flags:
- **[NC]** non-commercial or "source available" terms. Read before use.
- **[UNCLEAR]** no standard licence on GitHub, or the terms depend on a third-party service.
- **[COPYLEFT]** GPL/AGPL. Fine for making a video; matters only if we ship or modify their code.

---

## 1. Scripted browser recording

| Tool | Stars / last push | Licence | What it does | Windows | Effort | Cost |
|---|---|---|---|---|---|---|
| [Playwright](https://playwright.dev/docs/videos) (`recordVideo`) | very large / active | Apache-2.0 | Drives the real app from a script and records each page as `.webm`. New `show: { actions }` option outlines each clicked element and shows a title. No visible cursor: you add one yourself. | Yes | Low (we already use Node) | Free |
| [playwright-recast](https://github.com/ThePatriczek/playwright-recast) | 65 / 2026-10-04 | MIT | Turns Playwright traces and videos into a polished video: animated cursor, click ripples, auto-zoom on typing, idle speed-up, subtitles (SRT/ASS), intro/outro, 1080p MP4. | Not stated (needs ffmpeg on PATH) | Medium | Free. Its TTS is OpenAI, ElevenLabs, Polly (paid) or local Qwen3 (needs CUDA GPU). No Google TTS. |
| [ghost-cursor](https://github.com/Xetera/ghost-cursor) | 1.6k / 2026-10-13 | MIT | Human-like mouse paths for Puppeteer. Moves the mouse; does not draw it. | Yes | Low | Free |
| [puppeteer-screen-recorder](https://github.com/prasanaworld/puppeteer-screen-recorder) | 460 / 2025-01-20 | MIT | Records a Puppeteer page to MP4. Not updated in 21 months. | Yes | Low | Free |
| [OpenScreen](https://github.com/getopenscreen/openscreen) (desktop app) | 4.5k / 2026-10-18, v2.1.1 released 2026-10-17 | MIT | Free Screen Studio alternative: auto-zoom that follows the cursor, cursor smoothing and click effects, on-device transcription for captions, MP4 export. The older repo (siddharthvaddem/openscreen, 40k stars) is archived and points here. | Yes (Microsoft Store, winget, or `.exe`) | Low (manual clicking) | Free. Optional AI assistant uses your own key. |
| [ScreenArc](https://github.com/tamnguyenvan/screenarc) | 720 / 2026-07-22 | GPL-3.0 [COPYLEFT] | Recorder and editor with automatic pan-and-zoom on mouse actions, timeline, 16:9/9:16/1:1. | Yes | Low | Free |
| [Cap](https://github.com/CapSoftware/Cap) | 23k / 2026-10-18 | AGPL-3.0 (some crates MIT) [COPYLEFT] | Loom alternative; "Studio mode" editor with backgrounds, zooms, captions. | Yes | Low | Free app; cloud and AI tiers are paid |
| [screenstudio-alternative-skill](https://github.com/connerkward/screenstudio-alternative-skill) | 11 / 2026-06-23 | MIT | Claude Code skill: post-processing with auto-zoom on click clusters, idle speed-up, smoothed synthetic cursor. Needs its input logger running during recording. | Unclear | Medium | Free |

Note: Playwright's built-in recorder is tuned for test speed, not image quality; small text can look soft. Test a 10-second clip first. If it is soft, run the same script in a headed browser and capture the window with OpenScreen instead.

## 2. Code-to-video frameworks (title cards, captions, stitching)

| Tool | Stars / last push | Licence | What it does | Windows | Effort | Cost |
|---|---|---|---|---|---|---|
| [Remotion](https://github.com/remotion-dev/remotion) | 65k / 2026-10-18, v4.0.536 (2026-10-16) | Own licence [NC-style for larger firms] | Videos as React components. Embeds recorded clips and audio, animates zoom/pan, captions (`@remotion/captions`, `@remotion/install-whisper-cpp`, MIT), renders MP4. Ships its own ffmpeg. Official [Claude Code skills](https://github.com/remotion-dev/skills) (5.3k, no licence listed). | Yes | Medium (we know React) | **Free only for individuals, non-profits, or companies with up to 3 employees.** Larger companies need a paid company licence. |
| [Revideo](https://github.com/redotvideo/revideo) | 4.1k / 2026-07-15 | MIT | Fork of Motion Canvas built for rendering from code: video/audio tracks, headless render API. | Yes | Medium | Free |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas) | 19.4k / 2026-07-02 | MIT | TypeScript animation with a live editor; best for explainer animations (diagrams). Rendering is mostly from the editor. | Yes | Medium | Free |
| [editly](https://github.com/mifi/editly) | 5.5k / 2025-05-12 | MIT | Declarative JSON5 video editing: title slides, clips, transitions, audio. Slow updates lately. | Yes (native deps can be fiddly) | Low–medium | Free |

## 3. Narration (TTS) and captions

| Tool | Stars / last push | Licence | What it does | Windows | Effort | Cost |
|---|---|---|---|---|---|---|
| [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech/pricing) | n/a | Google Cloud terms | Chirp 3 HD voices (natural), plus WaveNet/Neural2/Standard. We already have Cloud access. | Yes (API) | Low | Chirp 3 HD: first 1M characters free, then $30 per 1M. A 4-minute script is about 3,500 characters, so **$0**. Billing account required. |
| [Kokoro](https://github.com/hexgrad/kokoro) (+ `kokoro-js` for Node) | 9.4k / 2025-08-06 | Apache-2.0 | Small (82M) local TTS, good English quality, runs on CPU. | Yes | Low–medium | Free |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) | 5.9k / 2026-10-17 | GPL-3.0 [COPYLEFT] | Fast local TTS, many languages. Less natural than Kokoro. | Yes | Low | Free |
| [Chatterbox](https://github.com/resemble-ai/chatterbox) | 27k / 2026-07-21 | MIT | High-quality local TTS with emotion control; best with a GPU. | Yes (Python) | Medium | Free |
| [edge-tts](https://github.com/rany2/edge-tts) | 12k / 2026-10-14 | [UNCLEAR] | Calls Microsoft Edge's online voices without an official API. Terms of use unclear. Avoid for a submission. | Yes | Low | Free |
| Coqui XTTS-v2, F5-TTS models | n/a | [NC] model licences | Good voice cloning, but the released model weights are non-commercial. Avoid. | | | |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | 54k / 2026-10-12 | MIT | Local speech-to-text with timestamps; outputs SRT/VTT. Remotion can install it for you. | Yes (native builds) | Low | Free |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | 26k / 2026-10-16 | MIT | Faster Python Whisper. | Yes | Low–medium | Free |
| [WhisperX](https://github.com/m-bain/whisperX) | 25k / 2026-09-26 | BSD-2 | Word-level timestamps (karaoke captions). | Yes (GPU helps) | Medium | Free |
| [OpenAI Whisper](https://github.com/openai/whisper) | 111k / 2026-08-31 | MIT | Reference model (Python, PyTorch). | Yes | Medium | Free |

We write the narration ourselves, so captions can come straight from the script text. Whisper is only needed for word-by-word timing.

## 4. Editing and stitching

| Tool | Stars / last push | Licence | What it does | Windows | Effort | Cost |
|---|---|---|---|---|---|---|
| [FFmpeg](https://ffmpeg.org) | n/a | LGPL/GPL | Convert, trim, join, loudness-normalise, burn subtitles. | Yes (gyan.dev or BtbN builds) | Medium (command lines) | Free |
| [auto-editor](https://github.com/WyattBlue/auto-editor) | 5.5k / 2026-10-18 | Unlicense | Cuts silent or still parts automatically; handy for trimming AI waiting time. | Yes | Low | Free |
| node-fluent-ffmpeg | 8.2k / archived 2025 | MIT | Node wrapper for FFmpeg. **Archived; do not start new work on it.** | | | |
| Auto-zoom / cursor smoothing | | | Done by OpenScreen, ScreenArc, Cap (manual recording) or playwright-recast / Remotion (scripted). | | | |

## 5. End-to-end "demo video from a script"

| Tool | Stars / last push | Licence | What it does | Windows | Effort | Cost |
|---|---|---|---|---|---|---|
| [claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) | 2.3k / 2026-10-12 | MIT | Claude Code skills + Remotion templates + Playwright `/record-demo` + voiceover (ElevenLabs or self-hosted Qwen3-TTS) → MP4. | Partly (PowerShell install notes) | Medium | Remotion licence applies; cloud GPU or ElevenLabs are paid options |
| [OpenMontage](https://github.com/calesthio/openmontage) | 69k / 2026-10-16 | AGPL-3.0 [COPYLEFT] | Large agentic video system for coding assistants: 12 pipelines, Playwright recording skill. Heavy for one demo. | Unclear | High | Free code; AI services paid |
| [DemoDSL](https://github.com/Fran-cois/demodsl) (PyPI `demodsl`) | 3 / 2026-10-09 | Own "Community License" [UNCLEAR] | YAML/JSON demo → Playwright capture, smooth cursor, 6 subtitle styles, 13 TTS providers including Google and Piper. Very new, tiny user base. | Not stated | Medium | Free locally |
| demofly (npm `demofly`) | repo not found | MIT (npm) | Playwright recording + Kokoro narration + assembly; Claude Code plugin. Has a cloud "Pro" tier. | Not stated | Medium | Free tier; premium voices paid |
| demo-machine (npm), DemoForge, demo-dev | repos not verified | | Similar YAML/JSON-to-MP4 tools. Could not confirm source or maintenance. Skip. | | | |

---

## Recommendation

### Pipeline (3 tools + 1 optional)

1. **Playwright** drives the live app, one short script per scene, in a 1920×1080 headed Chromium window. A small injected script draws a cursor and click ripple and logs each click's position and time to JSON.
2. **Google Cloud Text-to-Speech (Chirp 3 HD)** turns the narration, one file per scene, into audio. Free at this size.
3. **Remotion** builds the final video: title cards, the recorded clips, zoom-in on clicks (from the click log), captions from the narration text, music bed, then renders the MP4 (ffmpeg is bundled).
4. *(Optional)* **OpenScreen** as Plan B if Playwright video looks soft or a scene is easier to click by hand. It is MIT, free, on Windows, with auto-zoom built in.

**Before relying on Remotion, check the licence:** it is free only if Figital Labs has 3 or fewer employees. If larger, either buy a Remotion company licence (paid) or swap Remotion for **Revideo** (MIT; same idea, smaller community).

### Ground rules for the recording

- **Sign-in:** the owner signs in once by email link in the Playwright browser by hand. The script saves the session (`storageState`) to a file that is git-ignored and deleted after recording. The video never shows the inbox.
- **Use a prepared demo brand** (logo, colours, approved Brand Face, contacts, a test QR). Do not generate a new Brand Face on camera (about $1.32, needs approval). Each take creates a post (Gemini copy about $0.01, Imagen background about $0.05). Ten takes stay well under $0.50; ask before going above that.
- **Payment QR:** use a test or demo ID that the owner typed and confirmed in the app. Never put a real ID in the script.
- **Show the real app.** If Gemini takes 10+ seconds, speed it up 2–4× with a visible "sped up" label rather than cutting to a fake result.
- **Check the live revision first.** Design Studio, Plan a week and carousels were local-only at the last check (`pitch-content.md`, slide 5). Deploy them before recording, or leave them out.

### Scene list (about 3:35)

| # | Time | Seconds | Type | What is on screen | Narration gist |
|---|---|---|---|---|---|
| 1 | 0:00 | 15 | Title card | Problem: a small shop owner, no designer, no time; a generic AI post with a wrong price crossed out | "Small businesses need regular posts. Generic AI tools invent prices and garble local text." |
| 2 | 0:15 | 10 | Title card | "Weekly Posts: details first, then design." Logo, Tween | Solution in one line |
| 3 | 0:25 | 15 | Live | Home → Brand page: logo, colours, Brand Face card | "Set up once: brand, colours, a face." |
| 4 | 0:40 | 25 | Live | Create → brief: type the offer, two selling points, contacts, QR, dates | "The owner says what is true first." |
| 5 | 1:05 | 25 | Live (sped up) | Three design options appear; pick one; zoom on code-drawn text and QR | "Gemini writes the copy; code draws every word, logo and QR." |
| 6 | 1:30 | 20 | Live | Design Studio: drag a block, edit a line inline, add contacts | "Fine-tune by hand." |
| 7 | 1:50 | 20 | Live | Review: a "please check" flag on a claim not in the brief; captions; fix it | "Anything not in the brief is flagged before approval." |
| 8 | 2:10 | 15 | Live | Approve → schedule slot → Queue | "Nothing goes out without approval; one post per slot." |
| 9 | 2:25 | 15 | Live | Ideas cards or "Plan a week" from one sentence | "A week of posts from one sentence." |
| 10 | 2:40 | 25 | Diagram card + short clip | Architecture: Next.js on Cloud Run, Gemini and Imagen on Vertex AI, Supabase with row-level security, Cloud Scheduler; optional 5 s of the Cloud Run console | "Gemini does the language; code renders the pixels; cost capped per brand." |
| 11 | 3:05 | 20 | Card | Impact: guardrails, $0.50 weekly AI cap, 20+ languages, about 4,600 tests. Only measured numbers (time-to-first-post is still [TO MEASURE]) | "Truthful, on-brand posts in minutes, for any small business." |
| 12 | 3:25 | 10 | End card | Live URL + QR (drawn by code), team name | Call to action |

Narration is about 500 words (about 3,000–3,500 characters) at a calm 140 words a minute.

### Steps

1. **Script (1 h).** Write the narration per scene in a JSON file (`scenes.json`: id, narration text, target seconds). Keep claims to facts in `pitch-content.md`.
2. **Narration (30 min).** A small Node script calls Google TTS (Chirp 3 HD, one voice) per scene and saves `scene-N.mp3`. Read each file's length; that sets the scene length.
3. **Recording (3–4 h including dry runs).** One Playwright spec per live scene: viewport and video size 1920×1080, `slowMo` about 50 ms, waits on visible text instead of fixed sleeps, injected cursor and click log. Record each scene 2–3 times; keep the best. Fall back to OpenScreen for any scene that fights the script.
4. **Assembly (3–4 h).** Remotion project in a separate folder (not inside the app): one `<Sequence>` per scene with clip + audio, a `Zoom` wrapper fed by the click log, a caption strip from the scene text split into short lines, title cards in the app's colours and fonts, "sped up" label where used. Render 1080p MP4.
5. **Review (1–2 h).** Watch at full screen and on a phone: text readable, captions match voice, nothing private visible (email, tokens, real payment IDs), length 3:00–4:00. Re-render.

**Total: about 1.5 working days.** Plan B (OpenScreen only, owner clicks through live, records own voice or drops in the TTS files, on-device captions): about half a day, less polish.

### Costs

| Item | Cost |
|---|---|
| Playwright, Remotion (if eligible), OpenScreen, Whisper | $0 |
| Google TTS (about 3,500 chars, under the 1M free tier) | $0 |
| App AI during takes (Gemini + Imagen) | about $0.05–0.10 per take; ask before passing $0.50 |
| **Paid only if:** Remotion company licence (more than 3 employees), ElevenLabs/OpenAI voices, cloud GPU | avoid |
