// Records the "live" scenes with Playwright (1920x1080, visible cursor, smooth zoom).
//   npm run record -- [--only s05] [--base http://localhost:3000] [--include-deps] [--keep-going]
//   flags: --scenes <file>  --out <dir>  --headed
// Live scenes run in ORDER in ONE browser page (state carries over; a scene with "start": null continues where the
// previous one stopped). The whole run is one long video that is cut into out/clips/<id>.webm at the logged
// timestamps; out/clips/<id>.json holds { trim, length, segments, ok }.
// A single scene works when it has its own "start" (for example s03, s12). A scene with "start": null needs the
// scenes before it: record the group, for example --only s03,s04,s05.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { AUTH_FILE, ffmpeg, loadScenes, mkdirs, outPaths, parseArgs, sleep } from "./lib.mjs";
import { installCursor } from "./cursor.mjs";

const { flags } = parseArgs();
const { meta, scenes } = loadScenes(flags);
const paths = outPaths(flags);
mkdirs(paths.clips);

const W = meta.width;
const H = meta.height;
// The app is recorded at a smaller viewport (W/UI x H/UI) so the UI looks UI times larger; assemble scales clips up to W x H.
const UI = Number(flags.ui || meta.uiScale || 1.5);
const VW = Math.round(W / UI);
const VH = Math.round(H / UI);
const base = String(flags.base || meta.baseUrl).replace(/\/+$/, "");
const authFile = flags.state ? path.resolve(String(flags.state)) : AUTH_FILE;
const hasAuth = fs.existsSync(authFile);
console.log(`Base URL: ${base}. Saved login: ${hasAuth ? "yes" : "no (public pages only)"}.`);

const todo = scenes.filter((s) => s.type === "live");

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function locate(page, step) {
  const exact = typeof step.exact === "boolean" ? step.exact : undefined;
  if (step.css) return page.locator(step.css).first();
  if (step.role) return page.getByRole(step.role, { name: step.name, exact }).first();
  if (step.label) return page.getByLabel(step.label, { exact }).first();
  if (step.placeholder) return page.getByPlaceholder(step.placeholder, { exact }).first();
  if (step.text) return page.getByText(step.text, { exact }).first();
  throw new Error(`step needs text, role+name, label or placeholder: ${JSON.stringify(step)}`);
}

async function settle(page) {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(250);
}

async function moveTo(page, st, x, y, ms = 400) {
  const x0 = st.x;
  const y0 = st.y;
  const t0 = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const e = ease(t);
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    if (t >= 1) break;
    await sleep(6);
  }
  st.x = x;
  st.y = y;
}

