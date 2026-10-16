// UX-2: post filters change the photo and the abstract background and nothing else.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { applyPostFilter, filterActive, lookAt, parsePostFilter, POST_FILTER_PRESETS, renderDesignDetailed, type DesignDetail, type PostFilter } from '@/lib/design';
import { SAMPLE_MASCOT_SVG, solidLogo } from '@/lib/render/fixtures';
import { content, input, LINK_QR, PAY_QR } from './fixtures';
import { realisticPhoto } from './photo-fixture';

const PRESETS = POST_FILTER_PRESETS.filter((p) => p !== 'none');
const raw = async (png: Buffer) => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};
const px = (r: { data: Buffer; w: number }, x: number, y: number) => {
  const i = (Math.round(y) * r.w + Math.round(x)) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};

/** Share of pixels (whole canvas) that differ between two renders by more than a few levels. */
const changedShare = (a: { data: Buffer; w: number; h: number }, b: { data: Buffer }) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 3) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 12) n++;
  return n / (a.w * a.h);
};

const baseInput = async (over: Partial<Parameters<typeof input>[0]> = {}) => {
  const photo = await realisticPhoto();
  const logo = await solidLogo('#123a6b', 160);
  return input({ format: 'square', themeId: 'clean', photo, logo, mascot: { svg: SAMPLE_MASCOT_SVG }, content: content({ secondary: content().secondary.slice(0, 1) }), ...over });
};

/** Everything drawn by code must be the same pixel for pixel: the QR tile, the logo image, the ink of every text line, the mascot. */
async function expectCodeDrawnPixelsEqual(plain: DesignDetail, filtered: DesignDetail, label: string) {
  const a = await raw(plain.png);
  const b = await raw(filtered.png);
  // QR: the whole square (white tile, black modules) is opaque.
  expect(plain.qrBox, label).not.toBeNull();
  const q = plain.qrBox!;
  for (let y = Math.floor(q.y); y < q.y + q.h; y += 3) for (let x = Math.floor(q.x); x < q.x + q.w; x += 3) expect(px(b, x, y), `${label} qr ${x},${y}`).toEqual(px(a, x, y));
  // Logo image: opaque solid-colour logo drawn over its plate.
  const logo = plain.placements.find((p) => p.name === 'logo')!;
  const l = logo.lines[0];
  for (let y = Math.floor(l.y) + 2; y < l.y + l.h - 2; y += 4) for (let x = Math.floor(l.x) + 2; x < l.x + l.w - 2; x += 4) expect(px(b, x, y), `${label} logo`).toEqual(px(a, x, y));
  // Text: wherever a text pixel is exactly the ink in the plain render it is exactly the ink in the filtered one too.
  let inkPixels = 0;
  for (const p of plain.placements) {
    if (p.kind !== 'text' || !p.ink) continue;
    const ink = [parseInt(p.ink.slice(1, 3), 16), parseInt(p.ink.slice(3, 5), 16), parseInt(p.ink.slice(5, 7), 16)];
    for (const ln of p.lines) {
      for (let y = Math.floor(ln.y); y < ln.y + ln.h; y++) {
        for (let x = Math.floor(ln.x); x < ln.x + ln.w; x++) {
          const pa = px(a, x, y);
          if (pa[0] === ink[0] && pa[1] === ink[1] && pa[2] === ink[2]) {
            inkPixels++;
            expect(px(b, x, y), `${label} ${p.name} ${x},${y}`).toEqual(ink);
          }
        }
      }
    }
  }
  expect(inkPixels, `${label} ink pixels`).toBeGreaterThan(500);
  // The mascot's centre (opaque face colour).
  const m = plain.placements.find((p) => p.kind === 'mascot');
  if (m) {
    const c = m.lines[0];
    expect(px(b, c.x + c.w / 2, c.y + c.h / 2), `${label} mascot`).toEqual(px(a, c.x + c.w / 2, c.y + c.h / 2));
  }
}

