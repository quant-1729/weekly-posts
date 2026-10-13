import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MascotPose } from '@/lib/ai/prompts/mascot';
import { drawMascot } from '@/lib/mascot/rig';
import { sampleLogo, samplePhoto } from '@/lib/render/fixtures';
import { FORMATS, listTemplates, renderPostDetailed, type Format, type Placement } from '@/lib/render';
import { bodyPixels, GREEN_SPEC } from './helpers';

const POSES: MascotPose[] = ['wave', 'point', 'celebrate'];
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

const inside = (inner: { x: number; y: number; w: number; h: number }, outer: { x: number; y: number; w: number; h: number }) =>
  inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;

async function greenInside(png: Buffer, box: { x: number; y: number; w: number; h: number }): Promise<number> {
  const crop = await sharp(png).extract({ left: Math.round(box.x), top: Math.round(box.y), width: Math.round(box.w), height: Math.round(box.h) }).png().toBuffer();
  return bodyPixels(crop);
}

describe('the mascot in every template (R15d)', () => {
  const squareAndVertical = FORMATS.filter((f) => f !== 'landscape');

  for (const format of FORMATS) {
    const templates = listTemplates(format);
    it(`${format}: ${templates.length} templates`, () => {
      expect(templates.length).toBeGreaterThanOrEqual(2);
    });
    for (const t of templates) {
      for (const pose of POSES) {
        for (const lang of TEXTS) {
          it(`${t.id} / ${pose} / ${lang.label}`, async () => {
            const r = await renderPostDetailed({
              format,
              templateId: t.id,
              brand: { ...BRAND, logo },
              photo: t.needsPhoto ? photo : undefined,
              text: lang.text,
              mascot: { svg: drawMascot(GREEN_SPEC, pose) },
            });
            expect(r.mascotDropped).toBe(false);
            expect(r.fellBack).toBe(false);
            const find = (name: string): Placement | undefined => r.placements.find((p) => p.name === name);

            if (format === 'landscape') {
              // No mascot and no bubble in landscape.
              expect(find('mascot')).toBeUndefined();
              expect(find('bubble')).toBeUndefined();
              expect(await bodyPixels(r.png)).toBe(0);
              return;
            }

            const mascot = find('mascot');
            const bubble = find('bubble');
            expect(mascot, 'mascot slot').toBeDefined();
            // The mascot's body colour is in the slot...
            expect(await greenInside(r.png, mascot!.box)).toBeGreaterThan(1500);
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
      mascot: { svg: drawMascot(GREEN_SPEC, 'wave') },
    });
    expect(r.placements.find((p) => p.name === 'mascot')).toBeDefined();
    expect(r.placements.find((p) => p.name === 'bubble')).toBeUndefined();
  });
});
