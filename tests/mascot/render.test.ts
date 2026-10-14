import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { tweenColorsFor } from '@/lib/mascot/colors';
import { TWEEN_POST_POSES } from '@/lib/mascot/poses';
import { mascotForRender } from '@/lib/mascot/posts';
import { sampleLogo, samplePhoto } from '@/lib/render/fixtures';
import { FORMATS, listTemplates, renderPostDetailed, type Format, type MascotInput, type Placement } from '@/lib/render';
import { colorPixels, GREEN } from './helpers';

const COLORS = tweenColorsFor({ primary: GREEN });
const BRAND = { name: 'Corner Bakery', colors: { primary: '#7a1f2b', secondary: '#f6e7c8', accent: '#f2b100' } };
const TEXTS = [
  { label: 'English', text: { headline: 'Fresh from the oven', subline: 'Come and taste this week', cta: 'Message us to order', bubble: 'Fresh from the oven!' } },
  { label: 'Hindi', text: { headline: 'दीवाली स्पेशल मिठाई', subline: 'काजू कतली और लड्डू', cta: 'ऑर्डर के लिए WhatsApp करें', bubble: 'आइए, स्वाद चखिए!' } },
];

let photo: Buffer;
let logo: Buffer;
beforeAll(async () => {
  photo = await samplePhoto();
  logo = await sampleLogo();
});

type Box = { x: number; y: number; w: number; h: number };
const inside = (inner: Box, outer: Box) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;

async function scarfInside(png: Buffer, box: Box): Promise<number> {
  const crop = await sharp(png).extract({ left: Math.round(box.x), top: Math.round(box.y), width: Math.round(box.w), height: Math.round(box.h) }).png().toBuffer();
  return colorPixels(crop);
}

describe('Tween in every template (R15d, D9)', () => {
  const squareAndVertical = FORMATS.filter((f) => f !== 'landscape');

  for (const format of FORMATS) {
    const templates = listTemplates(format);
    it(`${format}: ${templates.length} templates`, () => {
      expect(templates.length).toBeGreaterThanOrEqual(2);
    });
    for (const t of templates) {
      for (const pose of ['wave', 'point', 'celebrate'] as const) {
        for (const lang of TEXTS) {
          it(`${t.id} / ${pose} / ${lang.label}`, async () => {
            const r = await renderPostDetailed({
              format,
              templateId: t.id,
              brand: { ...BRAND, logo },
              photo: t.needsPhoto ? photo : undefined,
              text: lang.text,
              mascot: mascotForRender(COLORS, pose),
            });
            expect(r.mascotDropped).toBe(false);
            expect(r.fellBack).toBe(false);
            const find = (name: string): Placement | undefined => r.placements.find((p) => p.name === name);

            if (format === 'landscape') {
              // No mascot and no bubble in landscape.
              expect(find('mascot')).toBeUndefined();
              expect(find('bubble')).toBeUndefined();
              expect(await colorPixels(r.png)).toBe(0);
              return;
            }

            const mascot = find('mascot');
            const bubble = find('bubble');
            expect(mascot, 'mascot slot').toBeDefined();
            // Tween's scarf colour is in the slot...
            expect(await scarfInside(r.png, mascot!.box)).toBeGreaterThan(1500);
            // ...and the bubble text sits inside the bubble.
            expect(bubble, 'bubble').toBeDefined();
            expect(bubble!.text).toBe(lang.text.bubble);
            expect(bubble!.truncated).toBe(false);
            expect(bubble!.lines.length).toBeGreaterThan(0);
            for (const line of bubble!.lines) expect(inside(line, bubble!.box)).toBe(true);
            // Nothing the owner wrote is lost or truncated because of the mascot.
            for (const name of ['headline', 'subline', 'cta']) {
              const p = find(name);
              if (p) expect(p.truncated, name).toBe(false);
            }
          });
        }
      }
    }
  }

  it('square and vertical are the formats with a mascot slot', () => {
    expect(squareAndVertical).toEqual(['square', 'vertical']);
  });

  it('a template with no mascot given draws no mascot slot and no bubble', async () => {
    for (const format of ['square', 'vertical'] as Format[]) {
      const t = listTemplates(format)[0];
      const r = await renderPostDetailed({ format, templateId: t.id, brand: BRAND, photo: t.needsPhoto ? photo : undefined, text: TEXTS[0].text });
      expect(r.placements.find((p) => p.name === 'mascot')).toBeUndefined();
      expect(r.placements.find((p) => p.name === 'bubble')).toBeUndefined();
    }
  });

  it('a mascot with an empty bubble is drawn without a bubble', async () => {
    const t = listTemplates('square')[0];
    const r = await renderPostDetailed({
      format: 'square',
      templateId: t.id,
      brand: BRAND,
      photo: t.needsPhoto ? photo : undefined,
      text: { ...TEXTS[0].text, bubble: '' },
      mascot: mascotForRender(COLORS, 'wave'),
    });
    expect(r.placements.find((p) => p.name === 'mascot')).toBeDefined();
    expect(r.placements.find((p) => p.name === 'bubble')).toBeUndefined();
  });

  it('every post pose is drawn in the slot', async () => {
    const t = listTemplates('square').find((x) => !x.needsPhoto)!;
    for (const pose of TWEEN_POST_POSES) {
      const r = await renderPostDetailed({ format: 'square', templateId: t.id, brand: BRAND, text: TEXTS[0].text, mascot: mascotForRender(COLORS, pose) });
      expect(r.mascotDropped, pose).toBe(false);
      expect(await colorPixels(r.png), pose).toBeGreaterThan(1500);
    }
  });
});