describe('filter model', () => {
  it('has the presets of the brief and validates a stored filter', () => {
    expect([...POST_FILTER_PRESETS]).toEqual(['none', 'warm', 'cool', 'vivid', 'soft', 'mono', 'vintage']);
    expect(parsePostFilter({ preset: 'warm', intensity: 40 })).toEqual({ preset: 'warm', intensity: 40 });
    expect(parsePostFilter({ preset: 'sepia', intensity: 40 })).toEqual({ preset: 'none', intensity: 100 });
    expect(parsePostFilter({ preset: 'warm', intensity: 140 })).toEqual({ preset: 'none', intensity: 100 });
    expect(parsePostFilter(null)).toEqual({ preset: 'none', intensity: 100 });
    expect(filterActive({ preset: 'none', intensity: 80 })).toBe(false);
    expect(filterActive({ preset: 'warm', intensity: 0 })).toBe(false);
    expect(filterActive({ preset: 'warm', intensity: 1 })).toBe(true);
  });

  it('moves smoothly from the picture as it is (0) to the full look (100)', () => {
    expect(lookAt('vivid', 0)).toEqual({ sat: 1, gain: [1, 1, 1], contrast: 1, lift: 0, blur: 0 });
    expect(lookAt('vivid', 50).sat).toBeCloseTo((1 + lookAt('vivid', 100).sat) / 2, 6);
    expect(lookAt('mono', 100).sat).toBe(0);
  });

  it('returns the very same bytes for none, intensity 0, no filter and unreadable input', async () => {
    const photo = await realisticPhoto(400, 300);
    for (const f of [null, undefined, { preset: 'none', intensity: 100 }, { preset: 'warm', intensity: 0 }] as (PostFilter | null | undefined)[]) {
      expect(await applyPostFilter(photo, f)).toBe(photo);
    }
    const junk = Buffer.from('not an image');
    expect(await applyPostFilter(junk, { preset: 'warm', intensity: 100 })).toBe(junk);
    expect(await applyPostFilter(null, { preset: 'warm', intensity: 100 })).toBeNull();
  });

  it('mono gives grey pixels, warm raises red over blue, cool the opposite', async () => {
    const photo = await realisticPhoto(400, 300);
    const mean = async (f: PostFilter) => {
      const out = (await applyPostFilter(photo, f))!;
      const s = await sharp(out).stats();
      return s.channels.map((c) => c.mean);
    };
    const mono = await mean({ preset: 'mono', intensity: 100 });
    expect(Math.abs(mono[0] - mono[1])).toBeLessThan(2);
    expect(Math.abs(mono[1] - mono[2])).toBeLessThan(2);
    const base = await sharp(photo).stats();
    const warm = await mean({ preset: 'warm', intensity: 100 });
    const cool = await mean({ preset: 'cool', intensity: 100 });
    expect(warm[0] - warm[2]).toBeGreaterThan(base.channels[0].mean - base.channels[2].mean);
    expect(cool[2] - cool[0]).toBeGreaterThan(base.channels[2].mean - base.channels[0].mean);
  });
});

