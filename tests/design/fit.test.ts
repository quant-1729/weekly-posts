// Auto-fit order and dropped/overflow reporting; carousel; options; listLayouts.
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  FORMAT_USP_CAPACITY,
  designOptions,
  listLayouts,
  needsCarousel,
  renderCarousel,
  renderDesign,
  renderDesignDetailed,
  splitIntoSlides,
  textLogoPng,
  textLogoSvg,
  THEME_IDS,
} from '@/lib/design';
import { ALL_FORMATS, isRuleDrop, PALETTES, content, input, kit } from './fixtures';
import { expectClean } from './helpers';

describe('auto-fit and reports', () => {
  it('shrinks and wraps before dropping anything: a normal brief drops nothing', async () => {
    for (const format of ALL_FORMATS) {
      const r = await renderDesign(input({ format, themeId: 'clean', content: content({ secondary: content().secondary.slice(0, FORMAT_USP_CAPACITY[format].secondary) }) }));
      expect(r.report.dropped.filter((d) => !isRuleDrop(d) && !(format === 'thumbnail' && d.includes('(no room)'))), format).toEqual([]);
      expect(r.report.overflow, format).toEqual([]);
    }
  });

  it('reports a secondary USP over the format capacity as dropped, never silently', async () => {
    const c = content({ secondary: [...content().secondary, { kind: 'custom', text: 'Third line that cannot fit' }] });
    const r = await renderDesign(input({ format: 'square', themeId: 'clean', content: c }));
    expect(r.report.dropped.some((d) => d.includes('Third line that cannot fit'))).toBe(true);
    const b = await renderDesign(input({ format: 'banner', themeId: 'clean', content: content() }));
    expect(b.report.dropped.some((d) => d.includes('Made with pure ghee'))).toBe(true);
  });

  it('reports contact lines that have no room (a third line in a small format)', async () => {
    const blocks = [
      { kind: 'phone' as const, text: '+91 98200 12345' },
      { kind: 'address' as const, text: '12 MG Road, Shop 4, Near the old clock tower, Pune 411001' },
      { kind: 'hours' as const, text: 'Mon-Sat 10:00-20:00' },
      { kind: 'email' as const, text: 'hello@sunrise-sweets.example' },
      { kind: 'website' as const, text: 'www.sunrise-sweets.example' },
      { kind: 'instagram' as const, text: '@sunrisesweets' },
    ];
    const r = await renderDesign(input({ format: 'landscape', themeId: 'bold_sale', content: content({ blocks }) }));
    const dropped = r.report.dropped.filter((d) => d.startsWith('contact'));
    expect(blocks.length - dropped.length).toBe(2); // FORMAT_RULES: at most 2 contact lines on landscape
    expect(dropped.every((d) => d.startsWith('contact: not shown on landscape images'))).toBe(true);
    expect(r.report.overflow).toEqual([]);
  });

  it('reports overflow (and cuts nothing silently) when the headline cannot fit at all', async () => {
    const huge = 'Supercalifragilisticexpialidocious '.repeat(12);
    const r = await renderDesign(input({ format: 'thumbnail', themeId: 'clean', content: content({ headline: huge }) }));
    expect(r.report.overflow).toContain('headline');
  });

  it('switches to another layout rather than dropping content when the first is too tight', async () => {
    const c = content({ headline: 'A long headline about our seasonal sale on everything in store' });
    const r = await renderDesignDetailed(input({ format: 'square', themeId: 'clean', layoutId: 'clean-open', content: c }));
    expect(expectClean(r).problems).toEqual([]);
    expect(r.report.dropped).toEqual([]);
  });

  it('keeps the owner layout choice when it fits', async () => {
    const r = await renderDesign(input({ format: 'square', themeId: 'festive', layoutId: 'festive-card' }));
    expect(r.layoutId).toBe('festive-card');
    expect(r.themeId).toBe('festive');
  });

  it('is deterministic: the same input renders the same picture', async () => {
    const a = await renderDesign(input({ format: 'portrait', themeId: 'playful' }));
    const b = await renderDesign(input({ format: 'portrait', themeId: 'playful' }));
    expect(a.png.equals(b.png)).toBe(true);
  });
});

