// Renders every Tween state from the real TweenRig component into one contact sheet (light and dark backgrounds)
// so the rig can be looked at before it is wired into the site. Usage: node mascot/tools/rig-sheet.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";

const out = path.resolve(process.argv[2] ?? "mascot/eval-results/rig-sheet");
fs.mkdirSync(out, { recursive: true });
const tmp = path.join(out, ".rig.bundle.mjs");
await build({
  stdin: {
    contents: `export { TweenRig } from "./components/mascot/TweenRig.tsx"; export { renderToStaticMarkup } from "react-dom/server"; import React from "react"; export { React };`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: tmp,
  loader: { ".css": "empty" },
  alias: { "@": process.cwd() },
  logLevel: "error",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const { TweenRig, renderToStaticMarkup, React } = await import(pathToFileURL(tmp).href);
const css = fs.readFileSync(path.resolve("components/mascot/rig.css"), "utf8");

const faceFor = { wave: "happy", think: "think", celebrate: "joy", sleep: "sleep", shrug: "worried" };
const cases = [
  { state: "idle" },
  { state: "walk", facing: "right" },
  { state: "walk", facing: "left" },
  { state: "wave" },
  { state: "point", pointDir: "right", facing: "right" },
  { state: "point", pointDir: "left", facing: "left" },
  { state: "point", pointDir: "up" },
  { state: "talk", talking: true },
  { state: "think" },
  { state: "celebrate" },
  { state: "sleep" },
  { state: "shrug" },
  { state: "peek", mirror: true },
];
const cell = (c, dark) =>
  `<figure class="${dark ? "dark" : "light"}"><div class="rig">${renderToStaticMarkup(
    React.createElement(TweenRig, { facing: "left", pointDir: "left", talking: false, still: process.env.STILL === "1", face: faceFor[c.state] ?? "neutral", ...c }),
  )}</div><figcaption>${c.state}${c.facing ? " " + c.facing : ""}${c.pointDir ? " " + c.pointDir : ""}</figcaption></figure>`;
const html = `<!doctype html><meta charset="utf-8"><style>${css}
body{margin:0;background:#F8F9FF;font:13px system-ui;color:#0B1C30}
.grid{display:grid;grid-template-columns:repeat(5,230px);gap:0}
figure{margin:0;padding:12px;display:flex;flex-direction:column;align-items:center}
figure.dark{background:#090D16;color:#f1f5f9}
.rig{width:150px}
.rig svg{width:150px;height:auto}
figcaption{margin-top:6px}
</style><div class="grid">${cases.map((c) => cell(c, false)).join("")}${cases.map((c) => cell(c, true)).join("")}</div>`;
fs.writeFileSync(path.join(out, "sheet.html"), html);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(out, "sheet.html")).href);
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(out, "sheet.png"), fullPage: true });
await browser.close();
fs.rmSync(tmp);
console.log("saved", path.join(out, "sheet.png"));
