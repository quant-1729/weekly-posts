// G-4 contrast and safe zones, including kits with bad palettes (yellow on white, navy on black).
import { describe, expect, it } from 'vitest';
import { renderDesignDetailed, SAFE_ZONES, THEME_IDS } from '@/lib/design';
import { contrast } from '@/lib/render/color';
import { ALL_FORMATS, PALETTES, input, kit } from './fixtures';
import { pixelContrastIssues } from './helpers';

describe('contrast', () => {
  it.each(Object.keys(PALETTES))('palette %s: every text pair passes in every theme (report and pixels)', async (name) => {
    for (const themeId of THEME_IDS) {
      for (const format of ['square', 'vertical', 'landscape'] as const) {
        for (const mode of ['light', 'dark'] as const) {
          const r = await renderDesignDetailed(
            input({ format, themeId, kit: kit(PALETTES[name], { themeId, style: { corners: 'rounded', mode, energy: 'calm' } }) }),
          );
          expect(r.report.contrast, `${name} ${themeId} ${format} ${mode}`).toEqual([]);
          const px = await pixelContrastIssues(r);
          expect(px, `pixels ${name} ${themeId} ${format} ${mode}`).toEqual([]);
        }
      }
    }
  });

  it('every colour scheme of a theme passes too', async () => {
    for (const scheme of ['primary', 'light', 'dark', 'accent'] as const) {
      for (const name of ['yellowOnWhite', 'navyOnBlack', 'greys']) {
        const r = await renderDesignDetailed({ ...input({ format: 'square', themeId: 'clean', kit: kit(PALETTES[name], { themeId: 'clean' }) }), scheme });
        expect(r.report.contrast, `${name} ${scheme}`).toEqual([]);
        expect(r.scheme).toBe(scheme);
      }
    }
  });

  it('a bad kit falls back to another kit colour or a neutral, not to unreadable text', async () => {
    const r = await renderDesignDetailed(input({ format: 'square', themeId: 'clean', kit: kit(PALETTES.yellowOnWhite, { themeId: 'clean' }) }));
    const head = r.placements.find((p) => p.name === 'headline')!;
    expect(contrast(head.ink!, '#ffffff')).toBeGreaterThan(4.5);
  });
});

describe('safe zones', () => {
  it('keeps everything important inside each format safe area', async () => {
    for (const format of ALL_FORMATS) {
      for (const themeId of THEME_IDS) {
        const r = await renderDesignDetailed(input({ format, themeId }));
        expect(r.report.safeZone, `${themeId} ${format}`).toEqual([]);
        const z = SAFE_ZONES[format];
        for (const p of r.placements) {
          for (const b of [p.box, ...p.lines]) {
            if (!b.w || !b.h) continue;
            expect(b.x, `${themeId} ${format} ${p.name}`).toBeGreaterThanOrEqual(z.inside.x - 0.5);
            expect(b.y, `${themeId} ${format} ${p.name}`).toBeGreaterThanOrEqual(z.inside.y - 0.5);
            expect(b.x + b.w).toBeLessThanOrEqual(z.inside.x + z.inside.w + 0.5);
            expect(b.y + b.h).toBeLessThanOrEqual(z.inside.y + z.inside.h + 0.5);
          }
        }
      }
    }
  });

  it('keeps the story UI bands and the thumbnail timestamp corner clear', async () => {
    const v = await renderDesignDetailed(input({ format: 'vertical', themeId: 'bold_sale' }));
    for (const p of v.placements) for (const b of [p.box, ...p.lines]) if (b.w) expect(b.y).toBeGreaterThanOrEqual(249);
    for (const p of v.placements) for (const b of [p.box, ...p.lines]) if (b.w) expect(b.y + b.h).toBeLessThanOrEqual(1581);
    const t = await renderDesignDetailed(input({ format: 'thumbnail', themeId: 'clean' }));
    for (const p of t.placements) for (const b of [p.box, ...p.lines]) if (b.w) expect(b.x + b.w > 1060 && b.y + b.h > 610).toBe(false);
    const ban = await renderDesignDetailed(input({ format: 'banner', themeId: 'clean' }));
    for (const p of ban.placements) for (const b of [p.box, ...p.lines]) if (b.w) {
      expect(b.x).toBeGreaterThanOrEqual(239);
      expect(b.x + b.w).toBeLessThanOrEqual(1681);
    }
  });
});
