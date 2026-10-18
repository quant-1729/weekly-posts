// Combines clips + narration into out/weekly-posts-demo.mp4 with ffmpeg.
//   npm run assemble [-- --only s01,s02] [--scenes <file>] [--out <dir>]
// Per scene: clip + audio, sped-up spans (setpts) with a "Sped up xN" label, burnt captions (ASS), last frame held
// if the clip is shorter than the audio. Then 0.3 s crossfades between scenes and loudnorm on the audio.
import fs from "node:fs";
import path from "node:path";
import {
  FONTS_DIR, LEAD, clipFile, ROOT, TAIL, XFADE, ffmpeg, loadScenes, mkdirs, outPaths, parseArgs, probeDuration, videoDuration,
} from "./lib.mjs";

const { flags } = parseArgs();
const { meta, sceneDir, scenes } = loadScenes(flags);
const paths = outPaths(flags);
mkdirs(paths.seg);
const W = meta.width;
const H = meta.height;
const FPS = 30;
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/"); // ffmpeg filters hate Windows drive colons

// ---------- captions ----------
function splitText(text, max = 58) {
  const sentences = String(text).replace(/\s+/g, " ").trim().match(/[^.!?।]+[.!?।]*["')\]]*\s*/g) || [text];
  const out = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    const n = Math.ceil(s.length / max);
    const target = s.length / n;
    let cur = "";
    for (const w of s.split(" ")) {
      if (cur && (cur + " " + w).length > target * 1.15) {
        out.push(cur);
        cur = w;
      } else cur = cur ? cur + " " + w : w;
    }
    if (cur) out.push(cur);
  }
  return out;
}

const ts = (t) => {
  const cs = Math.round(Math.max(0, t) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const assText = (s) => s.replace(/[{}]/g, "").replace(/\\/g, "");

function buildAss({ text, narr, labels }) {
  const chunks = splitText(text);
  const weights = chunks.map((c) => c.length + 8);
  const total = weights.reduce((a, b) => a + b, 0);
  const lines = [];
  let t = LEAD;
  chunks.forEach((c, i) => {
    const dur = (weights[i] / total) * narr;
    const end = i === chunks.length - 1 ? t + dur + 0.2 : t + dur;
    lines.push(`Dialogue: 0,${ts(t)},${ts(end)},Cap,,0,0,0,,${assText(c)}`);
    t += dur;
  });
  const bandTop = H - 140;
  lines.unshift(`Dialogue: 0,${ts(LEAD - 0.1)},${ts(LEAD + narr + 0.3)},Band,,0,0,0,,{\\pos(0,${bandTop})\\fad(200,200)\\p1}m 0 0 l ${W} 0 ${W} 140 0 140{\\p0}`);
  for (const l of labels) lines.push(`Dialogue: 1,${ts(l.start)},${ts(l.end)},Tag,,0,0,0,,${assText(l.text)}`);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Onest,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,160,160,46,1
Style: Band,Onest,20,&H2A161616,&H2A161616,&H2A161616,&H2A161616,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Tag,Onest,32,&H00FFFFFF,&H00FFFFFF,&H002E57E4,&H002E57E4,0,0,0,0,100,100,0,0,3,12,0,9,60,60,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}

// ---------- one scene ----------
async function buildSegment(scene) {
  // A pre-recorded "clip" scene plays its own file when it exists; otherwise the card fallback from `npm run cards`.
  const own = scene.type === "clip" ? clipFile(scene, sceneDir) : null;
  const clip = own || path.join(paths.clips, `${scene.id}.webm`);
  const audio = path.join(paths.audio, `${scene.id}.mp3`);
  const logFile = own ? "" : path.join(paths.clips, `${scene.id}.json`);
  if (!fs.existsSync(clip)) return null;
  if (!fs.existsSync(audio)) {
    throw new Error(`${scene.id}: no audio at ${audio}. Run "npm run tts" (or "npm run tts -- --fallback") first.`);
  }
  const log = logFile && fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) : { trim: 0, segments: [] };
  if (log.ok === false) {
    console.warn(`  ${scene.id}: the recording failed (see record output); scene left out. Re-record with: npm run record -- --only ${scene.id}`);
    return null;
  }
  const trim = Math.max(0, log.trim || 0);
  const total = await videoDuration(clip);
  const clipLen = Math.max(0.5, (log.length > 0 ? Math.min(log.length, total - trim) : total - trim));
  const narr = (await probeDuration(audio)) || 1;

  // Speed-up spans -> parts of the trimmed clip, in order.
  const spans = (log.segments || [])
    .filter((s) => s.end > s.start && s.speed > 1)
    .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(clipLen, s.end) }))
    .sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    if (s.start > cursor) parts.push({ a: cursor, b: s.start, speed: 1 });
    parts.push({ a: s.start, b: s.end, speed: s.speed });
    cursor = s.end;
  }
  if (cursor < clipLen) parts.push({ a: cursor, b: clipLen, speed: 1 });
  if (!parts.length) parts.push({ a: 0, b: clipLen, speed: 1 });
  // A scene-level "speed" (for example a long form filled in on camera) speeds up every part that is not already sped up.
  let sceneSpeed = Number(scene.speed) > 1 ? Number(scene.speed) : 1;
  // --fit: a live scene longer than its narration plays faster (labelled), so the video has no silent stretches.
  if (sceneSpeed === 1 && flags.fit && scene.type === "live") {
    const target = LEAD + narr + TAIL + (Number(flags.pad) || 0); // --pad: extra seconds per live scene to follow the screen
    const normal = parts.filter((p) => p.speed === 1).reduce((a, p) => a + (p.b - p.a), 0);
    const fast = parts.filter((p) => p.speed > 1).reduce((a, p) => a + (p.b - p.a) / p.speed, 0);
    if (normal > 0 && normal + fast > target + 0.5) {
      const need = normal / Math.max(0.5, target - fast);
      sceneSpeed = Math.min(Number(flags.maxspeed) || 4, Math.max(1, Math.round(need * 4) / 4));
    }
  }
  if (sceneSpeed > 1) for (const p of parts) if (p.speed === 1) p.speed = sceneSpeed;

  let outT = 0;
  const labels = [];
  for (const p of parts) {
    const d = (p.b - p.a) / p.speed;
    if (p.speed > 1) labels.push({ start: outT, end: outT + d, text: `Sped up ×${p.speed}` });
    outT += d;
  }
  const spedLen = outT;
  const dur = Math.max(spedLen, LEAD + narr + TAIL);
  if (spedLen > narr + LEAD + TAIL + 3) {
    console.warn(`  ${scene.id}: clip is ${(spedLen - narr).toFixed(1)} s longer than the narration; the end is silent. Trim steps or lengthen the narration.`);
  }

  const assFile = path.join(paths.seg, `${scene.id}.ass`);
  fs.writeFileSync(assFile, buildAss({ text: scene.narration || "", narr, labels }), "utf8");

  const n = parts.length;
  const f = [];
  f.push(`[0:v]trim=start=${trim.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1,split=${n}${parts.map((_, i) => `[b${i}]`).join("")}`);
  parts.forEach((p, i) => {
    f.push(`[b${i}]trim=start=${p.a.toFixed(3)}:end=${p.b.toFixed(3)},setpts=(PTS-STARTPTS)/${p.speed}[v${i}]`);
  });
  f.push(`${parts.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0,fps=${FPS}[sp]`);
  const pad = Math.max(0, dur - spedLen) + 0.1;
  const subs = `subtitles=${rel(assFile)}:fontsdir=${rel(FONTS_DIR)}`;
  f.push(`[sp]tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS,${subs},format=yuv420p[vout]`);
  f.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(LEAD * 1000)}:all=1,apad=whole_dur=${dur.toFixed(3)},atrim=duration=${dur.toFixed(3)}[aout]`);

  const outFile = path.join(paths.seg, `${scene.id}.mp4`);
  await ffmpeg([
    "-i", rel(clip), "-i", rel(audio),
    "-filter_complex", f.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", dur.toFixed(3),
    rel(outFile),
  ]);
  console.log(`  ${scene.id}: ${dur.toFixed(1)} s (clip ${spedLen.toFixed(1)} s, narration ${narr.toFixed(1)} s${labels.length ? `, ${labels.length} sped-up span(s)` : ""})`);
  return { id: scene.id, file: outFile, dur };
}

// ---------- join ----------
const segs = [];
for (const scene of scenes) {
  const seg = await buildSegment(scene);
  if (seg) segs.push(seg);
  else console.log(`  ${scene.id}: no clip, left out.`);
}
if (!segs.length) {
  console.error("Nothing to assemble: no clips found. Run cards and record first.");
  process.exit(1);
}

const inputs = segs.flatMap((s) => ["-i", rel(s.file)]);
let video = "";
let audio = "";
let vLabel = "[0:v]";
let aLabel = "[0:a]";
let acc = segs[0].dur;
for (let i = 1; i < segs.length; i++) {
  const offset = acc - XFADE;
  video += `${vLabel}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}[xv${i}];`;
  audio += `${aLabel}[${i}:a]acrossfade=d=${XFADE}:c1=tri:c2=tri[xa${i}];`;
  vLabel = `[xv${i}]`;
  aLabel = `[xa${i}]`;
  acc += segs[i].dur - XFADE;
}

const LN = "I=-16:TP=-1.5:LRA=11";
const joined = `${audio}${aLabel}`;
// Pass 1: measure loudness on the joined audio only.
const m = await ffmpeg(
  [...inputs, "-filter_complex", `${joined}loudnorm=${LN}:print_format=json[ln]`, "-map", "[ln]", "-f", "null", "-"],
  { loglevel: "info" },
);
const json = m.stderr.slice(m.stderr.lastIndexOf("{"), m.stderr.lastIndexOf("}") + 1);
const meas = JSON.parse(json);
const silent = !Number.isFinite(parseFloat(meas.input_i)) || parseFloat(meas.input_i) < -70;
const lnSecond = silent
  ? "anull"
  : `loudnorm=${LN}:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}` +
    `:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`;

const vOut = segs.length > 1 ? vLabel : "0:v";
const graph = `${video}${audio}${aLabel}${lnSecond}[fa]`;
await ffmpeg([
  ...inputs,
  "-filter_complex", graph,
  "-map", vOut, "-map", "[fa]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
  rel(paths.final),
]);

const d = await probeDuration(paths.final);
console.log(`\nWrote ${paths.final}`);
console.log(`Duration: ${d.toFixed(2)} s (${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}), ${segs.length} scene(s). ` +
  (silent ? "Audio is silent (placeholder), loudnorm skipped." : `Audio loudness ${meas.input_i} LUFS -> -16 LUFS.`));
