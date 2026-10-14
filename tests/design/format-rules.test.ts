// FORMAT_RULES: thumbnails carry no QR and no contacts, banners no QR and one contact, landscape two contacts.
// Left-out items are reported in report.dropped by rule (not as overflow). Thumbnails are headline-led.
import { describe, expect, it } from 'vitest';
import { FORMAT_RULES, FORMAT_SIZE, THEME_IDS, renderDesignDetailed } from '@/lib/design';
import { samplePhoto } from '@/lib/render/fixtures';
import { PAY_QR, content, input } from './fixtures';
import { expectClean } from './helpers';

describe('format rules', () => {
  it('thumbnail: no QR and no contact lines, both reported as dropped by rule, nothing in overflow', async () => {
    const r = await renderDesignDetailed(input({ format: 'thumbnail', themeId: 'clean' }));
    expect(r.report.dropped).toContain('qr: not shown on thumbnails');
    for (const b of content().blocks) expect(r.report.dropped).toContain(`contact: not shown on thumbnails: ${b.text}`);
    expect(r.report.overflow).toEqual([]);
    expect(r.report.qr).toBeNull();
    expect(r.placements.some((p) => p.kind === 'qr' || p.name.startsWith('contact'))).toBe(false);
    expect(r.svg).not.toContain('crispEdges'); // no QR drawn
  });

  it('banner: no QR, one contact line (the first)', async () => {
    const r = await renderDesignDetailed(input({ format: 'banner', themeId: 'premium' }));
    expect(r.report.dropped).toContain('qr: not shown on banners');
    expect(r.placements.filter((p) => p.name.startsWith('contact-')).map((p) => p.text)).toEqual(['+91 98200 12345']);
    expect(r.report.dropped.filter((d) => d.startsWith('contact: not shown on banners')).length).toBe(2);
    expect(r.report.qr).toBeNull();
  });

  it('landscape: QR kept, at most two contact lines', async () => {
    const r = await renderDesignDetailed(input({ format: 'landscape', themeId: 'clean', content: content({ qr: PAY_QR }) }));
    expect(r.report.qr?.ok).toBe(true);
    expect(r.placements.filter((p) => p.name.startsWith('contact-')).length).toBe(2);
    expect(r.report.dropped.filter((d) => d.startsWith('contact: not shown on landscape images')).length).toBe(1);
  });

  it('square, portrait and vertical keep a QR and three contact lines', async () => {
    for (const format of ['square', 'portrait', 'vertical'] as const) {
      const r = await renderDesignDetailed(input({ format, themeId: 'clean' }));
      expect(r.placements.filter((p) => p.name.startsWith('contact-')).length, format).toBe(FORMAT_RULES[format].maxContacts);
      expect(r.report.qr?.ok, format).toBe(true);
      expect(r.report.dropped.filter((d) => d.includes('not shown')), format).toEqual([]);
    }
  });

  it('the rules apply to every theme', async () => {
    for (const themeId of THEME_IDS) {
      for (const format of ['thumbnail', 'banner'] as const) {
        const r = await renderDesignDetailed(input({ format, themeId }));
        expect(r.report.qr).toBeNull();
        expect(r.placements.some((p) => p.kind === 'qr'), `${themeId} ${format}`).toBe(false);
        expect(expectClean(r).problems, `${themeId} ${format}`).toEqual([]);
      }
    }
  });
});

describe('thumbnails are headline-led', () => {
  it('text takes about 60% of the frame, the headline is the largest text, and the timestamp corner is clear', async () => {
    const photo = await samplePhoto();
    const W = FORMAT_SIZE.thumbnail.width;
    for (const themeId of THEME_IDS) {
      for (const withPhoto of [false, true]) {
        for (const dir of ['ltr', 'rtl'] as const) {
          const r = await renderDesignDetailed(input({ format: 'thumbnail', themeId, photo: withPhoto ? photo : null, dir }));
          const text = r.placements.filter((p) => p.kind === 'text' && p.name !== 'logo-text');
          const head = text.find((p) => p.name === 'headline')!;
          expect(head.size, `${themeId} ${dir}`).toBe(Math.max(...text.map((p) => p.size)));
          expect(head.size).toBeGreaterThanOrEqual(44);
          const lines = text.flatMap((p) => p.lines);
          const span = Math.max(...lines.map((l) => l.x + l.w)) - Math.min(...lines.map((l) => l.x));
          expect(span, `${themeId} ${dir} ${withPhoto}`).toBeLessThanOrEqual(W * 0.62);
          expect(span).toBeGreaterThan(W * 0.2);
          expect(r.report.safeZone).toEqual([]);
        }
      }
    }
  });

  it('keeps a short headline very large, with the primary/offer line and then the CTA below it', async () => {
    const r = await renderDesignDetailed(input({ format: 'thumbnail', themeId: 'bold_sale', content: content({ headline: 'Big sale' }) }));
    const head = r.placements.find((p) => p.name === 'headline')!;
    expect(head.size).toBeGreaterThanOrEqual(100);
    const ys = ['headline', 'primary', 'offer', 'cta'].map((n) => r.placements.find((p) => p.name === n)!.box.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
});
