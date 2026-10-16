// CH-1: anchors. Bounds hold the drawing (and are not wildly larger), hands and face are inside them, hold-sign has a blank
// placard, point-* has a direction, and mirroring flips every anchor.

import { describe, expect, it } from 'vitest';
import { drawCharacter } from '@/lib/characters';
import { BODIES } from '@/lib/characters/bodies';
import { drawRig } from '@/lib/characters/rig';
import type { CharacterAnchors } from '@/lib/characters';
import { ACTIONS, COLORS, IDS, alphaBox } from './helpers';

const O = { pad: 24, px: 1, min: 60 };
const inside = (b: CharacterAnchors['bounds'], p: { x: number; y: number }, tol = 1.5) =>
  p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;

describe('anchors', () => {
  for (const id of IDS) {
    it(`${id}: face and hands are inside the bounds, feet are under the character`, () => {
      for (const action of ACTIONS) {
        const a = drawCharacter(id, action, COLORS).anchors;
        expect(a.bounds.w, `${id}/${action}`).toBeGreaterThan(30);
        expect(a.bounds.h, `${id}/${action}`).toBeGreaterThan(60);
        for (const k of ['handL', 'handR', 'face'] as const) expect(inside(a.bounds, a[k]), `${id}/${action} ${k}`).toBe(true);
        expect(a.feet.x, `${id}/${action} feet.x`).toBeGreaterThanOrEqual(a.bounds.x);
        expect(a.feet.x, `${id}/${action} feet.x`).toBeLessThanOrEqual(a.bounds.x + a.bounds.w);
        // The ground line is at or just below the bottom of the drawing (a jump leaves the ground below it; perch: the seat, inside it).
        const bottom = a.bounds.y + a.bounds.h;
        if (action === 'perch' || action === 'sit') expect(a.feet.y, `${id}/${action} feet.y`).toBeLessThanOrEqual(bottom + 3);
        else expect(a.feet.y, `${id}/${action} feet.y`).toBeGreaterThanOrEqual(bottom - 24); // sleeping sinks and leans; dhaaga's thread tail dips below the line
        expect(a.feet.y, `${id}/${action} feet.y`).toBeLessThanOrEqual(bottom + 40);
        expect(a.feet.y, `${id}/${action} feet.y`).toBeGreaterThan(a.bounds.y + a.bounds.h * 0.5);
      }
    });

    it(`${id}: the screen-left hand is on the left of the right hand`, () => {
      const a = drawCharacter(id, 'idle', COLORS).anchors;
      expect(a.handL.x).toBeLessThan(a.handR.x);
    });
  }

  it('bounds hold the drawing and are reasonably tight (code-drawn characters, effects excluded)', () => {
    for (const id of IDS) {
      if (id === 'tween') continue;
      for (const action of ACTIONS) {
        const r = drawRig(BODIES[id], action, COLORS);
        const b = r.anchors.bounds;
        const al = alphaBox(r.core, O).box!;
        const tag = `${id}/${action}`;
        // nothing is drawn outside the bounds (anti-aliasing slack of 2.5 units)
        expect(al.x0, tag).toBeGreaterThanOrEqual(b.x - 2.5);
        expect(al.y0, tag).toBeGreaterThanOrEqual(b.y - 2.5);
        expect(al.x1, tag).toBeLessThanOrEqual(b.x + b.w + 3.5);
        expect(al.y1, tag).toBeLessThanOrEqual(b.y + b.h + 3.5);
        // not much empty space: bounds are conservative for rotated bodies (running) but never huge
        expect(al.x0 - b.x, tag).toBeLessThan(30);
        expect(al.y0 - b.y, tag).toBeLessThan(30);
        expect(b.x + b.w - al.x1, tag).toBeLessThan(32);
        expect(b.y + b.h - al.y1, tag).toBeLessThan(32);
      }
    }
  }, 120_000);

  it('Tween bounds hold the drawing (poses without floating props)', () => {
    const withProps = new Set(['think', 'celebrate', 'sleep', 'search', 'loading', 'clap', 'jump']);
    for (const action of ACTIONS) {
      if (withProps.has(action)) continue;
      const d = drawCharacter('tween', action, COLORS);
      const b = d.anchors.bounds;
      const al = alphaBox(d.body, O).box!;
      expect(al.x0, action).toBeGreaterThanOrEqual(b.x - 2.5);
      expect(al.y0, action).toBeGreaterThanOrEqual(b.y - 2.5);
      expect(al.x1, action).toBeLessThanOrEqual(b.x + b.w + 3.5);
      expect(al.y1, action).toBeLessThanOrEqual(b.y + b.h + 2.5);
    }
  });

  it('hold-sign has a blank placard the hands hold; other actions have no sign anchor', () => {
    for (const id of IDS) {
      const d = drawCharacter(id, 'hold-sign', COLORS);
      const s = d.anchors.sign;
      expect(s, id).toBeDefined();
      expect(s!.w, id).toBeGreaterThanOrEqual(70);
      expect(s!.h, id).toBeGreaterThanOrEqual(24);
      expect(s!.x, id).toBeGreaterThanOrEqual(-10);
      expect(s!.x + s!.w, id).toBeLessThanOrEqual(250);
      expect(s!.y + s!.h, id).toBeLessThanOrEqual(260);
      // blank: the middle of the placard is pure white, nothing drawn on it
      const al = alphaBox(d.body, { pad: 0, px: 2, min: 40 });
      const cx = Math.round((s!.x + s!.w / 2 + 10) * 2);
      const cy = Math.round((s!.y + s!.h / 2) * 2);
      const i = (cy * al.width + cx) * 4;
      expect([al.data[i], al.data[i + 1], al.data[i + 2], al.data[i + 3]], `${id} placard centre`).toEqual([255, 255, 255, 255]);
      // the hands are at the placard's sides
      const near = (h: { x: number; y: number }, edge: number) => Math.abs(h.x - edge) < 22 && h.y > s!.y - 24 && h.y < s!.y + s!.h + 24;
      expect(near(d.anchors.handL, s!.x) || near(d.anchors.handR, s!.x), `${id} hands near placard left`).toBe(true);
      expect(near(d.anchors.handR, s!.x + s!.w) || near(d.anchors.handL, s!.x + s!.w), `${id} hands near placard right`).toBe(true);
    }
    for (const id of IDS) for (const a of ACTIONS) if (a !== 'hold-sign') expect(drawCharacter(id, a, COLORS).anchors.sign, `${id}/${a}`).toBeUndefined();
  });

  it('point-* has a unit direction that matches the action; others have none', () => {
    for (const id of IDS) {
      for (const a of ACTIONS) {
        const p = drawCharacter(id, a, COLORS).anchors.pointing;
        if (!a.startsWith('point-')) { expect(p, `${id}/${a}`).toBeUndefined(); continue; }
        expect(p, `${id}/${a}`).toBeDefined();
        expect(Math.hypot(p!.dx, p!.dy), `${id}/${a}`).toBeCloseTo(1, 1);
        if (a === 'point-left') expect(p!.dx, `${id}/${a}`).toBeLessThan(-0.8);
        if (a === 'point-right') expect(p!.dx, `${id}/${a}`).toBeGreaterThan(0.8);
        if (a === 'point-up') expect(p!.dy, `${id}/${a}`).toBeLessThan(-0.8);
        if (a === 'point-down') expect(p!.dy, `${id}/${a}`).toBeGreaterThan(0.6);
      }
    }
  });

  it('mirror flips every anchor across the canvas centre (x = 120)', () => {
    for (const id of IDS) {
      for (const a of ACTIONS) {
        const n = drawCharacter(id, a, COLORS).anchors;
        const m = drawCharacter(id, a, COLORS, { mirror: true }).anchors;
        const tag = `${id}/${a}`;
        const flip = (x: number) => 240 - x;
        expect(m.handL.x, tag).toBeCloseTo(flip(n.handR.x), 0);
        expect(m.handR.x, tag).toBeCloseTo(flip(n.handL.x), 0);
        expect(m.handL.y, tag).toBeCloseTo(n.handR.y, 0);
        expect(m.face.x, tag).toBeCloseTo(flip(n.face.x), 0);
        expect(m.face.y, tag).toBeCloseTo(n.face.y, 0);
        expect(m.feet.x, tag).toBeCloseTo(flip(n.feet.x), 0);
        expect(m.bounds.x, tag).toBeCloseTo(flip(n.bounds.x + n.bounds.w), 0);
        expect(m.bounds.w, tag).toBeCloseTo(n.bounds.w, 0);
        if (n.sign) expect(m.sign!.x, tag).toBeCloseTo(flip(n.sign.x + n.sign.w), 0);
        if (n.pointing) {
          expect(m.pointing!.dx, tag).toBeCloseTo(-n.pointing.dx, 1);
          expect(m.pointing!.dy, tag).toBeCloseTo(n.pointing.dy, 1);
        }
      }
    }
  });
});
