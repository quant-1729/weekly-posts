// Contact sheets of the three options of a brief with a character (CH-2), for a person to look at. Written only when
// ROLE_SHEET_DIR is set: `ROLE_SHEET_DIR=<dir> npx vitest run tests/design/character-sheets.test.ts`. Checks only that every option is clean.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp, { type OverlayOptions } from 'sharp';
import { describe, expect, it } from 'vitest';
import type { CharacterId } from '@/lib/characters';
import { designOptions, renderDesignDetailed, type DesignFormat } from '@/lib/design';
import { hashSeed } from '@/lib/design/options';
import { content, kit, PALETTES } from './fixtures';
import { expectClean } from './helpers';
import { realisticPhoto } from './photo-fixture';

const DIR = process.env.ROLE_SHEET_DIR;

const BRIEFS = [
  { name: 'offer-photo', postType: 'offer' as const, photo: true, content: content({ secondary: content().secondary.slice(0, 1) }) },
  { name: 'new-product', postType: 'new_product' as const, photo: false, content: content({ headline: 'New: ragi cookies', subline: 'Baked this morning', primary: null, secondary: [{ kind: 'quality', text: 'No refined sugar' }], offerLine: null, cta: { kind: 'order', text: 'Order on WhatsApp' } }) },
  { name: 'festival', postType: 'occasion' as const, photo: false, content: content({ headline: 'Happy Diwali', subline: 'From all of us at Sunrise Sweets', primary: null, secondary: [], offerLine: null, blocks: content().blocks.slice(0, 1), qr: null, cta: null }) },
];
const CHARACTERS: CharacterId[] = ['parchi', 'dabba'];

describe.skipIf(!DIR)('character contact sheets', () => {
  for (const format of ['square', 'portrait'] as DesignFormat[]) {
    it(`writes the ${format} sheet`, async () => {
      mkdirSync(DIR!, { recursive: true });
      const photo = await realisticPhoto();
      const rows: Buffer[][] = [];
      for (const b of BRIEFS) {
        for (const id of CHARACTERS) {
          const k = kit(PALETTES.bakery, { themeId: 'clean' });
          const options = designOptions({ kit: k, content: b.content, format, hasPhoto: b.photo, seed: hashSeed('brand-sheet'), postType: b.postType, character: 'rig' });
          const row: Buffer[] = [];
          for (const o of options) {
            const r = await renderDesignDetailed({ format, themeId: o.themeId, layoutId: o.layoutId, scheme: o.scheme, kit: k, brandName: 'Sunrise Sweets', language: 'en', content: b.content, photo: b.photo ? photo : null, character: o.role ? { kind: 'rig', id } : null, role: o.role ?? null, seed: hashSeed('brand-sheet'), poseHint: 'wave' });
            expect(expectClean(r, `${b.name} ${id} ${o.role}`).problems).toEqual([]);
            row.push(await sharp(r.png).resize({ height: 640 }).png().toBuffer());
          }
          rows.push(row);
        }
      }
      const metas = await Promise.all(rows.map((row) => Promise.all(row.map((x) => sharp(x).metadata()))));
      const w = metas[0][0].width!;
      const comps: OverlayOptions[] = [];
      rows.forEach((row, ri) => row.forEach((x, i) => comps.push({ input: x, left: i * (w + 10), top: ri * 650 })));
      const sheet = await sharp({ create: { width: 3 * (w + 10), height: rows.length * 650, channels: 3, background: '#777777' } }).composite(comps).png().toBuffer();
      writeFileSync(`${DIR}/${format}.png`, sheet);
    }, 300_000);
  }
});
