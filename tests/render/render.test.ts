import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { contrast, pickInk } from '@/lib/render/color';
import { SAMPLE_MASCOT_SVG, samplePhoto, solidLogo } from '@/lib/render/fixtures';
import {
  FORMAT_SIZE,
  fitText,
  initShaping,
  listTemplates,
  renderPost,
  renderPostDetailed,
  templateInfo,
  type Format,
  type PostText,
  type RenderInput,
} from '@/lib/render';
import { shapeText } from '@/lib/render/shape';

const dv: { id: string; text: string }[] = JSON.parse(readFileSync('test-data/devanagari-render.json', 'utf8'));
const byId = (id: string) => dv.find((d) => d.id === id)!.text;

const PRIMARY = '#c2185b';
const LOGO_COLOUR = '#00b050';
const brand = { name: 'Sharma Sweets', colors: { primary: PRIMARY, secondary: '#f6e7c8', accent: '#f2b100' } };
const hindi: PostText = {
  headline: 'दीवाली स्पेशल मिठाई',
  subline: 'काजू कतली ₹880 किलो',
  cta: 'ऑर्डर के लिए WhatsApp करें',
  bubble: 'आइए, स्वाद चखिए!',
};

const FORMATS: Format[] = ['square', 'vertical', 'landscape'];
const allTemplates = FORMATS.flatMap((f) => listTemplates(f).map((t) => ({ ...t, format: f })));

let photo: Buffer;
let logo: Buffer;

beforeAll(async () => {
  await initShaping();
  photo = await samplePhoto();
  logo = await solidLogo(LOGO_COLOUR, 200);
});

async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function input(t: { id: string; format: Format }, over: Partial<RenderInput> = {}): RenderInput {
  return { format: t.format, templateId: t.id, brand: { ...brand, logo }, photo, text: hindi, ...over };
}

describe('templates (R6)', () => {
  it('has at least 3 templates per format, at least one text-only', () => {
    for (const f of FORMATS) {
      const list = listTemplates(f);
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list.some((t) => !t.needsPhoto)).toBe(true);
    }
  });

  it.each(allTemplates)('$id renders at the exact format size', async (t) => {
    const png = await renderPost(input(t));
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(FORMAT_SIZE[t.format].w);
    expect(meta.height).toBe(FORMAT_SIZE[t.format].h);
  });

  it.each(allTemplates)('$id shows the brand primary colour at its probe point', async (t) => {
    const info = templateInfo(t.id)!;
    const png = await renderPost(input(t));
    expect(await pixel(png, info.probe.x, info.probe.y)).toEqual(hex(PRIMARY));
    // A different brand colour changes the pixel.
    const other = await renderPost(input(t, { brand: { ...brand, colors: { ...brand.colors, primary: '#1a5fb4' }, logo } }));
    expect(await pixel(other, info.probe.x, info.probe.y)).toEqual(hex('#1a5fb4'));
  });

  it.each(allTemplates)('$id places the logo in its slot', async (t) => {
    const info = templateInfo(t.id)!;
    const png = await renderPost(input(t));
    const cx = Math.round(info.logoSlot.x + info.logoSlot.w / 2);
    const cy = Math.round(info.logoSlot.y + info.logoSlot.h / 2);
    expect(await pixel(png, cx, cy)).toEqual(hex(LOGO_COLOUR));
  });

  it.each(allTemplates)('$id draws no <text> element and draws the Hindi headline', async (t) => {
    const r = await renderPostDetailed(input(t));
    expect(r.svg).not.toContain('<text');
    const head = r.placements.find((p) => p.name === 'headline')!;
    expect(head.lines.length).toBeGreaterThan(0);
    const line = head.lines[0];
    const { data, info } = await sharp(r.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => 3 * (y * info.width + x);
    // Ink inside the first headline line differs strongly from the background at its left edge.
    let changed = 0;
    const ref = at(Math.floor(line.x) + 1, Math.floor(line.y) + 2);
    for (let y = Math.floor(line.y); y < line.y + line.h; y += 2) {
      for (let x = Math.floor(line.x); x < line.x + line.w; x += 2) {
        const i = at(x, y);
        if (Math.abs(data[i] - data[ref]) + Math.abs(data[i + 1] - data[ref + 1]) + Math.abs(data[i + 2] - data[ref + 2]) > 150) changed++;
      }
    }
    expect(changed).toBeGreaterThan(300);
  });
});