async function targetPoint(page, step) {
  const loc = locate(page, step);
  await loc.waitFor({ state: "visible", timeout: step.timeoutMs ?? 15000 });
  await loc.scrollIntoViewIfNeeded();
  await sleep(120);
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${JSON.stringify(step)}`);
  return { loc, box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function smoothScroll(page, y) {
  const dur = await page.evaluate(
    (target) =>
      new Promise((resolve) => {
        const from = window.scrollY;
        const dist = target - from;
        const ms = Math.min(1600, Math.max(500, Math.abs(dist) * 0.9));
        const t0 = performance.now();
        const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const tick = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          window.scrollTo(0, from + dist * e(t));
          if (t < 1) requestAnimationFrame(tick);
          else resolve(ms);
        };
        requestAnimationFrame(tick);
      }),
    y,
  );
  await sleep(250);
  return dur;
}

async function runStep(page, st, step, ctx) {
  switch (step.do) {
    case "goto": {
      await page.goto(base + step.path, { waitUntil: "load" });
      await settle(page);
      return;
    }
    case "click": {
      const t = await targetPoint(page, step);
      await moveTo(page, st, t.x, t.y, 400);
      await sleep(180);
      await t.loc.click({ delay: 90 });
      await sleep(450);
      return;
    }
    case "type": {
      const t = await targetPoint(page, step);
      await moveTo(page, st, t.x, t.y, 400);
      await sleep(150);
      await t.loc.click({ delay: 60 });
      await sleep(200);
      if (step.clear) await t.loc.fill("");
      await t.loc.pressSequentially(String(step.value ?? ""), { delay: step.delayMs ?? 60 });
      await sleep(350);
      return;
    }
    case "waitText": {
      const t0 = ctx.now();
      await locate(page, step)
        .waitFor({ state: "visible", timeout: step.timeoutMs ?? 30000 });
      const t1 = ctx.now();
      const speed = step.speedup === true ? 3 : Number(step.speedup);
      if (speed > 1 && t1 - t0 >= 1.0) ctx.segments.push({ start: +t0.toFixed(3), end: +t1.toFixed(3), speed });
      await sleep(250);
      return;
    }
    case "zoom": {
      const t = await targetPoint(page, step);
      const s = step.scale ?? 1.6;
      const ms = step.ms ?? 800;
      const hold = step.hold ?? 900;
      await moveTo(page, st, t.x, t.y, 400);
      await page.evaluate(
        ({ cx, cy, s: sc, ms: dur, W: w, H: h }) => {
          const b = document.body;
          const r = b.getBoundingClientRect();
          b.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
          b.style.transition = `transform ${dur}ms cubic-bezier(.45,0,.2,1)`;
          document.documentElement.style.overflow = "hidden";
          b.style.transform = `translate(${w / 2 - cx}px, ${h / 2 - cy}px) scale(${sc})`;
        },
        { cx: t.x, cy: t.y, s, ms, W: VW, H: VH },
      );
      await sleep(ms + hold);
      await page.evaluate(() => {
        document.body.style.transform = "translate(0px, 0px) scale(1)";
      });
      await sleep(ms + 100);
      await page.evaluate(() => {
        const b = document.body;
        b.style.transition = "";
        b.style.transform = "";
        b.style.transformOrigin = "";
        document.documentElement.style.overflow = "";
      });
      return;
    }
    case "scroll": {
      await smoothScroll(page, Number(step.y) || 0);
      return;
    }
    case "pause": {
      await sleep(step.ms ?? 800);
      return;
    }
    case "select": {
      // A <select>: pick the option by its visible label.
      const t = await targetPoint(page, step);
      await moveTo(page, st, t.x, t.y, 400);
      await sleep(180);
      await t.loc.selectOption({ label: String(step.value) });
      await sleep(450);
      return;
    }
    case "shell": {
      // Runs a command on cue (for example: Cloud Scheduler "run now" while the Queue page is open). Array form, no shell.
      if (!Array.isArray(step.cmd) || !step.cmd.length) throw new Error("shell step needs cmd: [program, ...args]");
      // Windows cannot start a .cmd/.bat directly without a shell: run it through cmd.exe /c.
      const argv = process.platform === "win32" && /\.(cmd|bat)$/i.test(step.cmd[0]) ? ["cmd.exe", "/d", "/c", ...step.cmd] : step.cmd;
      const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", shell: false, timeout: step.timeoutMs ?? 60000 });
      if (r.status !== 0) throw new Error(`shell step failed (${r.status ?? r.error?.message}): ${(r.stderr || "").trim().slice(0, 200)}`);
      return;
    }
    default:
      throw new Error(`unknown step: ${JSON.stringify(step)}`);
  }
}

if (!todo.length) {
  console.log("No live scenes selected.");
  process.exit(0);
}

const browser = await chromium.launch({ headless: !flags.headed });
const context = await browser.newContext({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: 1,
  recordVideo: { dir: paths.out, size: { width: VW, height: VH } },
  ...(hasAuth ? { storageState: authFile } : {}),
});
await context.addInitScript(installCursor);
const page = await context.newPage();
const video = page.video();
const created = performance.now();
const st = { x: VW * 0.75, y: VH * 0.85 };
const results = [];
let stopped = false;

for (const scene of todo) {
  if (stopped) break;
  console.log(`  ${scene.id}: recording...`);
  const segments = [];
  let mark = 0;
  const ctx = { segments, now: () => (performance.now() - mark) / 1000 };
  let error = null;
  let length = 0;
  try {
    const blank = page.url() === "about:blank";
    const startPath = scene.start === null ? null : (scene.start ?? (blank ? "/" : null));
    if (startPath !== null) {
      await page.goto(base + startPath, { waitUntil: "load" });
      await settle(page);
    } else if (blank) {
      console.warn(`  ${scene.id}: has no "start" and nothing is open yet; it needs the scenes before it (try --only with the group, e.g. s03,${scene.id}).`);
    }
    await page.mouse.move(st.x, st.y); // makes the cursor dot appear (or keeps it where it is)
    await sleep(400);
    mark = performance.now(); // the clip starts here
    for (const [i, step] of (scene.steps || []).entries()) {
      try {
        // An optional step (for example "It's true" on a check that may not appear) waits briefly and is skipped if absent.
        await runStep(page, st, step.optional ? { timeoutMs: 4000, ...step } : step, ctx);
      } catch (e) {
        if (step.optional) continue;
        throw new Error(`step ${i + 1} (${JSON.stringify(step)}): ${String(e.message).split("\n")[0]}`);
      }
    }
    await sleep(500);
    length = ctx.now();
  } catch (e) {
    error = e;
    length = mark ? ctx.now() : 0;
    await page.screenshot({ path: `${paths.clips}/${scene.id}.error.png` }).catch(() => {});
    console.error(`  ${scene.id}: FAILED, ${error.message}`);
    if (!flags["keep-going"]) stopped = true;
  }
  results.push({ scene, segments, error, length, trim: mark ? (mark - created) / 1000 : 0 });
  if (!error) console.log(`  ${scene.id}: ok, ${length.toFixed(1)} s, ${segments.length} sped-up span(s).`);
}

await context.close();
const longFile = `${paths.out}/recording-all.webm`;
fs.rmSync(longFile, { force: true });
fs.renameSync(await video.path(), longFile);
await browser.close();

// Cut the long recording into one clip per scene.
for (const r of results) {
  const id = r.scene.id;
  const out = `${paths.clips}/${id}.webm`;
  fs.rmSync(out, { force: true });
  if (r.length > 0) {
    await ffmpeg([
      "-ss", r.trim.toFixed(3), "-i", longFile, "-t", r.length.toFixed(3), "-an",
      "-c:v", "libvpx", "-crf", "8", "-b:v", "20M", "-deadline", "good", "-cpu-used", "4", out,
    ]);
  }
  fs.writeFileSync(
    `${paths.clips}/${id}.json`,
    JSON.stringify({ id, trim: 0, length: +r.length.toFixed(3), segments: r.segments, ok: !r.error && r.length > 0 }, null, 2),
  );
}

const failed = results.filter((r) => r.error);
if (failed.length) process.exit(1);
console.log("Done. Clips are in " + paths.clips);
