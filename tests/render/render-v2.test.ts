// V-11: three formats, Story safe zones, Arabic and right-to-left layout, renderPostFormats.
import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { SAMPLE_MASCOT_SVG, samplePhoto, solidLogo } from '@/lib/render/fixtures';
import {
  FORMATS,
  FORMAT_SIZE,
  STORY_SAFE,
  defaultTemplate,
  detectDirection,
  initShaping,
  listTemplates,
  renderPost,
  renderPostDetailed,
  renderPostFormats,
  templateInfo,
  type Format,
  type PostText,
  type RenderInput,
} from '@/lib/render';
import { shapeText } from '@/lib/render/shape';

const dv: { id: string; text: string }[] = JSON.parse(readFileSync('test-data/devanagari-render.json', 'utf8'));
const ar: { id: string; text: string }[] = JSON.parse(readFileSync('tests/render/arabic-strings.json', 'utf8'));
const dvText = (id: string) => dv.find((d) => d.id === id)!.text;
const arText = (id: string) => ar.find((d) => d.id === id)!.text;

const PRIMARY = '#c2185b';
const LOGO_COLOUR = '#00b050';
const brand = { name: 'Sunrise Bakery', colors: { primary: PRIMARY, secondary: '#f6e7c8', accent: '#f2b100' } };

const LONG: Record<'english' | 'hindi' | 'arabic', PostText> = {
  english: {
    headline: 'Our bakery makes fresh sourdough, croissants and cakes every single morning for you',
    subline: 'Open daily from nine in the morning until ten at night, including all public holidays',
    cta: 'Message us on WhatsApp to order your favourite bread today',
    bubble: 'Come and taste something new this week!',
  },
  hindi: { headline: dvText('dv-38'), subline: dvText('dv-39'), cta: dvText('dv-40'), bubble: dvText('dv-38') },
  arabic: {
    headline: arText('ar-13'),
    subline: arText('ar-13'),
    cta: arText('ar-07') + ' ' + arText('ar-12'),
    bubble: arText('ar-13'),
  },
};
const SHORT: Record<'english' | 'hindi' | 'arabic', PostText> = {
  english: { headline: 'Fresh coffee every morning', subline: 'Open daily 9am to 10pm', cta: 'Order on WhatsApp', bubble: 'Come and taste!' },
  hindi: { headline: 'दीवाली स्पेशल मिठाई', subline: 'काजू कतली ₹880 किलो', cta: 'ऑर्डर के लिए WhatsApp करें', bubble: 'आइए, स्वाद चखिए!' },
  arabic: { headline: 'قهوة محمصة طازجة كل صباح', subline: 'من 9 صباحاً حتى 10 مساءً', cta: 'اطلب عبر واتساب', bubble: 'تفضلوا بزيارتنا!' },
};
const LANGS = ['english', 'hindi', 'arabic'] as const;

const allTemplates = FORMATS.flatMap((f) => listTemplates(f).map((t) => ({ ...t, format: f })));

let photo: Buffer;
let bigPhoto: Buffer;
let logo: Buffer;

beforeAll(async () => {
  await initShaping();
  photo = await samplePhoto();
  bigPhoto = await samplePhoto(4000, 3000);
  logo = await solidLogo(LOGO_COLOUR, 200);
}, 60_000);

function input(t: { id: string; format: Format }, over: Partial<RenderInput> = {}): RenderInput {
  return { format: t.format, templateId: t.id, brand: { ...brand, logo }, photo, text: SHORT.english, ...over };
}

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, at: (x: number, y: number): [number, number, number] => [data[3 * (y * info.width + x)], data[3 * (y * info.width + x) + 1], data[3 * (y * info.width + x) + 2]] };
}
const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

