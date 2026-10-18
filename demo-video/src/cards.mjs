// Renders each "card" scene as an HTML page (the app's look) and records a clip of the exact audio length.
//   npm run cards [-- --only s01] [--scenes <file>] [--out <dir>]
// Writes out/cards/<id>.html, out/clips/<id>.webm and out/clips/<id>.json.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { FONTS_DIR, LEAD, TAIL, clipFile, loadScenes, mkdirs, narrationSeconds, outPaths, parseArgs, sleep } from "./lib.mjs";

const { flags } = parseArgs();
const { meta, sceneDir, scenes } = loadScenes(flags);
const paths = outPaths(flags);
mkdirs(paths.cards, paths.clips);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Tokens mirror src/app/globals.css (cream page, ink text, coral accent). The tag top-left is the product name:
// "brand" in scenes.json is the demo business (not the product), so it is never used here.
const accent = "#e4572e";
const brandName = meta.product || "Weekly Posts";

function cardHtml(scene, seconds, pending) {
  const c = scene.card || {};
  const bullets = Array.isArray(c.bullets) ? c.bullets : [];
  const dense = bullets.length >= 4 || bullets.join("").length > 200;
  // Stagger the bullets across the first ~65% of the narration, never faster than 0.6 s apart.
  const first = 1.1;
  const span = Math.max(0.6 * bullets.length, seconds * 0.65 - first);
  const step = bullets.length > 1 ? Math.min(1.4, span / (bullets.length - 1)) : 0;
  const fontUrl = pathToFileURL(path.join(FONTS_DIR, "Onest.ttf")).href;
  return `<!doctype html>
<html lang="${esc(meta.languageCode?.split("-")[0] || "en")}"><head><meta charset="utf-8">
<style>
  @font-face { font-family: "Onest"; src: url("${fontUrl}"); font-weight: 100 900; }
  :root { --cream:#fbfaf9; --ink:#1d1d1c; --title:#161616; --sub:#554f4c; --desc:#7a6f6b; --edge:#e5dcd9;
          --coral:${accent}; --coral-tint:#fdf3ef; --hero-from:#fce6dc; --hero-via:#f9ede6; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${meta.width}px; height: ${meta.height}px; overflow: hidden; }
  body { font-family: "Onest", system-ui, sans-serif; color: var(--ink); background:
    radial-gradient(1100px 700px at 100% 0%, var(--hero-from), transparent 70%),
    radial-gradient(900px 600px at 0% 100%, var(--hero-via), transparent 70%), var(--cream);
    position: relative; }
  .brand { position: absolute; left: 120px; top: 84px; display: flex; align-items: center; gap: 14px;
           font-size: 30px; font-weight: 600; color: var(--title); letter-spacing: .1px; }
  .brand i { width: 18px; height: 18px; border-radius: 50%; background: var(--coral); display: block; }
  .main { position: absolute; left: 120px; right: 120px; top: 150px; bottom: 170px; display: flex; flex-direction: column; justify-content: center; }
  .kicker { font-size: 28px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: var(--coral); margin-bottom: 26px; }
  h1 { font-size: 92px; line-height: 1.04; font-weight: 700; color: var(--title); letter-spacing: -1.5px; max-width: 1500px; }
  .sub { margin-top: 30px; font-size: 40px; line-height: 1.35; color: var(--sub); max-width: 1350px; font-weight: 400; }
  ul { list-style: none; padding: 0; margin-top: 52px; display: grid; gap: 18px; max-width: 1280px; }
  li { display: flex; align-items: center; gap: 22px; background: #fff; border: 1.5px solid var(--edge); border-radius: 16px;
       padding: 20px 30px; font-size: 36px; font-weight: 500; color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  li::before { content: ""; flex: none; width: 14px; height: 14px; border-radius: 50%; background: var(--coral); }
  .foot { margin-top: 34px; font-size: 24px; line-height: 1.4; color: var(--desc); max-width: 1500px; }
  .badge { align-self: flex-start; margin-top: 28px; font-size: 24px; font-weight: 600; color: var(--coral); background: var(--coral-tint); border: 1.5px solid #f5cdbf; border-radius: 999px; padding: 8px 22px; }
  body.dense h1 { font-size: 70px; max-width: 1650px; }
  body.dense .sub { font-size: 32px; margin-top: 20px; }
  body.dense ul { margin-top: 34px; gap: 12px; max-width: 1650px; }
  body.dense li { font-size: 29px; padding: 15px 26px; }
  body.dense .kicker { margin-bottom: 18px; }
  .rule { width: 72px; height: 6px; border-radius: 3px; background: var(--coral); margin-bottom: 24px; }
  /* entrance: nothing moves until body.go is set, so the recording starts from a clean frame */
  .in { opacity: 0; transform: translateY(26px); }
  body.go .in { animation: in .7s cubic-bezier(.2,.7,.2,1) forwards; animation-delay: var(--d, 0s); }
  body.go li.in { animation-name: slide; }
  @keyframes in { to { opacity: 1; transform: none; } }
  @keyframes slide { from { opacity: 0; transform: translateX(-46px); } to { opacity: 1; transform: none; } }
</style></head>
<body class="${dense ? "dense" : ""}">
  <div class="brand in" style="--d:0s"><i></i>${esc(brandName)}</div>
  <div class="main">
    <div class="rule in" style="--d:.1s"></div>
    ${c.kicker ? `<div class="kicker in" style="--d:.15s">${esc(c.kicker)}</div>` : ""}
    <h1 class="in" style="--d:.3s">${esc(c.title)}</h1>
    ${c.subtitle ? `<div class="sub in" style="--d:.6s">${esc(c.subtitle)}</div>` : ""}
    ${bullets.length ? `<ul>${bullets.map((b, i) => `<li class="in" style="--d:${(first + i * step).toFixed(2)}s">${esc(b)}</li>`).join("")}</ul>` : ""}
  ${c.footnote ? `<div class="foot in" style="--d:${(first + Math.max(0, bullets.length) * step + 0.3).toFixed(2)}s">${esc(c.footnote)}</div>` : ""}
  ${pending ? `<div class="badge in" style="--d:.8s">Clip pending: ${esc(pending)}</div>` : ""}
  </div>
</body></html>`;
}

