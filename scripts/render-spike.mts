// T-7 step 1: Devanagari shaping spike.
// Renders the 40 test strings two ways into contact sheets:
//   A: harfbuzzjs shaping -> SVG path outlines -> resvg   (test-results/render/spike-A.png)
//   B: resvg's own <text> with the Noto font file          (test-results/render/spike-B.png)
// Run: npx tsx scripts/render-spike.mts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { fontsDir, initShaping, measureText, textToSvg } from '../src/lib/render/shape';

await initShaping();

type Item = { id: string; text: string };
const items: Item[] = JSON.parse(readFileSync('test-data/devanagari-render.json', 'utf8'));
const outDir = 'test-results/render';
mkdirSync(outDir, { recursive: true });

const SIZE = 48;
const ROW = 92;
const LABEL_W = 110;
const PAD = 24;

// Sheet A
{
  const maxW = Math.max(...items.map((i) => measureText(i.text, 400, SIZE)));
  const W = Math.ceil(LABEL_W + PAD * 2 + maxW);
  const H = ROW * items.length + PAD;
  let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  items.forEach((it, n) => {
    const y = PAD + n * ROW;
    body += `<rect x="0" y="${y + ROW - 2}" width="${W}" height="1" fill="#ddd"/>`;
    body += textToSvg(it.id, 400, PAD, y + 56, 22, '#c00');
    body += textToSvg(it.text, 400, LABEL_W + PAD, y + 62, SIZE, '#000');
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
  writeFileSync(path.join(outDir, 'spike-A.png'), png);
}

// Sheet B
{
  const W = 1900;
  const H = ROW * items.length + PAD;
  const file = path.join(fontsDir(), 'NotoSansDevanagari_400Regular.ttf');
  let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  items.forEach((it, n) => {
    const y = PAD + n * ROW;
    body += `<rect x="0" y="${y + ROW - 2}" width="${W}" height="1" fill="#ddd"/>`;
    body += `<text x="${PAD}" y="${y + 56}" font-family="Noto Sans Devanagari" font-size="22" fill="#c00">${it.id}</text>`;
    body += `<text x="${LABEL_W + PAD}" y="${y + 62}" font-family="Noto Sans Devanagari" font-size="${SIZE}" fill="#000">${it.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  const png = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: [file], defaultFontFamily: 'Noto Sans Devanagari' },
  })
    .render()
    .asPng();
  writeFileSync(path.join(outDir, 'spike-B.png'), png);
}
console.log('wrote spike-A.png and spike-B.png in', outDir);
