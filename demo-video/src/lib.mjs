// Shared helpers for the demo-video pipeline: args, paths, scenes, ffmpeg.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FONTS_DIR = path.join(ROOT, "fonts");
export const AUTH_FILE = path.join(ROOT, ".auth", "state.json");

// Flags that take no value; every other --flag consumes the next token (or --flag=value).
const BOOLEAN_FLAGS = new Set(["dry", "fallback", "force", "include-deps", "keep-going", "headed"]);

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = (eq === -1 ? a.slice(2) : a.slice(2, eq)).trim();
    if (eq !== -1) flags[key] = a.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(key)) flags[key] = true;
    else flags[key] = argv[++i] ?? "";
  }
  return { flags, positional };
}

// A "clip" scene plays a pre-recorded file (path relative to the scenes file); null when absent.
export function clipFile(scene, sceneDir) {
  const f = scene.clip?.file;
  if (!f) return null;
  const p = path.resolve(sceneDir, f);
  return fs.existsSync(p) ? p : null;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function outPaths(flags) {
  const out = path.resolve(ROOT, flags.out || "out");
  return {
    out,
    audio: path.join(out, "audio"),
    clips: path.join(out, "clips"),
    cards: path.join(out, "cards"),
    seg: path.join(out, "seg"),
    final: path.join(out, "weekly-posts-demo.mp4"),
  };
}

export function mkdirs(...dirs) {
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}

export function loadScenes(flags) {
  const file = path.resolve(
    ROOT,
    flags.scenes || process.env.SCENES_FILE || "../docs/submission/video/scenes.json",
  );
  if (!fs.existsSync(file)) {
    throw new Error(`Scenes file not found: ${file}\nPass --scenes <path> (for example --scenes sample-scenes.json).`);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || !Array.isArray(data.scenes)) throw new Error(`${file}: expected { meta, brand, scenes: [...] }`);
  const ids = new Set();
  for (const s of data.scenes) {
    if (!s.id || !s.type) throw new Error(`${file}: every scene needs id and type`);
    if (ids.has(s.id)) throw new Error(`${file}: duplicate scene id ${s.id}`);
    ids.add(s.id);
    if (!["card", "live", "clip"].includes(s.type)) throw new Error(`${file}: scene ${s.id} has unknown type ${s.type}`);
  }
  const meta = {
    width: 1920,
    height: 1080,
    languageCode: "en-US",
    speakingRate: 1,
    baseUrl: "http://localhost:3000",
    ...(data.meta || {}),
  };
  const only = flags.only ? new Set(String(flags.only).split(",").map((x) => x.trim())) : null;
  if (only) {
    for (const id of only) if (!ids.has(id)) throw new Error(`--only ${id}: no such scene`);
  }
  const wanted = (s) => !only || only.has(s.id);
  const dependent = (s) => Boolean(s.depends_on);
  const scenes = data.scenes.filter((s) => wanted(s) && (!dependent(s) || flags["include-deps"] || only));
  const skipped = data.scenes.filter((s) => wanted(s) && !scenes.includes(s)).map((s) => s.id);
  if (skipped.length) console.log(`Skipping scenes that depend on something else (${skipped.join(", ")}); pass --include-deps to include them.`);
  const sceneDir = path.dirname(file);
  return { file, sceneDir, meta, brand: data.brand || {}, all: data.scenes, scenes };
}

// About 2.33 words per second of speech.
export function estimateSeconds(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, words / 2.33);
}

export function run(cmd, args, { cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with ${code}\n${stderr.split("\n").slice(-25).join("\n")}`));
    });
  });
}

export async function ffmpeg(args, opts) {
  return run("ffmpeg", ["-hide_banner", "-y", "-loglevel", opts?.loglevel || "error", ...args], opts);
}

export async function probeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) ? d : null;
}

// Playwright .webm files carry no duration header, so decode once and read the last timestamp.
export async function videoDuration(file) {
  const d = await probeDuration(file).catch(() => null);
  if (d && d > 0) return d;
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-an", "-f", "null", "-"]);
  const all = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  if (!all.length) throw new Error(`Cannot read the duration of ${file}`);
  const m = all[all.length - 1];
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]);
}

// Length of the narration for a scene: real audio when present, else the word estimate.
export async function narrationSeconds(paths, scene) {
  const f = path.join(paths.audio, `${scene.id}.mp3`);
  if (fs.existsSync(f)) return (await probeDuration(f)) ?? estimateSeconds(scene.narration);
  return estimateSeconds(scene.narration);
}

export const LEAD = 0.35; // silence before the narration starts in each scene
export const TAIL = 0.45; // silence after it ends
export const XFADE = 0.3;
