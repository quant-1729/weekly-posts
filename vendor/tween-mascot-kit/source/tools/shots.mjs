// Screenshots every Tween state on the real site at 1440 and 375 px (installed Chrome) and builds a contact sheet per width.
// Usage: node mascot/tools/shots.mjs [baseUrl] [outDir]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3100";
const out = path.resolve(process.argv[3] ?? "mascot/eval-results/shots");
fs.mkdirSync(out, { recursive: true });
const states = [
  ["idle", "idle"],
  ["walk", "walk&dir=right"],
  ["wave", "wave"],
  ["point", "point&dir=right"],
  ["talk", "talk"],
  ["think", "think"],
  ["celebrate", "celebrate"],
  ["sleep", "sleep"],
  ["peek", "peek"],
  ["shrug", "shrug"],
];
const browser = await chromium.launch({ channel: "chrome" });
for (const [w, h] of [[1440, 900], [375, 812]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const files = [];
  for (const [name, q] of states) {
    const page = await ctx.newPage();
    await page.goto(`${base}/?tween=${q}`, { waitUntil: "load" });
    await page.locator('[data-tween="root"], [data-tween="show"]').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    const sel = name === "peek" ? '[data-tween="show"]' : '[data-tween="root"] .tw-anchor';
    const box = await page.locator(sel).first().boundingBox();
    const pad = 70;
    const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(w - Math.max(0, box.x - pad), box.width + pad * 2), height: Math.min(h - Math.max(0, box.y - pad), box.height + pad * 2) };
    await page.screenshot({ path: path.join(out, `${name}-${w}-full.png`) });
    const f = path.join(out, `${name}-${w}.png`);
    await page.screenshot({ path: f, clip });
    files.push([name, f]);
    await page.close();
  }
  await ctx.close();
  const html = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#ddd;font:14px system-ui}.g{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:8px}figure{margin:0;background:#fff;text-align:center}img{max-width:100%}</style><div class=g>${files.map(([n, f]) => `<figure><img src="${pathToFileURL(f).href}"><figcaption>${n} @${w}</figcaption></figure>`).join("")}</div>`;
  const sheet = path.join(out, `sheet-${w}.html`);
  fs.writeFileSync(sheet, html);
  const p = await browser.newPage({ viewport: { width: 1500, height: 700 } });
  await p.goto(pathToFileURL(sheet).href);
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, `sheet-${w}.png`), fullPage: true });
  await p.close();
}
await browser.close();
console.log("saved to", out);
