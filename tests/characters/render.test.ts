// CH-1: every character x every action draws valid SVG inside the shared canvas, deterministically, with no text.

import { describe, expect, it } from 'vitest';
import { drawCharacter } from '@/lib/characters';
import { ACTIONS, CANVAS, COLORS, IDS, alphaBox } from './helpers';

const O = { pad: 24, px: 1, min: 40 };

describe('characters render', () => {
  for (const id of IDS) {
    it(`${id}: all ${ACTIONS.length} actions are valid, inside the canvas, text-free and deterministic`, () => {
      for (const action of ACTIONS) {
        const d = drawCharacter(id, action, COLORS);
        expect(d.body.length, `${id}/${action}`).toBeGreaterThan(200);
        expect(d.body, `${id}/${action}`).not.toMatch(/<text|<tspan|<svg|NaN|undefined|Infinity|\bnull\b/);
        // Valid enough for resvg to draw something, and nothing is drawn outside the canvas (viewBox -10 0 260 260).
        const al = alphaBox(d.body, O).box;
        expect(al, `${id}/${action} draws nothing`).not.toBeNull();
        const eps = 0.5;
        expect(al!.x0, `${id}/${action} left`).toBeGreaterThanOrEqual(CANVAS.x - eps);
        expect(al!.y0, `${id}/${action} top`).toBeGreaterThanOrEqual(CANVAS.y - eps);
        expect(al!.x1, `${id}/${action} right`).toBeLessThanOrEqual(CANVAS.x + CANVAS.w + eps);
        expect(al!.y1, `${id}/${action} bottom`).toBeLessThanOrEqual(CANVAS.y + CANVAS.h + eps);
        // Deterministic.
        const again = drawCharacter(id, action, COLORS);
        expect(again.body).toBe(d.body);
        expect(again.anchors).toEqual(d.anchors);
      }
    }, 60_000);
  }

  it('mirror gives a different drawing, also valid and inside the canvas', () => {
    for (const id of IDS) {
      const d = drawCharacter(id, 'wave', COLORS, { mirror: true });
      expect(d.body).not.toBe(drawCharacter(id, 'wave', COLORS).body);
      const al = alphaBox(d.body, O).box!;
      expect(al.x0).toBeGreaterThanOrEqual(CANVAS.x - 0.5);
      expect(al.x1).toBeLessThanOrEqual(CANVAS.x + CANVAS.w + 0.5);
    }
  });
});