describe('formats and templates (Req 9, 10)', () => {
  it('has the three formats with the agreed sizes', () => {
    expect(FORMAT_SIZE).toEqual({
      square: { w: 1080, h: 1080 },
      vertical: { w: 1080, h: 1920 },
      landscape: { w: 1200, h: 630 },
    });
  });

  it('has at least 3 templates per format (9 or more), each format with a photo and a text-only template', () => {
    expect(allTemplates.length).toBeGreaterThanOrEqual(9);
    for (const f of FORMATS) {
      const list = listTemplates(f);
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list.some((t) => t.needsPhoto)).toBe(true);
      expect(list.some((t) => !t.needsPhoto)).toBe(true);
    }
  });

  it.each(allTemplates)('$id renders at the exact size (with and without a photo, all three languages)', async (t) => {
    const { w, h } = FORMAT_SIZE[t.format];
    for (const lang of LANGS) {
      for (const p of [photo, undefined]) {
        const meta = await sharp(await renderPost(input(t, { photo: p, text: SHORT[lang] }))).metadata();
        expect([meta.format, meta.width, meta.height], `${t.id} ${lang}`).toEqual(['png', w, h]);
      }
    }
  });

  it.each(allTemplates)('$id shows the brand colour at its probe and the logo in its slot, left-to-right and right-to-left', async (t) => {
    const info = templateInfo(t.id)!;
    for (const lang of ['english', 'arabic'] as const) {
      const px = await pixels(await renderPost(input(t, { text: SHORT[lang] })));
      expect(px.at(info.probe.x, info.probe.y), `${t.id} probe ${lang}`).toEqual(hex(PRIMARY));
      const cx = Math.round(info.logoSlot.x + info.logoSlot.w / 2);
      const cy = Math.round(info.logoSlot.y + info.logoSlot.h / 2);
      expect(px.at(cx, cy), `${t.id} logo ${lang}`).toEqual(hex(LOGO_COLOUR));
    }
  });

  it.each(allTemplates)('$id draws no <text>, and no <image> except the photo and the logo', async (t) => {
    const withBoth = await renderPostDetailed(input(t, { text: SHORT.arabic, mascot: { svg: SAMPLE_MASCOT_SVG } }));
    const photoDrawn = !withBoth.fellBack && t.needsPhoto;
    const images = withBoth.svg.match(/<image\b[^>]*>/g) ?? [];
    expect(images.length).toBe((photoDrawn ? 1 : 0) + 1);
    const hrefs = images.map((i) => /xlink:href="data:image\/(jpeg|png);base64,/.exec(i)?.[1]);
    expect(hrefs.every(Boolean)).toBe(true);
    expect(hrefs.filter((h) => h === 'jpeg').length).toBe(photoDrawn ? 1 : 0); // the owner photo
    expect(hrefs.filter((h) => h === 'png').length).toBe(1); // the logo
    for (const bad of ['<text', '<tspan', '<foreignObject', '<use', '<style', 'http://', 'https://']) {
      // the only URL is the SVG namespace
      const svg = bad.startsWith('http') ? withBoth.svg.replace(/xmlns(:xlink)?="[^"]+"/g, '') : withBoth.svg;
      expect(svg.includes(bad), `${t.id} contains ${bad}`).toBe(false);
    }
    // No photo and no logo: no image elements at all (code-drawn backgrounds only).
    const bare = await renderPostDetailed(input(t, { photo: undefined, brand: { ...brand, logo: undefined } }));
    expect(bare.svg).not.toContain('<image');
  });

  it('keeps the v1 name tall working as an alias of vertical', async () => {
    expect(listTemplates('tall')).toEqual(listTemplates('vertical'));
    const png = await renderPost({ ...input({ id: 'tl-text', format: 'vertical' }), format: 'tall' });
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
    const r = await renderPostDetailed({ ...input({ id: 'tl-photo-top', format: 'vertical' }), format: 'tall' });
    expect(r.templateId).toBe('tl-photo-top');
    expect(templateInfo('tl-photo-top')!.format).toBe('vertical');
    await expect(renderPost({ ...input({ id: 'sq-text', format: 'square' }), format: 'tall' })).rejects.toThrow(/not tall/);
    await expect(renderPost({ ...input({ id: 'tl-text', format: 'vertical' }), format: 'square' })).rejects.toThrow(/not square/);
  });
});

