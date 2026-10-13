// V-25 visual review samples for the mascot rig.
// Run: npx tsx scripts/mascot-samples.mts
// Output (test-results/mascot/):
//   sheet-<name>.png                 the 4x2 character sheet of each fixture concept
//   random-grid.png                  12 random specs, wave pose
//   <name>-<template>-<en|hi>.png    each fixture concept in every square and vertical template,
//                                    with an English and a Hindi speech bubble
//   <name>-templates-<en|hi>.png     contact sheet of those templates
// Landscape has no mascot slot, so it is not drawn here.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp, { type OverlayOptions } from 'sharp';
import { FIXTURE_CONCEPTS } from '../src/lib/mascot/fixtures';
import { randomSpec, seededRandom } from '../src/lib/mascot/random-spec';
import { drawMascot } from '../src/lib/mascot/rig';
import { renderSheetPng } from '../src/lib/mascot/sheet';
import { initShaping, listTemplates, measureText, renderPostDetailed, textToSvg, type Format } from '../src/lib/render/index';
import { sampleLogo, samplePhoto } from '../src/lib/render/fixtures';

await initShaping();
const out = 'test-results/mascot';
mkdirSync(out, { recursive: true });

// 1. Character sheets of the three fixture concepts.
for (const c of FIXTURE_CONCEPTS.concepts) {
  const png = await renderSheetPng(c.spec, { name: c.name, name_local: c.name_local });
  writeFileSync(path.join(out, `sheet-${c.name.toLowerCase()}.png`), png);
}

// 2. Grid of 12 random specs in the wave pose.
{
  const rng = seededRandom(20261013);
  const cols = 4;
  const rows = 3;
  const cell = 400;
  let body = `<rect width="${cols * cell}" height="${rows * (cell + 50)}" fill="#FBF6EC"/>`;
  for (let i = 0; i < cols * rows; i++) {
    const spec = randomSpec(rng);
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * (cell + 50);
    body += `<g transform="translate(${x} ${y})">${drawMascot(spec, 'wave')}</g>`;
    const label = `${spec.body.shape} · ${spec.head} · ${spec.neck} · ${spec.limbs.style}`;
    body += textToSvg(label, 500, x + cell / 2 - measureText(label, 500, 22) / 2, y + cell + 26, 22, '#5A4A3A');
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * (cell + 50)}">${body}</svg>`;
  writeFileSync(path.join(out, 'random-grid.png'), Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()));
}

// 3. Each fixture concept in every square and vertical template, English and Hindi bubble.
{
  const brand = { name: 'Sharma Sweets', colors: { primary: '#7a1f2b', secondary: '#f6e7c8', accent: '#f2b100' } };
  const languages = [
    { code: 'en', text: { headline: 'Fresh from the oven', subline: 'Warm bread, every morning', cta: 'Message us to order', bubble: 'Fresh from the oven!' } },
    { code: 'hi', text: { headline: 'दीवाली स्पेशल मिठाई', subline: 'काजू कतली और बेसन लड्डू', cta: 'ऑर्डर के लिए WhatsApp करें', bubble: 'आइए, स्वाद चखिए!' } },
  ];
  const photo = await samplePhoto();
  const logo = await sampleLogo();
  for (const lang of languages) {
    for (const c of FIXTURE_CONCEPTS.concepts) {
      const pngs: { format: Format; buf: Buffer }[] = [];
      for (const format of ['square', 'vertical'] as Format[]) {
        for (const t of listTemplates(format)) {
          const r = await renderPostDetailed({
            format,
            templateId: t.id,
            brand: { ...brand, logo },
            photo,
            text: lang.text,
            mascot: { svg: drawMascot(c.spec, 'wave') },
          });
          if (r.mascotDropped) throw new Error(`mascot dropped in ${t.id}`);
          if (!r.placements.some((p) => p.name === 'bubble')) throw new Error(`no bubble in ${t.id}`);
          writeFileSync(path.join(out, `${c.name.toLowerCase()}-${t.id}-${lang.code}.png`), r.png);
          pngs.push({ format, buf: r.png });
        }
      }
      const squares = pngs.filter((p) => p.format === 'square');
      const talls = pngs.filter((p) => p.format === 'vertical');
      const layers: OverlayOptions[] = [];
      for (let i = 0; i < squares.length; i++) {
        layers.push({ input: await sharp(squares[i].buf).resize(540, 540).png().toBuffer(), left: i * 540, top: 0 });
      }
      for (let i = 0; i < talls.length; i++) {
        layers.push({ input: await sharp(talls[i].buf).resize(540, 960).png().toBuffer(), left: i * 540, top: 540 });
      }
      await sharp({ create: { width: 540 * Math.max(squares.length, talls.length), height: 1500, channels: 3, background: '#dddddd' } })
        .composite(layers)
        .png()
        .toFile(path.join(out, `${c.name.toLowerCase()}-templates-${lang.code}.png`));
    }
  }
}

console.log('wrote', out);