describe('listLayouts', () => {
  it('gives at least two text layouts and two photo layouts per theme and format', () => {
    for (const t of THEME_IDS) {
      for (const f of ALL_FORMATS) {
        expect(listLayouts(t, f, false).length, `${t} ${f} text`).toBeGreaterThanOrEqual(2);
        expect(listLayouts(t, f, true).length, `${t} ${f} photo`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('design options', () => {
  const k = kit(PALETTES.bakery, { themeId: 'premium' });
  it('is deterministic and gives three different options', () => {
    const a = designOptions({ kit: k, content: content(), format: 'square', hasPhoto: false });
    const b = designOptions({ kit: k, content: content(), format: 'square', hasPhoto: false });
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((o) => `${o.themeId}/${o.layoutId}/${o.scheme}`)).size).toBe(3);
    expect(a[2].themeId).not.toBe(k.themeId); // one from a neighbouring theme
    expect(a[0].themeId).toBe(k.themeId);
  });

  it.each(ALL_FORMATS)('renders three visibly different designs in %s (with and without a photo)', async (format) => {
    for (const hasPhoto of [false, true]) {
      const opts = designOptions({ kit: k, content: content(), format, hasPhoto });
      const photo = hasPhoto ? await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c08040' } }).jpeg().toBuffer() : null;
      const frames: Buffer[] = [];
      for (const o of opts) {
        const r = await renderDesignDetailed({ ...input({ format, themeId: o.themeId, kit: { ...k, themeId: o.themeId }, layoutId: o.layoutId, photo }), scheme: o.scheme });
        expect(expectClean(r).problems, `${format} ${JSON.stringify(o)}`).toEqual([]);
        frames.push(await sharp(r.png).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer());
      }
      for (let i = 0; i < frames.length; i++) {
        for (let j = i + 1; j < frames.length; j++) {
          let d = 0;
          for (let p = 0; p < frames[i].length; p++) d += Math.abs(frames[i][p] - frames[j][p]);
          expect(d / frames[i].length, `${format} photo=${hasPhoto} ${i} vs ${j}`).toBeGreaterThan(6);
        }
      }
    }
  }, 60_000);

  it('gives more options on request, never repeating one', () => {
    const o = designOptions({ kit: k, content: content(), format: 'vertical', hasPhoto: false, count: 6 });
    expect(o).toHaveLength(6);
    expect(new Set(o.map((x) => `${x.themeId}/${x.layoutId}/${x.scheme}`)).size).toBe(6);
  });
});

describe('carousel', () => {
  const c = content({ secondary: [...content().secondary, { kind: 'custom', text: 'Gift wrapping on request' }] });

  it('needs a carousel only over the format capacity', () => {
    expect(needsCarousel(c, 'square')).toBe(true);
    expect(needsCarousel(content(), 'square')).toBe(false);
    expect(needsCarousel(content(), 'banner')).toBe(true);
  });

  it('puts the headline and primary first, one USP per slide, then CTA, contacts and QR', () => {
    const s = splitIntoSlides(c, 'square');
    expect(s).toHaveLength(5);
    expect(s[0].headline).toBe(c.headline);
    expect(s[0].primary?.text).toBe(c.primary?.text);
    expect(s[0].secondary).toEqual([]);
    expect(s[0].qr).toBeNull();
    expect(s.slice(1, 4).map((x) => x.headline)).toEqual(c.secondary.map((x) => x.text));
    expect(s[4].headline).toBe(c.cta!.text);
    expect(s[4].blocks).toEqual(c.blocks);
    expect(s[4].qr).toEqual(c.qr);
    expect(splitIntoSlides(content({ secondary: [] }), 'square')).toHaveLength(1);
  });

  it('renders every slide with its marker, in one layout family, all clean', async () => {
    const slides = await renderCarousel(input({ format: 'square', themeId: 'bold_sale', content: c }));
    expect(slides).toHaveLength(5);
    for (const [i, r] of slides.entries()) {
      const m = r.placements.find((p) => p.name === 'marker');
      expect(m?.text, `slide ${i + 1}`).toBe(`${i + 1}/5`);
      expect(expectClean(r).problems, `slide ${i + 1}`).toEqual([]);
      expect(r.layoutId).toBe(slides[0].layoutId);
    }
    expect(slides[4].report.qr?.ok).toBe(true);
  });
});

describe('text logo', () => {
  it('is an SVG and a PNG in the kit colours and font', async () => {
    const k = kit(PALETTES.navy, { themeId: 'premium', fonts: { headline: 'serif', body: 'sans' } });
    const svg = await textLogoSvg('Sunrise Sweets', k);
    expect(svg.startsWith('<svg')).toBe(true);
    const png = await textLogoPng('Sunrise Sweets', k);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(640);
    expect(meta.hasAlpha).toBe(true);
  });
});
