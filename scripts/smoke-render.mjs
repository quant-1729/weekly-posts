// Smoke test for the rendering stack in a deployed layout (C-31). Plain Node, no TypeScript, no app code.
// Run it from the folder that holds server.js (in the Docker image: /app):
//   node smoke-render.mjs
// It proves, with the packages and fonts that were actually shipped, that:
//   - the Noto font files are found at <cwd>/assets/fonts (the renderer reads them from process.cwd())
//   - harfbuzzjs (wasm) loads and shapes Devanagari with the real font
//   - @resvg/resvg-js (native) draws an SVG to a PNG
//   - sharp (native) turns that PNG into a JPEG
// Exit code 0 = all good. The Dockerfile runs it during the build and you can run it in a container:
//   docker run --rm weekly-posts node smoke-render.mjs
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "server.js"));
const fonts = path.join(process.cwd(), "assets", "fonts");
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

try {
  // 1. Fonts: 3 families x 4 weights.
  const names = [];
  for (const base of ["NotoSans", "NotoSansDevanagari", "NotoSansArabic"]) {
    for (const w of ["400Regular", "500Medium", "700Bold", "800ExtraBold"]) names.push(`${base}_${w}.ttf`);
  }
  const missing = names.filter((n) => !existsSync(path.join(fonts, n)));
  check("12 Noto font files at assets/fonts", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : fonts);

  // 2. HarfBuzz (wasm) shaping Devanagari with the shipped font.
  const hb = await import("harfbuzzjs");
  const h = hb.default ?? hb;
  const data = readFileSync(path.join(fonts, "NotoSansDevanagari_400Regular.ttf"));
  const face = new h.Face(new h.Blob(data));
  const font = new h.Font(face);
  const glyph = font.nominalGlyph("क".codePointAt(0));
  check("harfbuzzjs loads and finds a Devanagari glyph", Boolean(glyph) && glyph !== 0, `glyph ${glyph}`);
  const d = font.glyphToPath(glyph);
  check("harfbuzzjs draws the glyph outline", typeof d === "string" && d.length > 10);

  // 3. resvg (native): outline path to PNG.
  const { Resvg } = require("@resvg/resvg-js");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#fff"/><g transform="translate(40 150) scale(0.1 -0.1)"><path d="${d}" fill="#000"/></g></svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
  check("resvg draws a PNG", png.length > 200 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, `${png.length} bytes`);

  // 4. sharp (native): PNG to JPEG.
  const sharp = require("sharp");
  const jpeg = await sharp(png).jpeg({ quality: 80 }).toBuffer();
  check("sharp converts it to a JPEG", jpeg.length > 100 && jpeg[0] === 0xff && jpeg[1] === 0xd8, `${jpeg.length} bytes`);
} catch (e) {
  console.error(e);
  failed++;
}

console.log(failed === 0 ? "Smoke test passed." : `Smoke test FAILED (${failed}).`);
process.exit(failed === 0 ? 0 : 1);