describe('text stays in its boxes (long English, Hindi, Arabic)', () => {
  type B = { x: number; y: number; w: number; h: number };
  const union = (ls: B[]): B => {
    const x0 = Math.min(...ls.map((l) => l.x));
    const y0 = Math.min(...ls.map((l) => l.y));
    const x1 = Math.max(...ls.map((l) => l.x + l.w));
    const y1 = Math.max(...ls.map((l) => l.y + l.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const hit = (a: B, b: B) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const e = 0.01;

  for (const lang of LANGS) {
    for (const withMascot of [true, false]) {
      it.each(allTemplates)(`$id: ${lang}${withMascot ? ' with mascot' : ''}`, async (t) => {
        const r = await renderPostDetailed(input(t, { text: LONG[lang], mascot: withMascot ? { svg: SAMPLE_MASCOT_SVG } : null }));
        const { w, h } = FORMAT_SIZE[t.format];
        const blocks = r.placements.filter((p) => ['headline', 'subline', 'cta'].includes(p.name));
        expect(blocks.length).toBe(3);
        for (const p of r.placements) {
          expect(p.box.x).toBeGreaterThanOrEqual(0);
          expect(p.box.y).toBeGreaterThanOrEqual(0);
          expect(p.box.x + p.box.w).toBeLessThanOrEqual(w);
          expect(p.box.y + p.box.h).toBeLessThanOrEqual(h);
          for (const l of p.lines) {
            expect(l.x, `${p.name} left`).toBeGreaterThanOrEqual(p.box.x - e);
            expect(l.y, `${p.name} top`).toBeGreaterThanOrEqual(p.box.y - e);
            expect(l.x + l.w, `${p.name} right`).toBeLessThanOrEqual(p.box.x + p.box.w + e);
            expect(l.y + l.h, `${p.name} bottom`).toBeLessThanOrEqual(p.box.y + p.box.h + e);
          }
        }
        for (const p of blocks) {
          const u = union(p.lines);
          expect(u.x).toBeGreaterThanOrEqual(p.region!.x - e);
          expect(u.y).toBeGreaterThanOrEqual(p.region!.y - e);
          expect(u.x + u.w).toBeLessThanOrEqual(p.region!.x + p.region!.w + e);
          expect(u.y + u.h).toBeLessThanOrEqual(p.region!.y + p.region!.h + e);
        }
        const others = r.placements.filter((p) => ['bubble', 'mascot', 'logo'].includes(p.name));
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) expect(hit(union(blocks[i].lines), union(blocks[j].lines)), `${blocks[i].name} vs ${blocks[j].name}`).toBe(false);
          for (const o of others) expect(hit(union(blocks[i].lines), o.box), `${blocks[i].name} vs ${o.name}`).toBe(false);
        }
        // Text is actually drawn (not an empty box).
        for (const p of blocks) expect(p.lines.length).toBeGreaterThan(0);
      });
    }
  }

  it('landscape has no mascot or bubble, even when one is given', async () => {
    for (const t of listTemplates('landscape')) {
      const r = await renderPostDetailed(input({ id: t.id, format: 'landscape' }, { mascot: { svg: SAMPLE_MASCOT_SVG }, text: SHORT.hindi }));
      expect(r.placements.some((p) => p.name === 'mascot' || p.name === 'bubble')).toBe(false);
      expect(r.svg).not.toContain('mascot-clip');
    }
  });
});

describe('vertical Story safe zones', () => {
  const vertical = allTemplates.filter((t) => t.format === 'vertical');
  const top = STORY_SAFE.top;
  const bottom = 1920 - STORY_SAFE.bottom;

  it('uses 250 px at the top and 340 px at the bottom', () => {
    expect(top).toBe(250);
    expect(bottom).toBe(1580);
  });

  for (const lang of LANGS) {
    for (const long of [false, true]) {
      for (const withMascot of [true, false]) {
        for (const withLogo of [true, false]) {
          it.each(vertical)(`$id: ${lang}, ${long ? 'long' : 'short'}, ${withMascot ? 'mascot' : 'no mascot'}, ${withLogo ? 'logo' : 'name chip'}: text and logo inside the safe area`, async (t) => {
            const text = (long ? LONG : SHORT)[lang];
            const r = await renderPostDetailed(
              input(t, { text, mascot: withMascot ? { svg: SAMPLE_MASCOT_SVG } : null, brand: { ...brand, logo: withLogo ? logo : undefined } }),
            );
            const checked = r.placements.filter((p) => ['headline', 'subline', 'cta', 'bubble', 'logo', 'brand-name'].includes(p.name));
            expect(checked.some((p) => p.name === 'headline')).toBe(true);
            expect(checked.some((p) => p.name === (withLogo ? 'logo' : 'brand-name'))).toBe(true);
            for (const p of checked) {
              const boxes = [p.box, ...(p.region ? [p.region] : []), ...p.lines];
              for (const b of boxes) {
                expect(b.y, `${p.name} top`).toBeGreaterThanOrEqual(top - 0.01);
                expect(b.y + b.h, `${p.name} bottom`).toBeLessThanOrEqual(bottom + 0.01);
              }
            }
          });
        }
      }
    }
  }
});

describe('no-photo fallback in all formats', () => {
  it.each(allTemplates.filter((t) => t.needsPhoto))('$id without a photo falls back to a text-only template of the same format', async (t) => {
    const r = await renderPostDetailed(input(t, { photo: undefined }));
    expect(r.fellBack).toBe(true);
    const used = templateInfo(r.templateId)!;
    expect(used.needsPhoto).toBe(false);
    expect(used.format).toBe(t.format);
    expect([r.width, r.height]).toEqual([FORMAT_SIZE[t.format].w, FORMAT_SIZE[t.format].h]);
    expect(r.svg).not.toContain('image/jpeg');
  });

  it('renderPostFormats picks text-only templates when there is no photo, or the photo is unreadable', async () => {
    for (const p of [undefined, Buffer.alloc(0), Buffer.from('not an image')]) {
      const r = await renderPostFormats({ brand: { ...brand, logo }, photo: p, text: SHORT.english });
      for (const f of FORMATS) {
        expect(templateInfo(r.used[f])!.needsPhoto, `${f} with ${p ? p.length : 'no'} bytes`).toBe(false);
        expect(templateInfo(r.used[f])!.format).toBe(f);
        const meta = await sharp(r[f]).metadata();
        expect([meta.width, meta.height]).toEqual([FORMAT_SIZE[f].w, FORMAT_SIZE[f].h]);
      }
    }
  });
});

describe('right-to-left layout', () => {
  // Rightmost and leftmost ink of the headline lines, found by pixels. `bgAt` is a plain background pixel beside the text.
  async function inkExtent(templateId: string, format: Format, text: PostText) {
    const r = await renderPostDetailed(input({ id: templateId, format }, { text, photo: undefined, mascot: null }));
    const head = r.placements.find((p) => p.name === 'headline')!;
    const region = head.region!;
    const px = await pixels(r.png);
    const bg = px.at(Math.round(region.x) - 5, Math.round(region.y));
    const y0 = Math.floor(Math.min(...head.lines.map((l) => l.y)));
    const y1 = Math.ceil(Math.max(...head.lines.map((l) => l.y + l.h)));
    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = y0; y < y1; y++) {
      for (let x = Math.floor(region.x); x < Math.ceil(region.x + region.w); x++) {
        const p = px.at(x, y);
        if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 150) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    return { region, minX, maxX, dir: r.dir, lines: head.lines };
  }

  const left = [
    ['sq-text-card', 'square'],
    ['tl-text-card', 'vertical'],
    ['ls-text', 'landscape'],
    ['ls-text-card', 'landscape'],
  ] as const;

  it.each(left)('%s: Arabic ends at the right edge of the text box, English starts at the left edge', async (id, format) => {
    const arabic = await inkExtent(id, format, { headline: 'قهوة طازجة', subline: '', cta: '', bubble: '' });
    expect(arabic.dir).toBe('rtl');
    expect(arabic.region.x + arabic.region.w - arabic.maxX).toBeLessThanOrEqual(30);
    expect(arabic.region.x + arabic.region.w - arabic.maxX).toBeGreaterThanOrEqual(0);
    expect(arabic.minX - arabic.region.x).toBeGreaterThan(60); // not left-aligned too
    for (const l of arabic.lines) expect(Math.abs(l.x + l.w - (arabic.region.x + arabic.region.w))).toBeLessThan(0.01);

    const english = await inkExtent(id, format, { headline: 'Fresh coffee', subline: '', cta: '', bubble: '' });
    expect(english.dir).toBe('ltr');
    expect(english.minX - english.region.x).toBeLessThanOrEqual(30);
    expect(english.minX - english.region.x).toBeGreaterThanOrEqual(0);
    expect(english.region.x + english.region.w - english.maxX).toBeGreaterThan(60);
  });

  it('right-aligns a left-aligned CTA pill and keeps centred text centred', async () => {
    const ar = await renderPostDetailed(input({ id: 'sq-text-card', format: 'square' }, { text: SHORT.arabic, photo: undefined }));
    const cta = ar.placements.find((p) => p.name === 'cta')!;
    const pillRight = Math.max(...cta.lines.map((l) => l.x + l.w));
    expect(cta.region!.x + cta.region!.w - pillRight).toBeLessThan(60); // pill padding only
    const en = await renderPostDetailed(input({ id: 'sq-text-card', format: 'square' }, { text: SHORT.english, photo: undefined }));
    const ctaEn = en.placements.find((p) => p.name === 'cta')!;
    expect(Math.min(...ctaEn.lines.map((l) => l.x)) - ctaEn.region!.x).toBeLessThan(60);

    const centred = await renderPostDetailed(input({ id: 'sq-text', format: 'square' }, { text: SHORT.arabic, photo: undefined }));
    const head = centred.placements.find((p) => p.name === 'headline')!;
    for (const l of head.lines) expect(Math.abs(l.x + l.w / 2 - (head.region!.x + head.region!.w / 2))).toBeLessThan(0.01);
  });

  it('mirrors the landscape photo-left layout: photo on the right for Arabic', async () => {
    const en = await renderPostDetailed(input({ id: 'ls-photo-split', format: 'landscape' }, { text: SHORT.english }));
    const ar = await renderPostDetailed(input({ id: 'ls-photo-split', format: 'landscape' }, { text: SHORT.arabic }));
    const enPx = await pixels(en.png);
    const arPx = await pixels(ar.png);
    const isPrimary = (p: number[]) => p[0] === hex(PRIMARY)[0] && p[1] === hex(PRIMARY)[1] && p[2] === hex(PRIMARY)[2];
    expect(isPrimary(enPx.at(1100, 600))).toBe(true); // text panel on the right
    expect(isPrimary(enPx.at(300, 600))).toBe(false); // photo on the left
    expect(isPrimary(arPx.at(100, 600))).toBe(true); // text panel on the left
    expect(isPrimary(arPx.at(900, 600))).toBe(false); // photo on the right
    const headEn = en.placements.find((p) => p.name === 'headline')!;
    const headAr = ar.placements.find((p) => p.name === 'headline')!;
    expect(headEn.region!.x).toBeGreaterThan(560);
    expect(headAr.region!.x + headAr.region!.w).toBeLessThan(640);
  });

  it('detects the paragraph direction', () => {
    expect(detectDirection('قهوة محمصة')).toBe('rtl');
    expect(detectDirection('Fresh coffee')).toBe('ltr');
    expect(detectDirection('दीवाली स्पेशल')).toBe('ltr');
    expect(detectDirection('السعر AED 150 فقط')).toBe('rtl');
    expect(detectDirection('iPhone 15 Pro and a long English sentence متوفر')).toBe('ltr');
    expect(detectDirection('150 + 20%')).toBe('ltr');
    expect(detectDirection('')).toBe('ltr');
  });
});

describe('Arabic shaping and the minimal bidi pass', () => {
  it('has 18 test strings including digits, AED 150, a Latin brand name and a long line', () => {
    expect(ar).toHaveLength(18);
    expect(ar.some((s) => s.text.includes('AED 150'))).toBe(true);
    expect(ar.some((s) => /Sunrise Bakery/.test(s.text))).toBe(true);
    expect(ar.some((s) => /[0-9]/.test(s.text))).toBe(true);
    expect(ar.some((s) => /[٠-٩]/.test(s.text))).toBe(true);
    expect(Math.max(...ar.map((s) => s.text.length))).toBeGreaterThan(100);
  });

  it('shapes every Arabic test string without a missing glyph, in every weight', () => {
    for (const w of [400, 500, 700, 800] as const) {
      for (const s of ar) {
        const shaped = shapeText(s.text, w);
        expect(shaped.missing, `${s.id} @${w}`).toBe(0);
        expect(shaped.glyphs.length, s.id).toBeGreaterThan(0);
      }
    }
  });

  it('joins Arabic letters (a joined word is narrower than the same letters shaped apart)', () => {
    const joined = shapeText('بببب', 400, 'rtl').widthEm;
    const apart = 4 * shapeText('ب', 400, 'rtl').widthEm;
    expect(joined).toBeLessThan(apart);
  });

  it('puts the first logical run at the right of an RTL paragraph and keeps Latin and digits left-to-right', () => {
    const x = shapeText('x', 400, 'ltr').glyphs[0].d;
    const rtl = shapeText('x ب', 400, 'rtl');
    const ltr = shapeText('x ب', 400, 'ltr');
    expect(rtl.glyphs[rtl.glyphs.length - 1].d).toBe(x); // x is the rightmost
    expect(ltr.glyphs[0].d).toBe(x); // x is the leftmost
    // "AED 150" stays one left-to-right run in the order typed.
    const run = shapeText('AED 150', 400, 'ltr').glyphs.map((g) => g.d);
    const inRtl = shapeText('AED 150 ب', 400, 'rtl').glyphs.map((g) => g.d);
    expect(inRtl.slice(-run.length)).toEqual(run);
    // Digits keep their order inside a right-to-left run.
    const digits = shapeText('150', 400, 'ltr').glyphs.map((g) => g.d);
    expect(shapeText('150', 400, 'rtl').glyphs.map((g) => g.d)).toEqual(digits);
  });

  it('reports width independent of nothing but the text (same width in both directions for a single script)', () => {
    for (const s of ar.slice(0, 6)) {
      expect(shapeText(s.text, 700, 'rtl').widthEm).toBeCloseTo(shapeText(s.text, 700, 'auto').widthEm, 6);
    }
  });

  it('still selects Devanagari and Latin fonts per run in mixed text', () => {
    expect(shapeText('₹120 में ताज़ा लस्सी iPhone', 700).missing).toBe(0);
    expect(shapeText('Hello دنيا नमस्ते ₹5', 700).missing).toBe(0);
  });
});

describe('renderPostFormats (v2 API)', () => {
  it('returns all three formats at the right size, with the templates used', async () => {
    const r = await renderPostFormats({ brand: { ...brand, logo }, photo, text: SHORT.english });
    for (const f of FORMATS) {
      const meta = await sharp(r[f]).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', FORMAT_SIZE[f].w, FORMAT_SIZE[f].h]);
      expect(templateInfo(r.used[f])!.format).toBe(f);
      expect(templateInfo(r.used[f])!.needsPhoto).toBe(true);
    }
    expect(Object.keys(r).sort()).toEqual(['landscape', 'square', 'used', 'vertical']);
  });

  it('rotates templates by seed, so a week of posts does not all look the same', async () => {
    for (const hasPhoto of [true, false]) {
      for (const f of FORMATS) {
        const seen = new Set([0, 1, 2, 3, 4, 5].map((s) => defaultTemplate(f, hasPhoto, s)));
        expect(seen.size, `${f} photo=${hasPhoto}`).toBeGreaterThanOrEqual(2);
        for (const id of seen) expect(templateInfo(id)!.needsPhoto).toBe(hasPhoto);
      }
    }
    const a = await renderPostFormats({ brand: { ...brand, logo }, photo, text: SHORT.english, seed: 0 });
    const b = await renderPostFormats({ brand: { ...brand, logo }, photo, text: SHORT.english, seed: 1 });
    for (const f of FORMATS) expect(a.used[f]).not.toBe(b.used[f]);
    expect(defaultTemplate('square', true, -1)).toBeTruthy(); // negative seeds are safe
    const again = await renderPostFormats({ brand: { ...brand, logo }, photo, text: SHORT.english, seed: 0 });
    expect(again.used).toEqual(a.used); // deterministic
  });

  it('honours explicit templates, per format', async () => {
    const r = await renderPostFormats({
      brand: { ...brand, logo },
      photo,
      text: SHORT.hindi,
      templates: { square: 'sq-text', landscape: 'ls-photo-full' },
    });
    expect(r.used.square).toBe('sq-text');
    expect(r.used.landscape).toBe('ls-photo-full');
    expect(templateInfo(r.used.vertical)!.format).toBe('vertical');
  });

  it('draws the mascot in square and vertical, and skips it in landscape', async () => {
    const r = await renderPostFormats({ brand: { ...brand, logo }, photo: undefined, text: SHORT.english, mascot: { svg: SAMPLE_MASCOT_SVG }, templates: { square: 'sq-text', vertical: 'tl-text', landscape: 'ls-text' } });
    const sq = await pixels(r.square);
    const vt = await pixels(r.vertical);
    const ls = await pixels(r.landscape);
    expect(sq.at(860, 830)).toEqual(hex('#ffc93c')); // placeholder mascot face, sq-text slot
    expect(vt.at(540, 1455)).toEqual(hex('#ffc93c')); // tl-text slot
    // Landscape: no pixel of the mascot colour anywhere.
    let found = 0;
    for (let i = 0; i < ls.data.length; i += 3) if (ls.data[i] === 255 && ls.data[i + 1] === 201 && ls.data[i + 2] === 60) found++;
    expect(found).toBe(0);
  });

  // Product promise: under 1.5 s on an idle machine. Under full-suite load the median is the gate and
  // a single run has a hard ceiling (H-4). Two warm-ups, then the median of 5 runs.
  it('renders all three formats for one post in under 1.5 s after warm-up (4000x3000 photo, Arabic, mascot)', async () => {
    const run = () =>
      renderPostFormats({ brand: { ...brand, logo }, photo: bigPhoto, text: LONG.arabic, mascot: { svg: SAMPLE_MASCOT_SVG }, seed: 3 });
    await run(); // warm-up 1
    await run(); // warm-up 2
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await run();
      times.push(performance.now() - t0);
    }
    const median = [...times].sort((a, b) => a - b)[2];
    const log = `timings ${times.map((t) => t.toFixed(0)).join(', ')} ms; median ${median.toFixed(0)} ms`;
    console.log(`[render-v2] renderPostFormats (3 formats, 4000x3000 photo, Arabic, mascot): ${log}`);
    expect(median, `median of 5 runs; ${log}`).toBeLessThan(1500);
    expect(Math.max(...times), `hard ceiling per run; ${log}`).toBeLessThan(3000);
  }, 60_000);
});