describe('what the slot tells the mascot: side and a dark background (halo)', () => {
  /** A mascot input that records what the slot asked for. */
  function spy() {
    const calls: Array<{ side: 'left' | 'right'; halo: boolean }> = [];
    const mascot: MascotInput = {
      svg: '<g/>',
      build: (o) => {
        calls.push(o);
        return '<g/>';
      },
    };
    return { calls, mascot };
  }
  const solid = (hex: string) => sharp({ create: { width: 800, height: 800, channels: 3, background: hex } }).jpeg().toBuffer();
  const brandWith = (primary: string) => ({ name: 'B', colors: { primary, secondary: '#f6e7c8', accent: '#f2b100' } });

  it('flat templates: a dark primary colour gets the halo, a light one does not', async () => {
    const dark = spy();
    await renderPostDetailed({ format: 'square', templateId: 'sq-text', brand: brandWith('#0b1c30'), text: TEXTS[0].text, mascot: dark.mascot });
    expect(dark.calls).toEqual([{ side: 'right', halo: true }]);

    const light = spy();
    await renderPostDetailed({ format: 'square', templateId: 'sq-text', brand: brandWith('#f6e7c8'), text: TEXTS[0].text, mascot: light.mascot });
    expect(light.calls).toEqual([{ side: 'right', halo: false }]);
  });

  it('the cut-off is a relative luminance of 0.35', async () => {
    // #808080 has luminance 0.216 (dark); #c0c0c0 has 0.527 (light).
    for (const [primary, halo] of [
      ['#808080', true],
      ['#c0c0c0', false],
    ] as const) {
      const m = spy();
      await renderPostDetailed({ format: 'square', templateId: 'sq-text', brand: brandWith(primary), text: TEXTS[0].text, mascot: m.mascot });
      expect(m.calls[0].halo, primary).toBe(halo);
    }
  });

  it('photo templates: the photo behind the slot decides (a dark photo gets the halo, a light one does not)', async () => {
    const dark = spy();
    await renderPostDetailed({ format: 'square', templateId: 'sq-photo-band', brand: BRAND, photo: await solid('#101820'), text: TEXTS[0].text, mascot: dark.mascot });
    expect(dark.calls).toEqual([{ side: 'right', halo: true }]);
    const light = spy();
    await renderPostDetailed({ format: 'square', templateId: 'sq-photo-band', brand: BRAND, photo: await solid('#f0f0f0'), text: TEXTS[0].text, mascot: light.mascot });
    expect(light.calls).toEqual([{ side: 'right', halo: false }]);
  });

  it('a full-photo template always has the dark caption scrim behind the mascot, so it gets the halo', async () => {
    const m = spy();
    await renderPostDetailed({ format: 'square', templateId: 'sq-photo-full', brand: BRAND, photo: await solid('#f0f0f0'), text: TEXTS[0].text, mascot: m.mascot });
    expect(m.calls).toEqual([{ side: 'right', halo: true }]);
  });

  it('a centred slot counts as the right-hand side, and a mascot input with no builder is used as it is', async () => {
    const m = spy();
    await renderPostDetailed({ format: 'vertical', templateId: 'tl-text', brand: BRAND, text: TEXTS[0].text, mascot: m.mascot });
    expect(m.calls[0].side).toBe('right');
    const fixed = await renderPostDetailed({
      format: 'square',
      templateId: 'sq-text',
      brand: BRAND,
      text: TEXTS[0].text,
      mascot: { svg: '<rect width="400" height="400" fill="#12ab34"/>' },
    });
    expect(await colorPixels(fixed.png)).toBeGreaterThan(1500);
  });

  it('with the halo the post still renders, and the mascot is drawn', async () => {
    const r = await renderPostDetailed({ format: 'square', templateId: 'sq-text', brand: brandWith('#0b1c30'), text: TEXTS[0].text, mascot: mascotForRender(COLORS, 'wave') });
    expect(r.mascotDropped).toBe(false);
    expect(await colorPixels(r.png)).toBeGreaterThan(1500);
  });
});
