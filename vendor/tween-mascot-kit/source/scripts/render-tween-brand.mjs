// Exports the real TweenRig component as brand assets: standalone SVGs (CSS embedded, still pose) and PNGs.
// Writes brand/tween-mascot(.svg/.png), tween-mascot-on-canvas, tween-character-sheet(.svg/.png), and copies the mascot
// into public/brand/. Usage: node scripts/render-tween-brand.mjs
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";

const OUT = path.resolve("brand");
const PUB = path.resolve("public/brand");
const tmp = path.join(OUT, ".rig.bundle.mjs");
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
fs.rmSync(tmp);

// The rig CSS drives poses with variables; a static asset needs it inline. Loops and transitions are dropped (data-still),
// the site's white halo is removed, and the @property rule is not needed for a still pose.
const css = fs
  .readFileSync(path.resolve("components/mascot/rig.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@property[\s\S]*?\}\s*/g, "")
  .replace(/filter:\s*drop-shadow\([^;]*\);/g, "");

const faceFor = { wave: "happy", think: "think", celebrate: "joy", sleep: "sleep", shrug: "worried" };
const rig = (c, extra = {}) =>
  renderToStaticMarkup(
    React.createElement(TweenRig, { facing: "left", pointDir: "left", talking: false, still: true, face: faceFor[c.state] ?? "neutral", ...c, ...extra }),
  );
// Standalone SVG: the rig's own root gets the namespace, a title for accessibility and the inline style.
const standalone = (c, { canvas } = {}) => {
  let s = rig(c, { className: "" });
  s = s.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tween, the Tweencrew mascot" ');
  s = s.replace(/ aria-hidden="true"/, "");
  // Taller canvas than the on-site rig so the feather tip is not cropped.
  s = s.replace('viewBox="10 12 380 462"', 'viewBox="10 -30 380 504"');
  s = s.replace(/>/, `><title>Tween, the Tweencrew mascot</title><style><![CDATA[${css}]]></style>` + (canvas ? `<rect x="10" y="-30" width="380" height="504" fill="${canvas}"/>` : ""));
  return s;
};

fs.writeFileSync(path.join(OUT, "tween-mascot.svg"), standalone({ state: "idle" }));
fs.writeFileSync(path.join(OUT, "tween-mascot-on-canvas.svg"), standalone({ state: "idle" }, { canvas: "#F8F9FF" }));

// Character sheet (SVG with nested rigs sharing one style block, so it also renders as an <img>).
const W = 3200;
const H = 1800;
const NAVY = "#0B1C30";
const text = (x, y, size, weight, fill, t) => `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${t}</text>`;
const nested = (c, x, y, w) => {
  const h = (w * 462) / 380;
  return rig(c, { className: "" })
    .replace("<svg ", `<svg x="${x}" y="${y}" width="${w}" height="${h}" `)
    .replace(/ aria-hidden="true"/, "");
};
const poses = [
  [{ state: "idle" }, "Neutral"],
  [{ state: "wave" }, "Waving"],
  [{ state: "point", pointDir: "right", facing: "right" }, "Pointing"],
  [{ state: "think" }, "Thinking"],
  [{ state: "celebrate" }, "Celebrating"],
  [{ state: "shrug" }, "Shrugging"],
  [{ state: "talk", talking: true }, "Talking"],
  [{ state: "sleep" }, "Sleeping"],
];
const cols = 4;
const cellW = 700;
const rigW = 400;
let sheet = `<rect width="${W}" height="${H}" fill="#F8F9FF"/>`;
sheet += text(120, 150, 72, 700, NAVY, "Tween: character sheet");
sheet += text(120, 215, 34, 400, "#444656", "Same proportions and colours in every pose. Peacock-feather morpankh, cobalt scarf, tapered limbs, paddle hands.");
poses.forEach(([c, label], i) => {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = 150 + col * (cellW + 40) + (cellW - rigW) / 2;
  const y = 270 + row * 640;
  sheet += nested(c, x, y, rigW);
  sheet += text(150 + col * (cellW + 40) + cellW / 2 - label.length * 9, y + 590, 36, 600, NAVY, label).replace("<text ", '<text text-anchor="start" ');
});
const swatches = [
  ["#0B1C30", "Ink navy", "body, limbs"],
  ["#2B4CFF", "Cobalt", "scarf"],
  ["#FFFFFF", "White", "eyes, smile"],
  ["#119C9A", "Peacock teal", "feather"],
  ["#F3B63A", "Feather gold", "feather eye"],
  ["#F26A21", "Feather orange", "feather eye"],
  ["#FF6B4A", "Coral", "highlights only"],
];
swatches.forEach(([c, name, use], i) => {
  const x = 150 + i * 430;
  sheet += `<rect x="${x}" y="1590" width="70" height="70" rx="8" fill="${c}" stroke="#C9D3E6" stroke-width="3"/>`;
  sheet += text(x + 88, 1620, 30, 700, NAVY, name);
  sheet += text(x + 88, 1656, 26, 400, "#444656", `${c} · ${use}`);
});
const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Tween character sheet"><title>Tween character sheet</title><style><![CDATA[${css}]]></style>${sheet}</svg>`;
fs.writeFileSync(path.join(OUT, "tween-character-sheet.svg"), sheetSvg);

// PNGs
const browser = await chromium.launch({ channel: "chrome" });
const shoot = async (file, w, h, scale, transparent) => {
  const svg = fs.readFileSync(path.join(OUT, file), "utf8");
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg style="display:block;width:${w}px;height:${h}px" `)}</body></html>`);
  await page.screenshot({ path: path.join(OUT, file.replace(".svg", ".png")), omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
};
await shoot("tween-mascot.svg", 380, 504, 3, true);
await shoot("tween-mascot-on-canvas.svg", 380, 504, 3, false);
await shoot("tween-character-sheet.svg", W, H, 1, false);
await browser.close();

fs.copyFileSync(path.join(OUT, "tween-mascot.svg"), path.join(PUB, "tween-mascot.svg"));
fs.copyFileSync(path.join(OUT, "tween-mascot.png"), path.join(PUB, "tween-mascot.png"));
console.log("written:", fs.readdirSync(OUT).filter((n) => n.startsWith("tween")).join(", "));