describe('text fit', () => {
  const sizes = [
    { name: 'headline', weight: 800 as const, w: 960, h: 190, max: 100, min: 44, lines: 3 },
    { name: 'subline', weight: 500 as const, w: 960, h: 84, max: 46, min: 28, lines: 2 },
    { name: 'tight', weight: 800 as const, w: 400, h: 120, max: 100, min: 44, lines: 3 },
  ];
  for (const id of ['dv-38', 'dv-39']) {
    for (const s of sizes) {
      it(`${id} stays inside the ${s.name} box`, () => {
        const f = fitText(byId(id), { weight: s.weight, boxW: s.w, boxH: s.h, maxSize: s.max, minSize: s.min, maxLines: s.lines });
        expect(f.lines.length).toBeGreaterThan(0);
        expect(f.lines.length).toBeLessThanOrEqual(s.lines);
        expect(f.size).toBeGreaterThanOrEqual(s.min);
        expect(f.height).toBeLessThanOrEqual(s.h + 0.001);
        for (const l of f.lines) expect(l.width).toBeLessThanOrEqual(s.w + 0.001);
      });
    }
    it(`${id} is truncated with an ellipsis when the box is far too small`, () => {
      const f = fitText(byId(id), { weight: 800, boxW: 300, boxH: 60, maxSize: 100, minSize: 44, maxLines: 1 });
      expect(f.truncated).toBe(true);
      expect(f.lines).toHaveLength(1);
      expect(f.lines[0].text.endsWith('…')).toBe(true);
      expect(f.lines[0].width).toBeLessThanOrEqual(300);
    });
  }

  it('breaks a word wider than the box instead of overflowing', () => {
    const f = fitText('अंतर्राष्ट्रीयअंतर्राष्ट्रीयअंतर्राष्ट्रीय', { weight: 800, boxW: 300, boxH: 400, maxSize: 60, minSize: 44, maxLines: 6 });
    for (const l of f.lines) expect(l.width).toBeLessThanOrEqual(300);
  });

  it.each(allTemplates)('$id keeps every line box inside its box and the canvas (long Hindi, with mascot)', async (t) => {
    const text: PostText = {
      headline: byId('dv-38'),
      subline: byId('dv-39'),
      cta: byId('dv-38') + ' ' + byId('dv-40'),
      bubble: byId('dv-39'),
    };
    const r = await renderPostDetailed(input(t, { text, mascot: { svg: SAMPLE_MASCOT_SVG } }));
    const { w, h } = FORMAT_SIZE[t.format];
    expect(r.placements.length).toBeGreaterThan(3);
    for (const p of r.placements) {
      expect(p.box.x).toBeGreaterThanOrEqual(0);
      expect(p.box.y).toBeGreaterThanOrEqual(0);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(w);
      expect(p.box.y + p.box.h).toBeLessThanOrEqual(h);
      for (const l of p.lines) {
        const e = 0.01;
        expect(l.x).toBeGreaterThanOrEqual(p.box.x - e);
        expect(l.y).toBeGreaterThanOrEqual(p.box.y - e);
        expect(l.x + l.w).toBeLessThanOrEqual(p.box.x + p.box.w + e);
        expect(l.y + l.h).toBeLessThanOrEqual(p.box.y + p.box.h + e);
      }
    }
  });

  it.each(allTemplates)('$id: text stays in its region and clear of other blocks, bubble and mascot (long Hindi)', async (t) => {
    const text: PostText = { headline: byId('dv-38'), subline: byId('dv-39'), cta: byId('dv-40'), bubble: byId('dv-38') };
    const r = await renderPostDetailed(input(t, { text, mascot: { svg: SAMPLE_MASCOT_SVG } }));
    type B = { x: number; y: number; w: number; h: number };
    const union = (ls: B[]): B => {
      const x0 = Math.min(...ls.map((l) => l.x));
      const y0 = Math.min(...ls.map((l) => l.y));
      const x1 = Math.max(...ls.map((l) => l.x + l.w));
      const y1 = Math.max(...ls.map((l) => l.y + l.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const hit = (a: B, b: B) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const blocks = r.placements.filter((p) => ['headline', 'subline', 'cta'].includes(p.name));
    expect(blocks.length).toBe(3);
    for (const p of blocks) {
      const u = union(p.lines);
      expect(u.x).toBeGreaterThanOrEqual(p.region!.x - 0.01);
      expect(u.y).toBeGreaterThanOrEqual(p.region!.y - 0.01);
      expect(u.x + u.w).toBeLessThanOrEqual(p.region!.x + p.region!.w + 0.01);
      expect(u.y + u.h).toBeLessThanOrEqual(p.region!.y + p.region!.h + 0.01);
    }
    const others = r.placements.filter((p) => ['bubble', 'mascot', 'logo'].includes(p.name));
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        expect(hit(union(blocks[i].lines), union(blocks[j].lines)), `${blocks[i].name} vs ${blocks[j].name}`).toBe(false);
      }
      for (const o of others) expect(hit(union(blocks[i].lines), o.box), `${blocks[i].name} vs ${o.name}`).toBe(false);
    }
  });
});

describe('shaping and fonts', () => {
  it('shapes every Devanagari test string without a missing glyph, in every weight', () => {
    for (const w of [400, 500, 700, 800] as const) {
      for (const d of dv) expect(shapeText(d.text, w).missing, `${d.id} @${w}`).toBe(0);
    }
  });

  it('forms conjuncts (fewer glyphs than code points)', () => {
    for (const c of ['क्ष', 'त्र', 'ज्ञ', 'श्र', 'द्ध', 'स्त्र']) {
      expect(shapeText(c, 400).glyphs.length, c).toBeLessThan(Array.from(c).length);
    }
    for (const c of ['क्ष', 'ज्ञ', 'द्ध']) expect(shapeText(c, 400).glyphs.length, c).toBe(1);
  });

  it('renders the rupee sign and Latin digits in mixed strings', () => {
    expect(shapeText('₹120 में ताज़ा लस्सी iPhone', 700).missing).toBe(0);
    expect(shapeText('₹', 700).glyphs.length).toBe(1);
  });

  it('reports characters no font covers', () => {
    expect(shapeText('\u{1F600}', 400).missing).toBeGreaterThan(0);
  });
});

describe('readability', () => {
  it('picks white or near-black ink with at least 4.5:1 contrast on any colour', () => {
    const levels = [0, 51, 102, 128, 153, 204, 255];
    for (const r of levels)
      for (const g of levels)
        for (const b of levels) {
          const bg = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
          expect(contrast(pickInk(bg), bg), bg).toBeGreaterThanOrEqual(4.5);
        }
  });
});

describe('inputs', () => {
  it.each(allTemplates)('$id accepts empty strings and an empty brand name', async (t) => {
    const png = await renderPost(
      input(t, { text: { headline: '', subline: '', cta: '', bubble: '' }, brand: { ...brand, name: '', logo: undefined } }),
    );
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([FORMAT_SIZE[t.format].w, FORMAT_SIZE[t.format].h]);
  });

  it('works with only a headline', async () => {
    const png = await renderPost(input(allTemplates[0], { text: { headline: 'दीवाली', subline: '', cta: '', bubble: '' } }));
    expect((await sharp(png).metadata()).width).toBe(1080);
  });

  it.each(allTemplates.filter((t) => !t.needsPhoto))('$id works with no photo', async (t) => {
    const r = await renderPostDetailed(input(t, { photo: undefined }));
    expect(r.fellBack).toBe(false);
    expect(r.templateId).toBe(t.id);
  });

  it.each(allTemplates.filter((t) => t.needsPhoto))('$id with no photo is replaced by a text-only template', async (t) => {
    const r = await renderPostDetailed(input(t, { photo: undefined }));
    expect(r.fellBack).toBe(true);
    const used = allTemplates.find((x) => x.id === r.templateId)!;
    expect(used.needsPhoto).toBe(false);
    expect(used.format).toBe(t.format);
    expect(r.width).toBe(FORMAT_SIZE[t.format].w);
  });

  it('treats an unreadable photo like a missing one', async () => {
    const t = allTemplates.find((x) => x.needsPhoto)!;
    const r = await renderPostDetailed(input(t, { photo: Buffer.from('not an image') }));
    expect(r.fellBack).toBe(true);
  });

  it('ignores an unreadable logo', async () => {
    const png = await renderPost(input(allTemplates[0], { brand: { ...brand, logo: Buffer.from('nope') } }));
    expect((await sharp(png).metadata()).width).toBe(1080);
  });

  it('rejects an unknown template and a template of the wrong format', async () => {
    await expect(renderPost({ ...input(allTemplates[0]), templateId: 'nope' })).rejects.toThrow(/Unknown template/);
    await expect(renderPost({ ...input(allTemplates[0]), format: 'tall' })).rejects.toThrow(/not tall/);
  });

  it('accepts other photo formats and orientations', async () => {
    const t = allTemplates.find((x) => x.needsPhoto)!;
    const png = await sharp(await samplePhoto(600, 900)).png().toBuffer();
    const r = await renderPostDetailed(input(t, { photo: png }));
    expect(r.fellBack).toBe(false);
  });
});

describe('mascot slot', () => {
  it('draws the mascot and bubble when given, and nothing when null', async () => {
    const t = { id: 'sq-text', format: 'square' as const };
    const withM = await renderPostDetailed(input(t, { mascot: { svg: SAMPLE_MASCOT_SVG } }));
    expect(withM.placements.some((p) => p.name === 'mascot')).toBe(true);
    expect(withM.placements.some((p) => p.name === 'bubble')).toBe(true);
    expect(await pixel(withM.png, 860, 830)).toEqual(hex('#ffc93c')); // face of the placeholder mascot
    const without = await renderPostDetailed(input(t, { mascot: null }));
    expect(without.placements.some((p) => p.name === 'mascot' || p.name === 'bubble')).toBe(false);
    expect(await pixel(without.png, 860, 830)).toEqual(hex(PRIMARY));
  });

  it('clips the mascot to its slot', async () => {
    const big = '<rect x="-4000" y="-4000" width="9000" height="9000" fill="#00ff00"/>';
    const r = await renderPostDetailed(input({ id: 'sq-text', format: 'square' }, { mascot: { svg: big } }));
    expect(await pixel(r.png, 860, 830)).toEqual([0, 255, 0]);
    expect(await pixel(r.png, 660, 640)).not.toEqual([0, 255, 0]); // just outside the slot {690,660,340,340}
  });

  it('drops a malformed mascot instead of failing', async () => {
    const r = await renderPostDetailed(input({ id: 'tl-text', format: 'vertical' as const }, { mascot: { svg: '<g><rect' } }));
    expect(r.mascotDropped).toBe(true);
    expect((await sharp(r.png).metadata()).height).toBe(1920);
  });
});

describe('speed', () => {
  it.each(allTemplates)('$id renders in under 1 second after warm-up', async (t) => {
    await renderPost(input(t)); // warm-up
    const t0 = performance.now();
    await renderPost(input(t, { mascot: { svg: SAMPLE_MASCOT_SVG } }));
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
