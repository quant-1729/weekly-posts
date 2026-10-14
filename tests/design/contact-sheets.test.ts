// Writes one contact sheet per theme (every format, with and without a photo) to test-results/design/
// for a person to look at; also checks render time. Not a pass/fail look at the art itself.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp, { type OverlayOptions } from 'sharp';
import { renderDesignDetailed, THEME_IDS } from '@/lib/design';
import { samplePhoto, sampleLogo, SAMPLE_MASCOT_SVG } from '@/lib/render/fixtures';
import { ALL_FORMATS, content, input } from './fixtures';

const OUT = 'test-results/design';

describe('contact sheets', () => {
  it('writes a sheet per theme and measures render time', async () => {
    mkdirSync(OUT, { recursive: true });
    const photo = await samplePhoto();
    const logo = await sampleLogo();
    const times: Record<string, number[]> = {};
    const thumbs: Buffer[] = [];
    for (const themeId of THEME_IDS) {
      const rows: Buffer[][] = [];
      for (const withPhoto of [false, true]) {
        const row: Buffer[] = [];
        for (const format of ALL_FORMATS) {
          const t0 = performance.now();
          const r = await renderDesignDetailed(
            input({
              format,
              themeId,
              photo: withPhoto ? photo : null,
              logo: withPhoto ? logo : null,
              mascot: format === 'square' || format === 'vertical' || format === 'portrait' ? { svg: SAMPLE_MASCOT_SVG } : null,
              content: content({ secondary: content().secondary.slice(0, withPhoto ? 1 : 2) }),
            }),
          );
          (times[format] ??= []).push(performance.now() - t0);
          row.push(await sharp(r.png).resize({ height: 480 }).png().toBuffer());
          if (format === 'thumbnail') thumbs.push(await sharp(r.png).resize({ width: 640 }).png().toBuffer());
        }
        rows.push(row);
      }
      const widths = rows.map(() => 0);
      const metas = await Promise.all(rows.map((row) => Promise.all(row.map((b) => sharp(b).metadata()))));
      metas.forEach((m, i) => (widths[i] = m.reduce((a, x) => a + x.width! + 12, 0)));
      const W = Math.max(...widths);
      const comps: OverlayOptions[] = [];
      rows.forEach((row, ri) => {
        let x = 0;
        row.forEach((b, i) => {
          comps.push({ input: b, left: x, top: ri * 492 });
          x += metas[ri][i].width! + 12;
        });
      });
      const sheet = await sharp({ create: { width: W, height: 2 * 492, channels: 3, background: '#7a7a7a' } }).composite(comps).png().toBuffer();
      writeFileSync(`${OUT}/${themeId}.png`, sheet);
    }
    // Thumbnails of every theme on one sheet: text-only and photo pairs, 3 themes per row.
    const tw = 640;
    const th = 360;
    const cols = 6;
    const rowsN = Math.ceil(thumbs.length / cols);
    const tcomps: OverlayOptions[] = thumbs.map((b, i) => ({ input: b, left: (i % cols) * (tw + 10), top: Math.floor(i / cols) * (th + 10) }));
    const tsheet = await sharp({ create: { width: cols * (tw + 10), height: rowsN * (th + 10), channels: 3, background: '#7a7a7a' } }).composite(tcomps).png().toBuffer();
    writeFileSync(`${OUT}/thumbnails.png`, tsheet);
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const summary = Object.fromEntries(Object.entries(times).map(([f, a]) => [f, Math.round(median(a))]));
    writeFileSync(`${OUT}/render-times-ms.json`, JSON.stringify(summary, null, 1));
    for (const f of ALL_FORMATS) expect(summary[f]).toBeLessThan(3000);
  }, 180_000);
});
