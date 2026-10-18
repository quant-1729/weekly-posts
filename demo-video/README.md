# Weekly Posts demo-video pipeline

Free, scripted, repeatable: Playwright records the app, HTML cards are rendered by Playwright, Google Cloud
Text-to-Speech makes the narration, ffmpeg joins everything. No Remotion, no paid AI. It does not touch `src/`.

Input: `docs/submission/video/scenes.json` (override with `--scenes <file>`). A small test file is `sample-scenes.json`.
Scene types: `card`, `live` (steps below) and `clip` (plays a pre-recorded file; if the file is missing the card is
shown with a "Clip pending" badge). Scenes with `depends_on` set are skipped everywhere unless `--include-deps` (or you
name them with `--only`).

## One-time setup

```bash
cd demo-video
npm install
npx playwright install chromium     # a Chromium matching the installed Playwright
ffmpeg -version                      # ffmpeg and ffprobe must be on PATH (winget install Gyan.FFmpeg)
```

The Onest font (open licence, OFL) is in `fonts/` and is used for the cards and the burnt-in captions.

## Commands (run from `demo-video/`)

Common flags for every command: `--scenes <file>`, `--out <dir>` (default `out`), `--only s01,s02`.

```bash
# 1. Sign in once by hand (headed browser). Saves .auth/state.json (git-ignored). Delete it after recording.
npm run auth -- https://weekly-posts-526531409571.australia-southeast1.run.app

# 2. Narration
npm run tts -- --dry                 # characters and estimated length only, no API call
npm run tts                          # Google Cloud TTS, one out/audio/<id>.mp3 per scene (skips existing; --force)
npm run tts -- --fallback            # silent placeholder audio (words / 2.33 s) so the rest can be tested

# 3. Record the live scenes -> out/clips/<id>.webm + <id>.json
npm run record
npm run record -- --base http://localhost:3000 --only s03        # one scene that has its own "start"
npm run record -- --only s03,s04,s05,s06 --headed                # a group that shares page state
npm run record -- --include-deps                                 # also the scenes with depends_on

# 4. Cards (and placeholder cards for missing clips) -> out/clips/<id>.webm
npm run cards

# 5. Assemble -> out/weekly-posts-demo.mp4 (H.264 yuv420p, 30 fps, AAC, loudnorm -16 LUFS)
npm run assemble

# 6. cards + record + assemble in one go (flags are forwarded; tts must have run first)
npm run all
```

Typical full run: `npm run auth -- <url>`, `npm run tts`, `npm run all`.
Test run with the sample file and silent audio (public pages only, no sign-in):

```bash
npm run tts -- --fallback --scenes sample-scenes.json --out out/sample
npm run all -- --scenes sample-scenes.json --out out/sample
```

## How it works

- **Live scenes share one page.** They run in order in one browser page, so state carries over. `"start": null` means
  "continue where the last scene stopped"; `"start": "/path"` navigates first (hidden loading time is trimmed). The whole
  run is one long video that is cut into one clip per scene. A scene with `"start": null` cannot be recorded alone: use
  `--only` with the scenes before it (the script warns when nothing is open).
- **Cursor.** A coral dot follows the mouse with an eased 400 ms move before every click and type, with a click ripple.
  The Next.js dev indicator is hidden.
- **Steps.** `goto {path}`, `click {text|role+name|label|placeholder, exact?}`, `type {same locators, value, delayMs?,
  clear?}`, `waitText {text|..., timeoutMs, speedup?, exact?}`, `zoom {locator, scale, ms, hold?}`, `scroll {y}` (absolute
  scroll position in px from the top, eased), `pause {ms}`.
- **Speedup.** `waitText` with `speedup: 3` logs the time span (waits under 1 s are not sped up). Assembly speeds that
  span up with `setpts` and shows a "Sped up x3" label.
- **Timing.** Each scene is 0.35 s lead + narration + 0.45 s tail, or the clip length if that is longer; a clip
  shorter than its audio holds its last frame. 0.3 s crossfades between scenes.
- **Captions.** Narration is split into short lines timed in proportion to the audio length and burnt in (ASS) on a
  semi-transparent band at the bottom.

## Notes

- Paying for Text-to-Speech: Chirp 3 HD is billed per character (the free tier covers the roughly 2,300-character
  script, check current pricing). `npm run tts -- --dry` shows the count first.
- Credentials: Application Default Credentials (`gcloud auth application-default login`) or
  `GOOGLE_APPLICATION_CREDENTIALS` in the environment. Enable the "Cloud Text-to-Speech API" on the project. The script
  prints only the project id and the character count.
- The saved login is a live session: delete `demo-video/.auth/state.json` after recording.
- Output goes to `out/` (git-ignored).
