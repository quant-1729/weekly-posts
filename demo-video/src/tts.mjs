// Narration audio: one out/audio/<id>.mp3 per scene.
//   npm run tts                     Google Cloud Text-to-Speech (needs ADC or GOOGLE_APPLICATION_CREDENTIALS)
//   npm run tts -- --dry            only print the character count, no API call
//   npm run tts -- --fallback       silent placeholder audio of the estimated length (words / 2.33 s), via ffmpeg
//   flags: --only s01,s02  --force (regenerate existing)  --scenes <file>  --out <dir>
import fs from "node:fs";
import path from "node:path";
import { ffmpeg, estimateSeconds, loadScenes, mkdirs, outPaths, parseArgs } from "./lib.mjs";

const { flags } = parseArgs();
const { meta, scenes } = loadScenes(flags);
const paths = outPaths(flags);
mkdirs(paths.audio);

const withText = scenes.filter((s) => (s.narration || "").trim());
const chars = withText.reduce((n, s) => n + s.narration.length, 0);
console.log(`${withText.length} scenes with narration, ${chars} characters.`);

if (flags.dry) {
  const est = withText.reduce((n, s) => n + estimateSeconds(s.narration), 0);
  console.log(`Estimated speech length: ${(est / 60).toFixed(1)} min. Voice: ${meta.voice || "(none set)"}. No API call made (--dry).`);
  process.exit(0);
}

const fileFor = (id) => path.join(paths.audio, `${id}.mp3`);
const flagFor = (id) => path.join(paths.audio, `${id}.fallback`);

if (flags.fallback) {
  for (const s of withText) {
    // Never overwrite real narration with silence unless --force.
    if (fs.existsSync(fileFor(s.id)) && !fs.existsSync(flagFor(s.id)) && !flags.force) {
      console.log(`  ${s.id}: real audio exists, kept (use --force to replace).`);
      continue;
    }
    const secs = estimateSeconds(s.narration);
    await ffmpeg([
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-t", secs.toFixed(2), "-c:a", "libmp3lame", "-b:a", "64k", fileFor(s.id),
    ]);
    fs.writeFileSync(flagFor(s.id), "silent placeholder\n");
    console.log(`  ${s.id}: silent placeholder, ${secs.toFixed(1)} s`);
  }
  process.exit(0);
}

if (!meta.voice) {
  console.error("meta.voice is missing in the scenes file (for example en-US-Chirp3-HD-Aoede).");
  process.exit(2);
}

const { TextToSpeechClient } = await import("@google-cloud/text-to-speech");
const client = new TextToSpeechClient();
const projectId = await client.getProjectId().catch(() => "(unknown)");
console.log(`Project: ${projectId}. Voice: ${meta.voice} (${meta.languageCode}). Characters to synthesise: ${chars}.`);

// The API accepts at most 5000 bytes of text per request: split on sentence ends.
function chunk(text, maxBytes = 3500) {
  const sentences = text.match(/[^.!?।]+[.!?।]*\s*/g) || [text];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (Buffer.byteLength(cur + s) > maxBytes && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let done = 0;
for (const s of withText) {
  if (fs.existsSync(fileFor(s.id)) && !fs.existsSync(flagFor(s.id)) && !flags.force) {
    console.log(`  ${s.id}: exists, skipped (use --force to regenerate).`);
    continue;
  }
  const parts = [];
  for (const text of chunk(s.narration)) {
    const [res] = await client.synthesizeSpeech({
      input: { text },
      voice: { languageCode: meta.languageCode, name: meta.voice },
      audioConfig: { audioEncoding: "MP3", speakingRate: meta.speakingRate ?? 1 },
    });
    parts.push(Buffer.from(res.audioContent));
  }
  fs.writeFileSync(fileFor(s.id), Buffer.concat(parts));
  fs.rmSync(flagFor(s.id), { force: true });
  done++;
  console.log(`  ${s.id}: ok (${s.narration.length} characters)`);
}
console.log(`Done: ${done} file(s) written to ${paths.audio}.`);