// A "clip" scene whose video file is missing falls back to its card with a "pending" badge.
const cardScenes = scenes.filter((s) => s.type === "card" || (s.type === "clip" && !clipFile(s, sceneDir)));
const browser = await chromium.launch();
for (const scene of cardScenes) {
  const narr = await narrationSeconds(paths, scene);
  const seconds = LEAD + narr + TAIL;
  const htmlFile = path.join(paths.cards, `${scene.id}.html`);
  const pending = scene.type === "clip" ? path.basename(scene.clip?.file || "file missing") : "";
  if (pending) console.log(`  ${scene.id}: clip file not found, rendering the placeholder card.`);
  fs.writeFileSync(htmlFile, cardHtml(scene, narr, pending));

  const context = await browser.newContext({
    viewport: { width: meta.width, height: meta.height },
    deviceScaleFactor: 1,
    recordVideo: { dir: paths.clips, size: { width: meta.width, height: meta.height } },
  });
  const page = await context.newPage();
  const video = page.video();
  const created = performance.now();
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  const mark = performance.now();
  await page.evaluate(() => document.body.classList.add("go"));
  await sleep(seconds * 1000);
  const length = (performance.now() - mark) / 1000;
  const trim = (mark - created) / 1000;
  await context.close();
  fs.rmSync(path.join(paths.clips, `${scene.id}.webm`), { force: true });
  fs.renameSync(await video.path(), path.join(paths.clips, `${scene.id}.webm`));
  fs.writeFileSync(
    path.join(paths.clips, `${scene.id}.json`),
    JSON.stringify({ id: scene.id, trim: +trim.toFixed(3), length: +length.toFixed(3), segments: [], ok: true }, null, 2),
  );
  console.log(`  ${scene.id}: card, ${length.toFixed(1)} s`);
}
await browser.close();
console.log(`Done: ${cardScenes.length} card clip(s).`);
