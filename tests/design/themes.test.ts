// C-14, C-15: every theme x format renders cleanly (no overflow, contrast, safe zones, QR) for a
// normal brief and for the awkward cases (long text, Devanagari, Arabic, mixed scripts).
import { beforeAll, describe, expect, it } from 'vitest';
import { renderDesignDetailed, THEME_IDS, FORMAT_SIZE } from '@/lib/design';
import { samplePhoto, sampleLogo, SAMPLE_MASCOT_SVG } from '@/lib/render/fixtures';
import { FORMAT_RULES } from '@/lib/design';
import { ALL_FORMATS, isRuleDrop, LONG_USP, PAY_QR, arabicContent, content, hindiContent, input, mixedContent, PALETTES, kit } from './fixtures';
import { expectClean } from './helpers';

let photo: Buffer;
let logo: Buffer;
beforeAll(async () => {
  photo = await samplePhoto();
  logo = await sampleLogo();
});

const png = (b: Buffer) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';

describe.each(THEME_IDS)('theme %s', (themeId) => {
  it('renders every format without problems (no photo, link QR, text logo)', async () => {
    for (const format of ALL_FORMATS) {
      const r = await renderDesignDetailed(input({ format, themeId, content: content({ secondary: content().secondary.slice(0, 1) }) }));
      expect(png(r.png)).toBe(true);
      expect(r.width).toBe(FORMAT_SIZE[format].width);
      expect(r.height).toBe(FORMAT_SIZE[format].height);
      expect(expectClean(r, format).problems, `${themeId} ${format} ${r.layoutId}`).toEqual([]);
      // The densest case (landscape 1200x630 with a QR tile, 3 contacts and the full hierarchy) may drop the secondary line, and says so.
      // Landscape (dense) and thumbnails (headline-led) may drop the secondary line or subline for room, and say so.
      const unexpected = r.report.dropped.filter((d) => !isRuleDrop(d) && !((format === 'landscape' || format === 'thumbnail') && /\(no room\)/.test(d)));
      expect(unexpected, `${themeId} ${format}`).toEqual([]);
      if (FORMAT_RULES[format].qr) expect(r.report.qr?.ok).toBe(true);
      else expect(r.report.qr).toBeNull();
    }
  });

  it('renders every format with a photo, a logo and the mascot', async () => {
    for (const format of ALL_FORMATS) {
      const r = await renderDesignDetailed(
        input({ format, themeId, photo, logo, mascot: { svg: SAMPLE_MASCOT_SVG }, content: content({ secondary: content().secondary.slice(0, 1) }) }),
      );
      expect(expectClean(r, format).problems, `${themeId} ${format} ${r.layoutId}`).toEqual([]);
    }
  });

  it('handles a 60-character USP, a long business name and a payment QR', async () => {
    expect(LONG_USP.length).toBe(60);
    for (const format of ALL_FORMATS) {
      const r = await renderDesignDetailed(
        input({
          format,
          themeId,
          brandName: 'Sri Venkateswara Traditional Handloom Sarees and Silk Emporium Pvt Ltd',
          content: content({ primary: { kind: 'custom', text: LONG_USP }, qr: PAY_QR, secondary: [] }),
        }),
      );
      expect(expectClean(r, format).problems, `${themeId} ${format} ${r.layoutId}`).toEqual([]);
    }
  });

  it.each([
    ['Devanagari', hindiContent],
    ['Arabic (right to left)', arabicContent],
    ['mixed scripts', mixedContent],
  ])('handles %s', async (_n, make) => {
    for (const format of ['square', 'vertical', 'landscape', 'banner'] as const) {
      const r = await renderDesignDetailed(input({ format, themeId, content: make(), language: _n.startsWith('Arabic') ? 'ar' : 'hi' }));
      expect(expectClean(r, format).problems, `${themeId} ${format} ${r.layoutId}`).toEqual([]);
      if (_n.startsWith('Arabic')) expect(r.dir).toBe('rtl');
    }
  });
});

describe('details', () => {
  it('prints the QR label and, for payment, the payee and address under the code', async () => {
    const r = await renderDesignDetailed(input({ format: 'square', themeId: 'clean', content: content({ qr: PAY_QR }) }));
    const t = r.placements.find((p) => p.name === 'qr-label');
    expect(t?.text).toContain('Scan to pay');
    expect(t?.text).toContain('Sunrise Bakery');
    expect(t?.text).toContain('sunrise.bakery@okhdfcbank');
  });

  it('draws a text logo from the brand name when there is no logo image, and none when textLogo is off', async () => {
    const withText = await renderDesignDetailed(input({ format: 'square', themeId: 'clean' }));
    expect(withText.placements.some((p) => p.name === 'logo-text')).toBe(true);
    const off = await renderDesignDetailed(input({ format: 'square', themeId: 'clean', kit: kit(PALETTES.bakery, { themeId: 'clean', textLogo: false }) }));
    expect(off.placements.some((p) => p.name.startsWith('logo'))).toBe(false);
  });

  it('uses the owner photo in its frame and the Imagen texture behind text only when there is no photo', async () => {
    const tex = await sampleLogo(600);
    const a = await renderDesignDetailed(input({ format: 'square', themeId: 'fresh', background: tex }));
    expect(a.svg).toContain('image/jpeg');
    expect(expectClean(a).problems).toEqual([]);
    const b = await renderDesignDetailed(input({ format: 'square', themeId: 'fresh', background: tex, photo }));
    expect(b.layoutId).toMatch(/photo/);
    expect(expectClean(b).problems).toEqual([]);
  });

  it('mirrors the layout for right-to-left posts', async () => {
    const ltr = await renderDesignDetailed(input({ format: 'landscape', themeId: 'clean', dir: 'ltr' }));
    const rtl = await renderDesignDetailed(input({ format: 'landscape', themeId: 'clean', dir: 'rtl' }));
    const q1 = ltr.qrBox!;
    const q2 = rtl.qrBox!;
    expect(q1.x).toBeGreaterThan(600);
    expect(q2.x).toBeLessThan(600);
  });
});