describe('Arabic display order, checked by glyph positions', () => {
  const paths = (text: string, dir: 'ltr' | 'rtl') => shapeText(text, 400, dir).glyphs.map((g) => g.d);
  let bLen = 0;
  beforeAll(() => {
    bLen = shapeText('ب', 400, 'ltr').glyphs.length;
  });
  /** Index of the first place where `sub` appears as a contiguous run of `list`, or -1. */
  const find = (list: string[], sub: string[]) => {
    for (let i = 0; i + sub.length <= list.length; i++) if (sub.every((d, k) => list[i + k] === d)) return i;
    return -1;
  };
  /**
   * `X` after an Arabic word in an rtl paragraph must show exactly as it does in a left-to-right
   * paragraph: the same glyphs in the same order, here at the left end (the Arabic word is logically
   * first, so it is rightmost). A space-separated, typed-order run.
   */
  function expectTypedOrder(x: string) {
    const ltr = paths('ب ' + x, 'ltr').slice(bLen); // reference: the run as typed
    const rtl = paths('ب ' + x, 'rtl');
    expect(ltr.length, x).toBeGreaterThan(0);
    expect(rtl.slice(0, ltr.length), `"${x}" in an rtl paragraph`).toEqual(ltr);
    // And inside a longer sentence, with Arabic on both sides.
    const inSentence = paths('خصم ' + x + ' على', 'rtl');
    expect(find(inSentence, ltr), `"${x}" inside a sentence`).toBeGreaterThanOrEqual(0);
  }

  it('mirrors brackets exactly once: opening bracket on the right of the word, closing on its left', () => {
    const open = paths('(', 'ltr')[0]; // the "(" glyph
    const close = paths(')', 'ltr')[0]; // the ")" glyph
    expect(open).not.toBe(close);
    const g = shapeText('(ب)', 400, 'rtl').glyphs;
    // Visual left to right: "(" shape, the letter, ")" shape. The logical opening bracket is rightmost and drawn as ")".
    expect(g[0].d).toBe(open);
    expect(g[g.length - 1].d).toBe(close);
    expect(g[0].x).toBeLessThan(g[g.length - 1].x);
    // ar-11 and ar-16: the last glyph is the mirrored opening bracket; the "(" shape sits left of the word.
    for (const id of ['ar-11', 'ar-16']) {
      const glyphs = shapeText(ar.find((s) => s.id === id)!.text, 400, 'rtl').glyphs;
      const openAt = glyphs.findIndex((x) => x.d === open);
      const closeAt = glyphs.findIndex((x) => x.d === close);
      expect(openAt, id).toBeGreaterThanOrEqual(0);
      expect(closeAt, id).toBeGreaterThanOrEqual(0);
      expect(glyphs[openAt].x, `${id}: "(" shape left of ")" shape`).toBeLessThan(glyphs[closeAt].x);
      expect(glyphs.filter((x) => x.d === open || x.d === close).length, `${id}: two brackets, not four`).toBe(2);
    }
    // ar-11 starts with the opening bracket, so the right end of the line is a ")" shape.
    const ar11 = shapeText(ar.find((s) => s.id === 'ar-11')!.text, 400, 'rtl').glyphs;
    expect(ar11[ar11.length - 1].d).toBe(close);
    // Brackets in a left-to-right run inside rtl text are not flipped.
    const latin = shapeText('ب (AED)', 400, 'rtl').glyphs.map((x) => x.d);
    expect(latin.indexOf(open)).toBeLessThan(latin.indexOf(close));
  });

  it('keeps a percent sign, plus, minus and currency signs inside the number, in typed order (W5)', () => {
    for (const x of ['20%', '+5', '-7', '$50', '€20', '₹1', '£3.50', '50٪', '+20%']) expectTypedOrder(x);
    // ar-02: the % is to the right of the 0, and both are right of the Arabic words that follow.
    const pct = paths('ب %', 'ltr').slice(bLen)[0];
    const g = shapeText(ar.find((s) => s.id === 'ar-02')!.text, 400, 'rtl').glyphs;
    const at = g.findIndex((x) => x.d === pct);
    expect(at).toBeGreaterThan(0);
    expect(g[at].x).toBeGreaterThan(g[at - 1].x); // "%" is right of "0"
    expect(g[at - 1].d).toBe(paths('ب 0', 'ltr').slice(bLen)[0]);
  });

  it('keeps decimal and thousands separators inside the number', () => {
    for (const x of ['1,250', '1,250.75', '3.14', '€1.299,50', '١٢٣٫٥٠', '١٬٢٥٠']) expectTypedOrder(x);
  });

  it('shows phone numbers, times and dates as typed (one left-to-right run)', () => {
    for (const x of ['+971 4 123 4567', '+44 20 7946 0123', '(020) 7946 0123', '020-7946-0123', '020.7946.0123', '+1 (415) 555-0132']) expectTypedOrder(x);
    for (const x of ['9:30', '09:30:15', '15/12', '15/12/2026', '2026-12-15', '15.12.2026']) expectTypedOrder(x);
    // ar-14, ar-17, ar-18 as whole strings.
    for (const [id, x] of [['ar-14', '+971 4 123 4567'], ['ar-17', '+44 20 7946 0123'], ['ar-18', '9:30']] as const) {
      const g = shapeText(ar.find((s) => s.id === id)!.text, 400, 'rtl').glyphs.map((v) => v.d);
      const ref = paths('ب ' + x, 'ltr').slice(bLen);
      expect(find(g, ref), id).toBeGreaterThanOrEqual(0);
    }
  });

  it('puts a phone number at the left end of an rtl line and the Arabic words to its right', () => {
    const g = shapeText('اتصل بنا على +44 20 7946 0123', 400, 'rtl').glyphs;
    const ref = paths('ب +44 20 7946 0123', 'ltr').slice(bLen);
    // The number is logically last, so it is the leftmost block on the line.
    expect(find(g.map((v) => v.d), ref)).toBe(0);
  });

  it('short digit groups are not forced into one run, but plain numbers still read left to right', () => {
    // 6 digits only: not a phone number. A single number is still ltr.
    expectTypedOrder('123456');
    expectTypedOrder('١٠');
  });

  it('keeps Arabic-Indic digits (ar-08) in order and in the Arabic font', () => {
    const g = shapeText(ar.find((s) => s.id === 'ar-08')!.text, 400, 'rtl');
    expect(g.missing).toBe(0);
    const ref = paths('ب ١٠', 'ltr').slice(bLen);
    expect(find(g.glyphs.map((v) => v.d), ref)).toBeGreaterThanOrEqual(0);
    expect(find(g.glyphs.map((v) => v.d), paths('ب ١٥', 'ltr').slice(bLen))).toBeGreaterThanOrEqual(0);
  });
});