describe('filters in the render', () => {
  it('none (or no filter, or intensity 0) leaves the picture byte-for-byte as it was', async () => {
    const base = await baseInput();
    const plain = await renderDesignDetailed(base);
    for (const f of [{ preset: 'none', intensity: 100 }, { preset: 'none', intensity: 30 }, { preset: 'vivid', intensity: 0 }] as PostFilter[]) {
      const r = await renderDesignDetailed({ ...base, filter: f });
      expect(r.png.equals(plain.png), JSON.stringify(f)).toBe(true);
    }
    expect((await renderDesignDetailed({ ...base, filter: null })).png.equals(plain.png)).toBe(true);
  });

  it.each(PRESETS)('%s changes the photo but leaves text, QR, logo and mascot pixels identical, and the QR still decodes', async (preset) => {
    const base = await baseInput({ content: content({ secondary: content().secondary.slice(0, 1), qr: PAY_QR }) });
    const plain = await renderDesignDetailed(base);
    const filtered = await renderDesignDetailed({ ...base, filter: { preset, intensity: 100 } });
    expect(plain.layoutId).toMatch(/photo/);
    expect(filtered.layoutId).toBe(plain.layoutId);
    // The photo changed visibly...
    expect(changedShare(await raw(plain.png), await raw(filtered.png)), preset).toBeGreaterThan(0.06);
    // ...the code-drawn pixels did not...
    await expectCodeDrawnPixelsEqual(plain, filtered, preset);
    // ...and the payment QR decodes to exactly the ID.
    expect(filtered.report.qr).toEqual({ ok: true, decoded: PAY_QR.text });
    expect(filtered.report.contrast).toEqual([]);
    expect(filtered.report.overflow).toEqual([]);
  });

  it('leaves brand-colour panels exactly as they are (a colour panel pixel is the same with and without the filter)', async () => {
    const base = await baseInput({ format: 'portrait', themeId: 'clean', layoutId: 'clean-photo-split' });
    const plain = await renderDesignDetailed(base);
    expect(plain.layoutId).toBe('clean-photo-split');
    const filtered = await renderDesignDetailed({ ...base, filter: { preset: 'mono', intensity: 100 } });
    const a = await raw(plain.png);
    const b = await raw(filtered.png);
    expect(px(b, 12, a.h - 12)).toEqual(px(a, 12, a.h - 12));
    expect(px(b, a.w - 12, a.h - 12)).toEqual(px(a, a.w - 12, a.h - 12));
  });

  it('works on every photo layout: full-bleed, card, split, wide, strip', async () => {
    const photo = await realisticPhoto();
    for (const [format, themeId] of [['portrait', 'minimal_dark'], ['vertical', 'fresh'], ['landscape', 'clean'], ['thumbnail', 'minimal_dark'], ['banner', 'premium']] as const) {
      const base = input({ format, themeId, photo });
      const plain = await renderDesignDetailed(base);
      const f = await renderDesignDetailed({ ...base, filter: { preset: 'vintage', intensity: 100 } });
      expect(changedShare(await raw(plain.png), await raw(f.png)), `${format} ${themeId}`).toBeGreaterThan(0.05);
      expect(f.report.contrast, `${format} ${themeId}`).toEqual([]);
      if (f.report.qr) expect(f.report.qr.ok).toBe(true);
    }
  });

  it('intensity scales the effect', async () => {
    const base = await baseInput({ content: content({ qr: LINK_QR }) });
    const plain = await raw((await renderDesignDetailed(base)).png);
    const low = await raw((await renderDesignDetailed({ ...base, filter: { preset: 'vivid', intensity: 25 } })).png);
    const high = await raw((await renderDesignDetailed({ ...base, filter: { preset: 'vivid', intensity: 100 } })).png);
    const dist = (a: { data: Buffer }, b: { data: Buffer }) => {
      let s = 0;
      for (let i = 0; i < a.data.length; i += 7) s += Math.abs(a.data[i] - b.data[i]);
      return s;
    };
    expect(dist(plain, low)).toBeGreaterThan(0);
    expect(dist(plain, high)).toBeGreaterThan(dist(plain, low));
  });

  it('also filters the abstract (Imagen) background of a design without a photo, and nothing drawn on it', async () => {
    const bg = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb36b"/><stop offset="1" stop-color="#3b2a7a"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/></svg>`)).jpeg().toBuffer();
    const base = input({ format: 'square', themeId: 'fresh', background: bg });
    const plain = await renderDesignDetailed(base);
    const f = await renderDesignDetailed({ ...base, filter: { preset: 'mono', intensity: 100 } });
    expect(plain.svg).toContain('image/jpeg');
    expect(changedShare(await raw(plain.png), await raw(f.png))).toBeGreaterThan(0.02);
    expect(f.report.qr).toEqual({ ok: true, decoded: LINK_QR.text });
    const a = await raw(plain.png);
    const b = await raw(f.png);
    const q = plain.qrBox!;
    for (let y = Math.floor(q.y); y < q.y + q.h; y += 5) for (let x = Math.floor(q.x); x < q.x + q.w; x += 5) expect(px(b, x, y)).toEqual(px(a, x, y));
  });

  it('is deterministic: the same filter gives the same bytes', async () => {
    const base = await baseInput({ filter: { preset: 'soft', intensity: 70 } });
    const a = await renderDesignDetailed(base);
    const b = await renderDesignDetailed(base);
    expect(a.png.equals(b.png)).toBe(true);
  });
});
