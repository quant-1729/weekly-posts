// Classic wraps the v2 templates (9-changes-v3.md section 14): the same pictures for the three old formats.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderPostDetailed } from '@/lib/render';
import { renderDesignDetailed, listLayouts } from '@/lib/design';
import { samplePhoto, sampleLogo, SAMPLE_MASCOT_SVG } from '@/lib/render/fixtures';
import { PALETTES, content, input, kit } from './fixtures';

let photo: Buffer;
let logo: Buffer;
beforeAll(async () => {
  photo = await samplePhoto();
  logo = await sampleLogo();
});

const plain = () => content({ primary: null, secondary: [], offerLine: null, blocks: [], qr: null });

describe('classic = v2', () => {
  it.each(['square', 'vertical', 'landscape'] as const)('%s matches the v2 render byte for byte (plain content)', async (format) => {
    const k = kit(PALETTES.bakery, { themeId: 'classic' });
    const c = plain();
    for (const withPhoto of [false, true]) {
      for (const layout of listLayouts('classic', format, withPhoto)) {
        const r = await renderDesignDetailed(input({ format, themeId: 'classic', kit: k, content: c, logo, photo: withPhoto ? photo : null, mascot: { svg: SAMPLE_MASCOT_SVG }, layoutId: layout.id }));
        const v2 = await renderPostDetailed({
          format,
          templateId: layout.id,
          brand: { name: 'Sunrise Sweets', colors: { primary: k.colors.primary, secondary: k.colors.secondary, accent: k.colors.accent }, logo },
          photo: withPhoto ? photo : undefined,
          text: { headline: c.headline, subline: c.subline, cta: c.cta!.text, bubble: c.bubble },
          mascot: { svg: SAMPLE_MASCOT_SVG },
        });
        expect(r.engine).toBe('v2');
        expect(r.layoutId).toBe(layout.id);
        expect(r.png.equals(v2.png), `${layout.id}`).toBe(true);
      }
    }
  });

  it('lists the v2 template ids for the old formats and recipes for the new ones', () => {
    expect(listLayouts('classic', 'square', false).map((l) => l.id)).toEqual(['sq-text', 'sq-text-card']);
    expect(listLayouts('classic', 'banner', false).map((l) => l.id)).toEqual(['classic-text', 'classic-card', 'classic-band']);
  });

  it('richer content (QR, contacts, USPs) and the new formats use the engine with the same look', async () => {
    const r = await renderDesignDetailed(input({ format: 'square', themeId: 'classic', layoutId: 'sq-text-card' }));
    expect(r.engine).toBe('engine');
    expect(r.layoutId).toBe('classic-card');
    expect(r.report.qr?.ok).toBe(true);
    for (const format of ['portrait', 'thumbnail', 'banner'] as const) {
      const n = await renderDesignDetailed(input({ format, themeId: 'classic' }));
      expect(n.engine).toBe('engine');
      expect(n.report.overflow).toEqual([]);
    }
  });
});
