// The shared character rig (CH-1): a port of the Figital mascot kit's Parchi rig (vendor/figital-mascots/parchi-rig.js,
// read-only reference, never run). One function draws any of the 41 actions as a still frame at the action's key time,
// around any CharacterBody: limbs by two-link IK, eyes, mouth, held props and effects. Deterministic: no randomness,
// no clock. Draws no text; every sign and checklist is abstract so code can write the real words.

import type { ArmGeom, CharacterBody, LegOut, Palette, Pose } from './body';
import { buildPalette } from './body';
import { KEY_TIMES } from './key-times';
import { rowsSvg, stampSvg, tick } from './parts';
import type { CharacterAction, CharacterAnchors, CharacterColors } from './types';
import { Box, R, apply, chain, f, lerp, mul, r1, rotate, scale, skewX, translate, wav, type Mat, type Pt } from './util';

/** Loop lengths from the kit (ACTIONS.md). Only used inside the pose maths (wave periods, phases). */
export const LOOPS: Record<CharacterAction, number> = {
  idle: 3.6, 'walk-right': 3.2, 'walk-left': 3.2, wave: 4.16, 'point-right': 3.6, 'point-left': 3.6, 'point-up': 3.6,
  talk: 3.9, think: 4.8, celebrate: 2.24, sleep: 9.6, shrug: 3.6, peek: 3.6,
  reach: 3.6, present: 3.6, climb: 3.0, perch: 5.6, cover: 3.6, land: 1.2,
  namaste: 3.6, 'thumbs-up': 3.6, clap: 2.4, nod: 2.4, 'shake-no': 2.4, surprised: 3.6, oops: 3.6, heart: 3.6,
  'check-off': 4.8, write: 3.6, stamp: 2.4, search: 3.6, remind: 3.6, 'hold-sign': 3.6, phone: 3.6, send: 2.4,
  jump: 1.6, 'run-right': 1.6, 'run-left': 1.6, sit: 5.6, 'point-down': 3.6, loading: 3.6,
};

/** A perching character's body bottom sits this far above its standing position (the kit's ledge: 24 above the hips). */
export const PERCH_LIFT = 24;

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

const MIX = { orange: '#F08A6C', blue: '#2c5f8f', heart: '#F2766B', heartDark: '#D2564C', sweat: '#7FD6D1' } as const;

// ---------------------------------------------------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------------------------------------------------

/** Two-link arm solver: angles (upper, fore) that put the hand on a target point. */
export function ik(s: Pt, tx: number, ty: number, bend: number, L1: number, L2: number): [number, number] {
  const dx = tx - s[0];
  const dy = ty - s[1];
  const d = Math.min(L1 + L2 - 0.5, Math.max(Math.abs(L1 - L2) + 0.5, Math.hypot(dx, dy)));
  const phi = Math.atan2(dx, dy) / R;
  const alpha = Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)) / R;
  const a1 = phi + bend * alpha;
  const ex = s[0] + L1 * Math.sin(a1 * R);
  const ey = s[1] + L1 * Math.cos(a1 * R);
  const a2 = Math.atan2(tx - ex, ty - ey) / R - a1;
  return [a1, a2];
}

/** Where a body without native checklist rows shows its small card. */
export function cardOf(body: CharacterBody): { x: number; y: number; w: number; h: number } {
  // The card is as big as the kit's checklist block (80 x 82); each body says where it sits.
  const c = body.card ?? { x: body.cx - 40, y: body.face.mouth[1] + 10 };
  return { x: c.x, y: c.y, w: 80, h: 82 };
}

export function pose(action: CharacterAction, t: number, body: CharacterBody): Pose {
  const sl = body.shoulders.l;
  const sr = body.shoulders.r;
  const L1 = 22 * body.armScale;
  const L2 = 20 * body.armScale;
  const ox = body.cx - 120;
  const oy = sl[1] - 132;
  // The kit's chest-centred targets (drawn for Parchi) moved to this body's centre line and shoulder height.
  const ikL = (x: number, y: number, bend: number) => ik(sl, x + ox, y + oy, bend, L1, L2);
  const ikR = (x: number, y: number, bend: number) => ik(sr, x + ox, y + oy, bend, L1, L2);
  const card = cardOf(body);
  const ro: Pt = body.nativeRows ? [0, 0] : [card.x - 80, card.y - 126];
  const sg = body.sign;

  const p: Pose = {
    action, t,
    L: [-22, -8], Rt: [22, 8], legL: 0, legR: 0, dx: 0, dy: 0, tilt: 0, sx: 1, sy: 1, skew: 0,
    eyes: 'open', mouth: 'smile', look: [0, 0], rows: [1, 1, 0], stamp: 0, props: [], flip: false,
    sit: false, perch: false, pen: false, slip: false, extra: [], write: null, plane: null, heartK: 1,
    cover: false, coverPeek: false, ledger: false, baseY: 0,
  };
  const T = LOOPS[action] || 3.6;
  const ph = (((t % T) + T) % T) / T;

  switch (action) {
    case 'idle':
      p.dy = 1.8 * wav(t, 3.6); p.skew = 1.2 * wav(t, 1.8); break;
    case 'walk-right': case 'walk-left': {
      const w = wav(t, 0.64);
      const dir = action === 'walk-right' ? 1 : -1;
      p.legL = 24 * w; p.legR = -24 * w;
      p.L = [-22 - 20 * w, -10]; p.Rt = [22 - 20 * w, 10];
      p.dy = -2.5 * Math.abs(wav(t, 1.28)); p.tilt = 4 * dir; p.look = [3 * dir, 0]; p.skew = -2 * dir; break;
    }
    case 'wave':
      p.Rt = [150, 24 + 24 * wav(t, 0.52)]; p.mouth = 'grin'; p.tilt = -2; p.dy = 1.2 * wav(t, 4.16 / 4); break;
    case 'point-right':
      p.Rt = [90 + 3 * wav(t, 1.2), 0]; p.look = [3.5, 0]; p.tilt = 2; break;
    case 'point-left':
      p.L = [-90 - 3 * wav(t, 1.2), 0]; p.look = [-3.5, 0]; p.tilt = -2; break;
    case 'point-up':
      p.Rt = [168, 4 + 3 * wav(t, 1.2)]; p.look = [1, -3.5]; break;
    case 'talk':
      p.Rt = [64, 46 + 12 * wav(t, 1.3)]; p.L = [-26 - 6 * wav(t, 1.95), -14]; p.mouth = 'talk'; p.dy = 1.2 * wav(t, 1.95); break;
    case 'think':
      p.Rt = [150, 86]; p.eyes = 'think'; p.look = [2.6, -3]; p.tilt = -3; p.mouth = 'small'; p.props = ['dots']; break;
    case 'celebrate': {
      p.dy = -14 * Math.abs(Math.sin((Math.PI * t) / 0.56));
      const k = 6 * wav(t, 0.56);
      p.L = [-158 - k, -12]; p.Rt = [158 + k, 12]; p.legL = -10; p.legR = 10;
      p.eyes = 'happy'; p.mouth = 'open'; p.rows = [1, 1, 1]; p.stamp = 1; p.props = ['confetti']; break;
    }
    case 'sleep':
      p.L = [-10, -4]; p.Rt = [10, 4]; p.eyes = 'sleep'; p.mouth = 'small'; p.tilt = 6; p.dy = 4;
      p.sy = 1 + 0.015 * wav(t, 4.8); p.props = ['zzz']; break;
    case 'shrug': {
      const b = Math.max(0, wav(t, 1.8));
      p.L = [-50, -90]; p.Rt = [50, 90]; p.eyes = 'worried'; p.mouth = 'wavy'; p.dy = 2 - 3 * b; p.tilt = 3; break;
    }
    case 'peek':
      p.flip = true; p.Rt = [118 + 10 * wav(t, 0.9), 34]; p.tilt = -5; p.look = [2, 0]; break;
    case 'reach': {
      const q = (t % T) / T;
      p.Rt = q < 0.5 ? [172, 26 + 14 * wav(t, 0.6)] : [70, -50]; p.pen = q >= 0.5;
      p.look = q < 0.5 ? [1, -3.5] : [3, 2]; p.eyes = q < 0.5 ? 'think' : 'open'; p.tilt = q < 0.5 ? 3 : 0; break;
    }
    case 'present': {
      const q = (t % T) / T;
      p.dy = q < 0.18 ? -10 * Math.sin((Math.PI * q) / 0.18) : 0;
      p.Rt = [96, -34]; p.slip = true; p.mouth = 'grin'; p.look = [3, 1.5];
      break;
    }
    case 'climb': {
      const c = wav(t, 0.75);
      p.L = [-165 + 12 * c, -10]; p.Rt = [165 + 12 * c, 10]; p.legL = 26 * c; p.legR = -26 * c;
      p.dy = -3 * Math.abs(c); p.look = [0, -3.5]; break;
    }
    case 'perch':
      p.sit = true; p.perch = true; p.legL = 10 + 14 * wav(t, 1.4); p.legR = -10 + 14 * wav(t, 1.4 * 1.1);
      p.L = [-36, -40]; p.Rt = [36, 40]; p.eyes = 'happy'; p.mouth = 'smile'; p.dy = -14; break;
    case 'cover': {
      const peekNow = t % 1.8 > 1.1;
      p.cover = true; p.coverPeek = peekNow; p.mouth = 'grin'; p.skew = 1.5 * wav(t, 0.3); break;
    }
    case 'land': {
      const q = (t % T) / T;
      if (q < 0.3) { p.dy = -46 * (1 - q / 0.3) * (1 - q / 0.3); p.L = [-140, -10]; p.Rt = [140, 10]; p.eyes = 'happy'; }
      else if (q < 0.55) { const k = Math.sin((Math.PI * (q - 0.3)) / 0.25); p.sy = 1 - 0.14 * k; p.sx = 1 + 0.08 * k; p.L = [-60, -20]; p.Rt = [60, 20]; }
      else { const k = Math.sin(Math.PI * Math.min(1, (q - 0.55) / 0.25)) * (q < 0.8 ? 1 : 0); p.sy = 1 + 0.05 * k; p.sx = 1 - 0.03 * k; }
      break;
    }
    case 'namaste': {
      const bow = ph > 0.35 && ph < 0.8 ? Math.sin((Math.PI * (ph - 0.35)) / 0.45) : 0;
      p.L = ikL(116, 146, -1); p.Rt = ikR(124, 146, 1);
      p.dy = 4 * bow; p.sy = 1 - 0.03 * bow; p.eyes = bow > 0.3 ? 'happy' : 'open'; p.extra = ['palms']; break;
    }
    case 'thumbs-up':
      p.Rt = [128, 40 + 4 * wav(t, 1.2)]; p.eyes = 'wink'; p.mouth = 'grin'; p.tilt = -2;
      p.extra = ['thumb', 'sparkle']; break;
    case 'clap': {
      const c = (1 + wav(t, 0.4)) / 2;
      p.L = ikL(lerp(96, 117, c), 148, -1); p.Rt = ikR(lerp(144, 123, c), 148, 1);
      p.eyes = 'happy'; p.mouth = 'open'; p.dy = -2 * c; if (c > 0.92) p.extra = ['burst-clap']; break;
    }
    case 'nod': {
      const n = wav(t, 0.8);
      p.dy = 2.5 * Math.max(0, n); p.look = [0, 2.6 * n]; p.sy = 1 - 0.02 * Math.max(0, n); p.mouth = 'smile'; break;
    }
    case 'shake-no': {
      const s = wav(t, 0.6);
      p.look = [3.2 * s, 0]; p.skew = 2.5 * s; p.dx = 1.5 * s; p.mouth = 'small'; p.eyes = 'worried'; break;
    }
    case 'surprised':
      p.dy = ph < 0.12 ? -8 * Math.sin((Math.PI * ph) / 0.12) : 0;
      p.L = [-120, -40]; p.Rt = [120, 40]; p.eyes = 'wide'; p.mouth = 'open'; p.extra = ['exclaim']; break;
    case 'oops':
      p.Rt = [160, 72 + 6 * wav(t, 0.5)]; p.eyes = 'worried'; p.mouth = 'wavy'; p.tilt = 4; p.extra = ['sweat']; break;
    case 'heart':
      p.L = ikL(108, 162, -1); p.Rt = ikR(132, 162, 1);
      p.eyes = 'happy'; p.mouth = 'smile'; p.heartK = 1 + 0.08 * Math.max(0, wav(t, 0.9)); p.extra = ['heart']; break;
    case 'check-off': {
      const step = Math.min(3, Math.floor(ph * 4));
      p.ledger = true;
      p.rows = [step > 0 ? 1 : 0, step > 1 ? 1 : 0, step > 2 ? 1 : 0];
      const rowY = [136, 154, 172][Math.min(2, step)];
      const wig = (ph * 4) % 1 < 0.5 ? 2 * wav(t, 0.18) : 0;
      p.Rt = step < 3 ? ik(sr, 100 + wig + ro[0], rowY - 4 + ro[1], 1, L1, L2) : [60, 40];
      p.pen = true; p.look = step < 3 ? [-1.5, 3] : [0, 0]; p.eyes = step < 3 ? 'open' : 'happy'; p.mouth = step < 3 ? 'small' : 'grin';
      p.dy = step === 3 ? -6 * Math.abs(Math.sin(Math.PI * ((ph - 0.75) / 0.25))) : 0; break;
    }
    case 'write': {
      const k = Math.min(1, ph * 1.3);
      p.ledger = true;
      p.rows = [1, 1, 0]; p.write = k; p.pen = true;
      p.Rt = ik(sr, 105 + 44 * k + ro[0], 168 + 2 * wav(t, 0.12) + ro[1], 1, L1, L2); p.look = [0, 3]; p.mouth = 'small'; break;
    }
    case 'stamp': {
      let ty: number;
      let sq = 0;
      if (ph < 0.4) ty = lerp(150, 60, ph / 0.4);
      else if (ph < 0.5) ty = lerp(60, 184, (ph - 0.4) / 0.1);
      else { ty = lerp(184, 150, Math.min(1, (ph - 0.5) / 0.5)); sq = ph < 0.62 ? Math.sin((Math.PI * (ph - 0.5)) / 0.12) : 0; }
      p.ledger = true;
      p.Rt = ik(sr, 150 + ro[0], ty + ro[1], 1, L1, L2); p.extra = ['stamp-tool']; p.stamp = ph >= 0.48 ? 1 : 0;
      p.sy = 1 - 0.06 * sq; p.sx = 1 + 0.03 * sq; if (sq > 0.2) p.extra.push('burst-stamp');
      p.eyes = ph >= 0.48 ? 'happy' : 'open'; p.mouth = ph >= 0.48 ? 'grin' : 'small'; p.rows = ph >= 0.48 ? [1, 1, 1] : [1, 1, 0]; break;
    }
    case 'search': {
      const x = 132 + 14 * wav(t, 1.8);
      p.Rt = ikR(x + 4, 120, 1); p.extra = ['magnifier']; p.look = [3 * wav(t, 1.8), 0]; p.mouth = 'small'; p.eyes = 'think'; break;
    }
    case 'remind':
      p.Rt = [152, 18 + 18 * Math.max(0, wav(t, 0.5))]; p.mouth = 'smile'; p.look = [2, -2]; p.extra = ['remind']; break;
    case 'hold-sign': {
      const hy = sg.y + (body.signGrip ?? 28);
      p.L = ik(sl, sg.x + 8, hy, -1, L1, L2); p.Rt = ik(sr, sg.x + sg.w - 8, hy, 1, L1, L2); p.dy = 1.5 * wav(t, 1.8);
      p.mouth = 'grin'; p.extra = ['sign']; break;
    }
    case 'phone': {
      const show = ph > 0.5;
      p.Rt = ikR(show ? 166 : 146, show ? 150 : 140, 1); p.extra = ['phone'];
      p.look = show ? [0, 0] : [3, 3]; p.mouth = show ? 'grin' : 'small'; p.eyes = 'open'; break;
    }
    case 'send': {
      if (ph < 0.3) p.Rt = [lerp(70, 40, ph / 0.3), lerp(-60, -100, ph / 0.3)];
      else if (ph < 0.45) p.Rt = [lerp(40, 115, (ph - 0.3) / 0.15), lerp(-100, -10, (ph - 0.3) / 0.15)];
      else p.Rt = [115, -10];
      p.plane = ph < 0.42 ? 'hand' : (ph - 0.42) / 0.58; p.look = ph < 0.45 ? [2, 1] : [3.5, -2.5]; p.mouth = ph < 0.45 ? 'small' : 'grin'; break;
    }
    case 'jump': {
      const h = Math.sin(Math.PI * ph);
      p.dy = -26 * h; p.L = [-150 - 10 * h, -20]; p.Rt = [150 + 10 * h, 20]; p.legL = -26 * h; p.legR = 26 * h;
      if (ph < 0.08 || ph > 0.92) { p.sy = 0.92; p.sx = 1.04; }
      p.eyes = 'happy'; p.mouth = 'open'; break;
    }
    case 'run-right': case 'run-left': {
      const w = wav(t, 0.4);
      const dir = action === 'run-right' ? 1 : -1;
      p.legL = 34 * w; p.legR = -34 * w; p.L = [-15 - 30 * w, -50]; p.Rt = [15 - 30 * w, 50];
      p.dy = -4 * Math.abs(wav(t, 0.8)); p.tilt = 8 * dir; p.skew = -4 * dir; p.look = [3.5 * dir, 0]; p.mouth = 'open';
      p.extra = [dir > 0 ? 'speed-right' : 'speed-left']; break;
    }
    case 'sit':
      p.dy = 20; p.legL = -78; p.legR = 78; p.L = [-34, -20]; p.Rt = [34, 20]; p.skew = 1 * wav(t, 2.8);
      p.eyes = t % 5.6 > 4.6 ? 'happy' : 'open'; p.mouth = 'smile'; break;
    case 'point-down':
      p.Rt = [30, -6 + 3 * wav(t, 1.2)]; p.look = [2.4, 3.5]; p.tilt = 3; break;
    case 'loading':
      p.L = ikL(136, 150, 1); p.Rt = ikR(104, 150, -1);
      p.legR = 12 * Math.max(0, wav(t, 0.6)); p.look = [-2, -2.5]; p.mouth = 'small'; p.extra = ['typing']; break;
  }

  // (A perch is placed in drawRig, where the body's top is known.)
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------------------------

interface Arm extends ArmGeom {
  d: string;
  /** Direction of the forearm (or the wing), degrees from straight down, positive toward +x. */
  ang: number;
}

function arm(sx: number, sy: number, a1: number, a2: number, l1: number, l2: number): Arm {
  const ex = sx + l1 * Math.sin(a1 * R);
  const ey = sy + l1 * Math.cos(a1 * R);
  const hx = ex + l2 * Math.sin((a1 + a2) * R);
  const hy = ey + l2 * Math.cos((a1 + a2) * R);
  return { sx, sy, ex, ey, hx, hy, ang: a1 + a2, d: `M${f(sx)},${f(sy)} L${f(ex)},${f(ey)} L${f(hx)},${f(hy)}` };
}

/** A rigid wing: the hand sits at the tip, pointing where the arm would have reached. */
function wingArm(a: Arm, len: number): Arm {
  const ang = Math.atan2(a.hx - a.sx, a.hy - a.sy) / R;
  const hx = a.sx + len * Math.sin(ang * R);
  const hy = a.sy + len * Math.cos(ang * R);
  return { sx: a.sx, sy: a.sy, ex: (a.sx + hx) / 2, ey: (a.sy + hy) / 2, hx, hy, ang, d: `M${f(a.sx)},${f(a.sy)} L${f(hx)},${f(hy)}` };
}

function eyesSvg(body: CharacterBody, p: Pose, P: Palette): string {
  const fc = body.face;
  const line = fc.line ?? P.navy;
  const type = p.eyes;
  const look = p.look;
  let s = '';
  fc.eyes.forEach(([x, y], i) => {
    const side = i === 0 ? -1 : 1;
    let g = '';
    if (fc.style === 'oval') {
      if (type === 'happy' || (type === 'wink' && side === 1)) g += `<path d="M-7,3 Q0,-8 7,3" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      else if (type === 'wide') g += `<ellipse rx="6.8" ry="9.6" fill="${P.navy}"/><circle cx="2" cy="-3.4" r="2.4" fill="#ffffff"/><path d="M-7,-17 Q0,-22 7,-17" stroke="${line}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
      else if (type === 'sleep') g += `<path d="M-7,0 Q0,6 7,0" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      else g += `<ellipse cx="${f(look[0] * 0.7)}" cy="${f(look[1] * 0.7)}" rx="5.8" ry="7.8" fill="${P.navy}"/><circle cx="${f(look[0] * 0.7 + 1.8)}" cy="${f(look[1] * 0.7 - 2.8)}" r="2" fill="#ffffff"/>`;
      if (type === 'worried') g += `<path d="M${side * 8},-11 L${-side * 5},-16" stroke="${line}" stroke-width="3.5" stroke-linecap="round"/>`;
      if (type === 'think') g += side === 1
        ? `<path d="M-7,-15 Q0,-21 7,-16" stroke="${line}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
        : `<path d="M-6,-12 L6,-13" stroke="${line}" stroke-width="3.5" stroke-linecap="round"/>`;
    } else {
      const r = 10; // drawn at radius 10 and scaled to the body's eye size
      if (type === 'happy' || (type === 'wink' && side === 1)) g += `<path d="M-8,3 Q0,-10 8,3" stroke="${line}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`;
      else if (type === 'sleep') g += `<path d="M-8,0 Q0,6.5 8,0" stroke="${line}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
      else if (type === 'wide') g += `<circle r="${r * 1.2}" fill="#ffffff"/><circle r="${r * 0.42}" fill="${P.navy}"/><circle cx="2" cy="-2.6" r="2" fill="#ffffff"/><path d="M-8,-17 Q0,-23 8,-17" stroke="${line}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
      else g += `<circle r="${r}" fill="#ffffff"/><circle cx="${f(look[0] * 0.8)}" cy="${f(look[1] * 0.8)}" r="${f(r * 0.52)}" fill="${P.navy}"/><circle cx="${f(look[0] * 0.8 + r * 0.2)}" cy="${f(look[1] * 0.8 - r * 0.22)}" r="${f(r * 0.17)}" fill="#ffffff"/>`;
      if (type === 'worried') g += `<path d="M${f(-side * r)},${-r - 3} L${f(side * r * 0.6)},${-r - 9}" stroke="${line}" stroke-width="3" stroke-linecap="round"/>`;
      if (type === 'think') g += side === 1
        ? `<path d="M${f(-r * 0.8)},${-r - 8} Q0,${-r - 14} ${f(r * 0.8)},${-r - 9}" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round"/>`
        : `<path d="M${f(-r * 0.7)},${-r - 4} L${f(r * 0.7)},${-r - 5}" stroke="${line}" stroke-width="3" stroke-linecap="round"/>`;
    }
    const k = fc.style === 'oval' ? fc.size : fc.size / 10;
    s += `<g transform="translate(${f(x)} ${f(y)})${k === 1 ? '' : ` scale(${r3(k)})`}">${g}</g>`;
  });
  return s;
}

function mouthSvg(body: CharacterBody, p: Pose, P: Palette): string {
  const fc = body.face;
  const [x, y] = fc.mouth;
  let type = p.mouth;
  if (type === 'talk') type = (['open', 'small', 'grin'] as const)[Math.floor(p.t / 0.16) % 3];
  if (fc.beak) {
    // The myna's beak: closed at rest, open for open / grin; drawn around (120, 124).
    const open = type === 'open' || type === 'grin';
    const sp = `fill="${P.gold}" stroke="${P.goldDark}" stroke-width="1.4"`;
    const g = open
      ? `<path d="M-14,-2 Q0,-9 14,-2 L0,11 Z" ${sp}/><path d="M-10,13 L10,13 L0,26 Z" ${sp}/>`
      : `<path d="M-14,0 Q0,-7 14,0 Q8,14 0,23 Q-8,14 -14,0 Z" ${sp}/>`;
    return `<g transform="translate(${f(x)} ${f(y)})">${g}</g>`;
  }
  if (type === 'smile' && fc.smileAs === 'grin') type = 'grin';
  const col = P.navy;
  const sw = fc.mouthStroke ?? 3.6;
  let g: string;
  switch (type) {
    case 'grin': g = `<path d="M-9,-1 Q0,11 9,-1 Z" fill="${col}"/>`; break;
    case 'open': g = `<ellipse cy="3" rx="5.5" ry="6.5" fill="${col}"/>`; break;
    case 'wavy': g = `<path d="M-9,3 q2.25,-4 4.5,0 t4.5,0 t4.5,0 t4.5,0" stroke="${col}" stroke-width="${sw - 0.2}" fill="none" stroke-linecap="round"/>`; break;
    case 'small': g = `<path d="M-4,1 Q0,3.5 4,1" stroke="${col}" stroke-width="${sw - 0.2}" fill="none" stroke-linecap="round"/>`; break;
    default: g = `<path d="M-7,0 Q0,7 7,0" stroke="${col}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
  }
  const ms = fc.mouthScale;
  return `<g transform="translate(${f(x)} ${f(y)})${ms === 1 ? '' : ` scale(${ms})`}">${g}</g>`;
}

function defaultLeg(body: CharacterBody, a: { hx: number; hy: number; a: number; len: number; side: -1 | 1 }, P: Palette): LegOut {
  const fx = a.hx + a.len * Math.sin(a.a * R);
  const fy = a.hy + a.len * Math.cos(a.a * R);
  const w = body.legs.width ?? 5.5;
  const ft = body.legs.foot;
  const svg =
    `<path d="M${f(a.hx)},${f(a.hy)} L${f(fx)},${f(fy)}" stroke="${P.navy}" stroke-width="${w}" stroke-linecap="round"/>` +
    `<ellipse cx="${f(fx + a.side * ft.dx)}" cy="${f(fy + 2)}" rx="${ft.rx}" ry="${ft.ry}" fill="${P.navy}" transform="rotate(${f(-a.a * 0.4)} ${f(fx)} ${f(fy)})"/>`;
  return { svg, fx: fx + a.side * ft.dx, fy: fy + 2, padX: ft.rx, padY: ft.ry };
}

function dotsFx(t: number, P: Palette): string {
  let s = '';
  ([[182, 56, 4], [194, 40, 5.5], [208, 22, 7]] as const).forEach(([x, y, r], i) => {
    const o = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.6 - i * 0.9));
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${P.accentDark}" opacity="${f(o)}"/>`;
  });
  return s;
}

function zzzFx(t: number, P: Palette): string {
  // The z's are drawn as stroked paths (never text).
  let s = '';
  ([[176, 60, 13], [190, 42, 17], [206, 22, 21]] as const).forEach(([x, y, sz], i) => {
    const k = (t / 3 + i / 3) % 1;
    const yy = y - k * 8;
    const w = sz * 0.62;
    s += `<path d="M${f(x)},${f(yy - sz * 0.68)} h${f(w)} l${f(-w)},${f(sz * 0.68)} h${f(w)}" stroke="${P.accentDark}" stroke-width="${f(sz / 5)}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${f(1 - k * 0.6)}"/>`;
  });
  return s;
}

function confettiFx(t: number, P: Palette): string {
  let s = '';
  const bits: [number, number, string][] = [[40, 70, P.accent], [198, 62, P.gold], [58, 32, MIX.orange], [184, 28, MIX.blue], [28, 124, P.gold], [212, 116, P.accent]];
  bits.forEach(([x, y, c], i) => {
    const o = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i));
    s += i % 2
      ? `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${c}" opacity="${f(o)}" transform="rotate(${20 + i * 25} ${x + 3} ${y + 3})"/>`
      : `<circle cx="${x}" cy="${y}" r="4" fill="${c}" opacity="${f(o)}"/>`;
  });
  return s;
}

export interface RigOptions {
  mirror?: boolean;
  /** Debug and reference tests only: draw the kit's ground shadow. */
  shadow?: boolean;
  /** Debug and reference tests only: draw the perch ledge. */
  ledge?: boolean;
}

export interface RigResult {
  /** The character without floating effects (dots, confetti, z's, bursts): what the bounds describe. */
  core: string;
  /** The character with its effects. */
  full: string;
  anchors: CharacterAnchors;
}

export function drawRig(body: CharacterBody, action: CharacterAction, colors: CharacterColors, opts: RigOptions = {}): RigResult {
  const P = buildPalette(colors, body.defaults);
  const t = KEY_TIMES[action] ?? 0;
  const p = pose(action, t, body);
  const ctx = { P, p, id: `ch-${body.id}` };
  // A hop never takes the top of the character out of the canvas (tall bodies hop less).
  const bb0 = body.bbox(ctx);
  if (p.perch) {
    // Perching lifts the body so its bottom is the seat line; a tall body is lifted less so it stays in the canvas.
    p.baseY = -Math.max(0, Math.min(PERCH_LIFT, bb0[1] - 1)) - p.dy;
  } else {
    const topNow = bb0[1] + p.dy + p.baseY;
    if (topNow < 1) p.dy += 1 - topNow;
    // ...and sitting never pushes a low body (a trailing thread) out of the bottom.
    const bottomNow = bb0[3] + p.dy + p.baseY;
    if (bottomNow > 258) p.dy -= bottomNow - 258;
  }

  const sl = body.shoulders.l;
  const sr = body.shoulders.r;
  const L1 = 22 * body.armScale;
  const L2 = 20 * body.armScale;
  const ox = body.cx - 120;
  const oy = sl[1] - 132;
  const card = cardOf(body);
  const ro: Pt = body.nativeRows ? [0, 0] : [card.x - 80, card.y - 126];
  const wingLen = body.limb.wingLen;

  // ---- matrices ----
  const Mf: Mat = chain(translate(p.dx, p.dy + p.baseY), rotate(p.tilt, 120, 226));
  const bodyLocal: Mat = chain(translate(120, body.bottom), scale(Number(f(p.sx)), Number(f(p.sy))), skewX(Number(f(p.skew))), translate(-120, -body.bottom));
  const Mb: Mat = body.rot ? mul(bodyLocal, rotate(body.rot.deg, body.rot.cx, body.rot.cy)) : bodyLocal;
  const MfB = mul(Mf, Mb);
  const bounds = new Box();

  // ---- arms ----
  let armL: Arm;
  let armR: Arm;
  if (p.cover) {
    const aim = (sx: number, sy: number, tx: number, ty: number) => Math.atan2(tx - sx, ty - sy) / R;
    const [e0, e1] = body.face.eyes;
    armL = arm(sl[0], sl[1], aim(sl[0], sl[1], e0[0], e0[1]), 0, L1 * 0.91, L2 * 1.05);
    armR = p.coverPeek
      ? arm(sr[0], sr[1], aim(sr[0], sr[1], e1[0] + 2, e1[1] + 12), 0, L1 * 0.91, L2 * 1.05)
      : arm(sr[0], sr[1], aim(sr[0], sr[1], e1[0], e1[1]), 0, L1 * 0.91, L2 * 1.05);
  } else {
    armL = arm(sl[0], sl[1], p.L[0], p.L[1], L1, L2);
    armR = arm(sr[0], sr[1], p.Rt[0], p.Rt[1], L1, L2);
  }
  if (wingLen) {
    armL = wingArm(armL, wingLen);
    armR = wingArm(armR, wingLen);
  }
  // A hand holding something stays clear of the canvas edge (wide bodies would push a slip or a plane outside it).
  const holdsRight = p.slip || p.pen || p.plane === 'hand' || p.extra.some((e) => ['thumb', 'stamp-tool', 'magnifier', 'phone', 'remind'].includes(e));
  const maxX = holdsRight ? 208 : 241;
  if (armR.hx > maxX) {
    if (wingLen) {
      const ang = Math.asin(Math.max(-1, Math.min(1, (maxX - sr[0]) / wingLen))) / R;
      const dirY = Math.cos(armR.ang * R) >= 0 ? 1 : -1;
      const a2 = dirY > 0 ? ang : 180 - ang;
      armR = wingArm({ ...armR, hx: sr[0] + 10 * Math.sin(a2 * R), hy: sr[1] + 10 * Math.cos(a2 * R) }, wingLen);
    } else {
      const [a1, a2] = ik(sr, maxX, armR.hy, 1, L1, L2);
      armR = arm(sr[0], sr[1], a1, a2, L1, L2);
    }
  }

  // ---- legs ----
  const legLen = p.sit ? body.legs.len + 2 : body.legs.len;
  const legs: string[] = [];
  const legOuts: LegOut[] = [];
  const makeLeg = (h: Pt, a: number, side: -1 | 1, len: number): LegOut => {
    const args = { hx: h[0], hy: h[1], a, len, side, sit: p.sit, P };
    return body.legs.custom ? body.legs.custom(args) : defaultLeg(body, args, P);
  };
  const legBox = (o: LegOut, hx: number, hy: number) => {
    bounds.seg(Mf, hx, hy, o.fx, o.fy, body.legs.width ?? 5.5);
    bounds.ellipse(Mf, o.fx, o.fy, o.padX, o.padY);
  };
  ([[body.legs.hips.l, p.legL, -1], [body.legs.hips.r, p.legR, 1]] as const).forEach(([h, a, side]) => {
    const o = makeLeg(h, a, side as -1 | 1, legLen);
    legOuts.push(o);
    legs.push(o.svg);
    legBox(o, h[0], h[1]);
  });

  // ---- body ----
  const art = body.draw(ctx);
  const bb = bb0;
  bounds.rect(MfB, bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]);
  const face = eyesSvg(body, p, P) + cheeksSvg(body, P) + mouthSvg(body, p, P);
  const inside = art.art + face + (art.after ?? '');
  const bodyG =
    `<g transform="translate(120 ${f(body.bottom)}) scale(${f(p.sx)} ${f(p.sy)}) skewX(${f(p.skew)}) translate(-120 ${f(-body.bottom)})">` +
    (body.rot ? `<g transform="rotate(${body.rot.deg} ${body.rot.cx} ${body.rot.cy})">${inside}</g>` : inside) +
    `</g>`;

  // ---- limbs ----
  const lm = body.limb;
  const limb = (a: Arm, big: boolean): string => {
    if (lm.wingLen && lm.drawWing) return lm.drawWing(a, a.ang, P);
    const r = big ? lm.handBig : lm.hand;
    const fill = lm.handFill ? lm.handFill(P) : lm.color(P);
    const stroke = lm.handStroke ? ` stroke="${lm.handStroke(P)}" stroke-width="2"` : '';
    return `<path d="${a.d}" stroke="${lm.color(P)}" stroke-width="${lm.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${f(a.hx)}" cy="${f(a.hy)}" r="${r}" fill="${fill}"${stroke}/>`;
  };
  const limbBox = (a: Arm, big: boolean) => {
    if (lm.wingLen) {
      // The leaf is about 27 wide and as long as the wing.
      const m = chain(Mf, translate(a.sx, a.sy), rotate(-a.ang));
      bounds.rect(m, -13.5, 0, 27, lm.wingLen);
      return;
    }
    bounds.seg(Mf, a.sx, a.sy, a.ex, a.ey, lm.width);
    bounds.seg(Mf, a.ex, a.ey, a.hx, a.hy, lm.width);
    bounds.ellipse(Mf, a.hx, a.hy, big ? lm.handBig : lm.hand);
  };
  const limbs = limb(armL, p.cover) + limb(armR, p.cover);
  limbBox(armL, p.cover);
  limbBox(armR, p.cover);

  // ---- held items, front items, back items, effects ----
  const H = armR;
  const HL = armL;
  let held = '';
  let front = '';
  let back = '';
  let over = '';
  const mH = (x: number, y: number, deg = 0): Mat => chain(Mf, translate(x, y), rotate(deg));

  if (p.pen) {
    held = `<g transform="translate(${f(H.hx)} ${f(H.hy)}) rotate(-35)"><rect x="-3" y="-26" width="6" height="30" rx="2" fill="${P.accent}"/><path d="M-3,4 L0,11 L3,4 Z" fill="${P.navy}"/><rect x="-3" y="-26" width="6" height="6" rx="2" fill="${P.accentDark}"/></g>`;
    bounds.rect(mH(H.hx, H.hy, -35), -3, -26, 6, 37);
  }
  if (p.slip) {
    held = `<g transform="translate(${f(H.hx + 14)} ${f(H.hy - 6)}) rotate(8)"><rect x="-13" y="-16" width="26" height="32" rx="3" fill="${P.paper}" stroke="${P.edge}" stroke-width="1.4"/><rect x="-13" y="-16" width="26" height="7" fill="${P.accent}"/>${tick(1, 4, 0.6, P.accentDark, 3)}</g>`;
    bounds.rect(mH(H.hx + 14, H.hy - 6, 8), -13.7, -16.7, 27.4, 33.4);
  }
  const ex = p.extra;
  const cxs = 120 + ox;
  if (ex.includes('palms')) {
    const py = (H.hy + HL.hy) / 2 - 4;
    front += `<ellipse cx="${f(cxs)}" cy="${f(py)}" rx="6" ry="11" fill="${P.navy}"/>`;
    bounds.ellipse(Mf, cxs, py, 6, 11);
  }
  if (ex.includes('thumb')) {
    front += `<g transform="translate(${f(H.hx)} ${f(H.hy)})"><rect x="-7" y="-6" width="14" height="13" rx="5" fill="${P.navy}"/><rect x="-3" y="-17" width="6" height="14" rx="3" fill="${P.navy}"/></g>`;
    bounds.rect(mH(H.hx, H.hy), -7, -17, 14, 24);
  }
  if (ex.includes('sparkle')) over += `<path d="M${f(H.hx + 18)},${f(H.hy - 26)} l3,7 l7,3 l-7,3 l-3,7 l-3,-7 l-7,-3 l7,-3 z" fill="${P.gold}"/>`;
  if (ex.includes('burst-clap')) over += `<path d="M${f(cxs)},${f(128 + oy)} v-10 M${f(cxs - 12)},${f(132 + oy)} l-6,-7 M${f(cxs + 12)},${f(132 + oy)} l6,-7" stroke="${P.gold}" stroke-width="3" stroke-linecap="round"/>`;
  if (ex.includes('exclaim')) over += `<g transform="translate(186 40)"><circle r="14" fill="${P.gold}"/><rect x="-2.5" y="-8" width="5" height="10" rx="2.5" fill="${P.navy}"/><circle cy="6" r="2.6" fill="${P.navy}"/></g>`;
  if (ex.includes('sweat')) over += `<path d="M176,62 C171,72 170,78 176,80 C182,78 181,72 176,62 Z" fill="${MIX.sweat}" stroke="${P.accentDark}" stroke-width="1.5"/>`;
  if (ex.includes('heart')) {
    const k = p.heartK || 1;
    front += `<g transform="translate(${f(cxs)} ${f(152 + oy)}) scale(${f(k)})"><path d="M0,16 C-22,2 -20,-16 -9,-16 C-3,-16 0,-11 0,-8 C0,-11 3,-16 9,-16 C20,-16 22,2 0,16 Z" fill="${MIX.heart}" stroke="${MIX.heartDark}" stroke-width="2"/></g>`;
    bounds.rect(chain(Mf, translate(cxs, 152 + oy), scale(k)), -22, -16, 44, 32);
  }
  if (ex.includes('stamp-tool')) {
    front += `<g transform="translate(${f(H.hx)} ${f(H.hy)})"><rect x="-4" y="-22" width="8" height="18" rx="4" fill="${P.accent}"/><circle cy="-24" r="6" fill="${P.accentDark}"/><rect x="-11" y="-5" width="22" height="9" rx="2.5" fill="${P.navy}"/></g>`;
    bounds.rect(mH(H.hx, H.hy), -11, -30, 22, 34);
  }
  if (ex.includes('burst-stamp')) over += `<path d="M${f(168 + ox)},${f(184 + ro[1])} l10,-4 M${f(168 + ox)},${f(196 + ro[1])} l11,3 M${f(160 + ox)},${f(206 + ro[1])} l5,8" stroke="${P.gold}" stroke-width="3" stroke-linecap="round"/>`;
  if (ex.includes('magnifier')) {
    const lx = H.hx - 10;
    const ly = H.hy - 20;
    front += `<path d="M${f(H.hx)},${f(H.hy)} L${f(lx + 6)},${f(ly + 9)}" stroke="${P.navy}" stroke-width="6" stroke-linecap="round"/><circle cx="${f(lx)}" cy="${f(ly)}" r="14" fill="#ffffff" fill-opacity=".35" stroke="${P.navy}" stroke-width="4"/><path d="M${f(lx - 7)},${f(ly - 4)} q4,-6 10,-6" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    bounds.ellipse(Mf, lx, ly, 16);
    bounds.seg(Mf, H.hx, H.hy, lx + 6, ly + 9, 6);
  }
  if (ex.includes('remind')) {
    over += `<g transform="translate(${f(H.hx + 18)} ${f(H.hy - 22)})"><path d="M-13,-12 h26 a5,5 0 0 1 5,5 v14 a5,5 0 0 1 -5,5 h-14 l-7,7 v-7 h-5 a5,5 0 0 1 -5,-5 v-14 a5,5 0 0 1 5,-5 z" fill="${P.accent}"/><rect x="-2" y="-8" width="4" height="9" rx="2" fill="#ffffff"/><circle cy="5" r="2.3" fill="#ffffff"/></g>` +
      `<path d="M${f(H.hx - 10)},${f(H.hy - 6)} a10,10 0 0 1 0,-14 M${f(H.hx - 15)},${f(H.hy - 2)} a16,16 0 0 1 0,-22" stroke="${P.accentDark}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>`;
  }
  let signRect: { x: number; y: number; w: number; h: number } | undefined;
  if (ex.includes('sign')) {
    const s = body.sign;
    // A blank placard: code draws the offer text on it. Only a colour strip at the top.
    back += `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8" fill="#ffffff" stroke="${P.edge}" stroke-width="2"/><rect x="${s.x}" y="${s.y}" width="${s.w}" height="10" rx="5" fill="${P.accent}"/>`;
    bounds.rect(Mf, s.x - 1, s.y - 1, s.w + 2, s.h + 2);
    signRect = s;
  }
  if (ex.includes('phone')) {
    front += `<g transform="translate(${f(H.hx)} ${f(H.hy - 14)}) rotate(-8)"><rect x="-13" y="-22" width="26" height="44" rx="6" fill="${P.navy}"/><rect x="-10" y="-17" width="20" height="33" rx="3" fill="#ffffff"/><rect x="-8" y="-13" width="12" height="6" rx="3" fill="${P.accentLight}"/><rect x="-4" y="-4" width="12" height="6" rx="3" fill="${P.accent}"/><rect x="-8" y="5" width="10" height="6" rx="3" fill="${P.accentLight}"/><circle cx="11" cy="-20" r="4" fill="${MIX.heart}"/></g>`;
    bounds.rect(mH(H.hx, H.hy - 14, -8), -13, -24, 28, 46);
  }
  if (p.plane != null) {
    const plane = (x: number, y: number, r: number, o: number) =>
      `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(r)})" opacity="${f(o)}"><path d="M-14,0 L14,-6 L-4,8 Z" fill="#ffffff" stroke="${P.edge}" stroke-width="1.2"/><path d="M-14,0 L14,-6 L-2,1 Z" fill="${P.accentLight}" stroke="${P.edge}" stroke-width="1.2"/></g>`;
    if (p.plane === 'hand') {
      front += plane(H.hx + 8, H.hy - 4, -10, 1);
      bounds.rect(mH(H.hx + 8, H.hy - 4, -10), -14, -6, 28, 14);
    } else {
      const k = p.plane;
      const px = Math.min(lerp(H.hx + 10, 236, k), 226);
      const py = lerp(H.hy - 6, 30, k) - 20 * Math.sin(Math.PI * k);
      over += plane(px, py, -18, 1 - k * 0.6) + `<path d="M${f(px - 30)},${f(py + 10)} h-16" stroke="${P.line}" stroke-width="2" stroke-linecap="round" opacity="${f(1 - k)}"/>`;
    }
  }
  if (ex.includes('speed-right')) over += `<path d="M34,110 h22 M26,132 h28 M36,154 h20" stroke="${P.line}" stroke-width="3" stroke-linecap="round"/>`;
  if (ex.includes('speed-left')) over += `<path d="M206,110 h-22 M214,132 h-28 M204,154 h-20" stroke="${P.line}" stroke-width="3" stroke-linecap="round"/>`;
  if (ex.includes('typing')) {
    [0, 1, 2].forEach((i) => {
      const o = 0.3 + 0.7 * Math.max(0, Math.sin(2 * Math.PI * (t / 1.2) - i * 0.9));
      over += `<circle cx="${108 + 12 * i}" cy="34" r="4.5" fill="${P.accentDark}" opacity="${f(o)}"/>`;
    });
  }

  // The checklist card of a body without native rows (check-off, write, stamp only).
  if (p.ledger && !body.nativeRows) {
    const c = card;
    const showStamp = p.stamp > 0;
    back +=
      `<rect x="${f(c.x)}" y="${f(c.y)}" width="${c.w}" height="${c.h}" rx="6" fill="${P.paper}" stroke="${P.edge}" stroke-width="1.5"/>` +
      `<rect x="${f(c.x)}" y="${f(c.y)}" width="${c.w}" height="8" rx="4" fill="${P.accent}"/>` +
      `<g transform="translate(${f(ro[0])} ${f(ro[1])})">${rowsSvg(p, P)}${showStamp ? stampSvg(P) : ''}</g>`;
    bounds.rect(Mf, c.x - 1, c.y - 1, c.w + 2, c.h + 2);
  }

  // ---- floating effects (outside the bounds) ----
  let fxOut = '';
  if (p.props.includes('dots')) fxOut += dotsFx(t, P);
  if (p.props.includes('zzz')) fxOut += zzzFx(t, P);
  if (p.props.includes('confetti')) fxOut += confettiFx(t, P);

  const ledge = opts.ledge && p.perch
    ? `<rect x="14" y="180" width="212" height="14" rx="7" fill="${P.navy}"/><rect x="14" y="180" width="212" height="4" rx="2" fill="#ffffff" opacity=".14"/>`
    : '';
  const shadow = opts.shadow
    ? `<ellipse cx="120" cy="${p.sit ? 212 : 246}" rx="${f(48 + p.dy * 0.5)}" ry="6.5" fill="${P.navy}" opacity="${p.sit ? 0 : 0.12}"/>`
    : '';
  const figTransform = `translate(${f(p.dx)} ${f(p.dy + p.baseY)}) rotate(${f(p.tilt)} 120 226)`;
  const figCore = `<g transform="${figTransform}">${legs.join('')}${bodyG}${back}${limbs}${held}${front}</g>`;
  const figFull = `<g transform="${figTransform}">${legs.join('')}${bodyG}${back}${limbs}${held}${front}${over}</g>`;

  // ---- flip (the peek pose, and the caller's mirror) ----
  const flipped = p.flip !== !!opts.mirror;
  const wrap = (s: string) => (flipped ? `<g transform="translate(240 0) scale(-1 1)">${s}</g>` : s);
  // Keep a requested mirror on top of the peek pose's own flip: they cancel, as in the kit.
  const core = wrap(ledge + shadow + figCore);
  const full = wrap(ledge + shadow + figFull + fxOut);

  // ---- anchors ----
  const fl = (pt: Pt): Pt => (flipped ? [240 - pt[0], pt[1]] : pt);
  const pf = (x: number, y: number): Pt => fl(apply(Mf, x, y));
  const hl = pf(armL.hx, armL.hy);
  const hr = pf(armR.hx, armR.hy);
  const [e0, e1] = body.face.eyes;
  const fcp = fl(apply(MfB, (e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2));
  const rest = makeLeg(body.legs.hips.l, 0, -1, body.legs.len);
  const groundRest = rest.fy + rest.padY;
  let feetPt: Pt;
  if (p.perch) feetPt = fl(apply(Mf, 120, body.bottom));
  else if (action === 'sit') feetPt = fl(apply(Mf, 120, Math.max(...legOuts.map((o) => o.fy + o.padY))));
  else feetPt = fl([120, groundRest]);
  const bx = bounds.toRect();
  const bxMin = fl([bx.x, 0])[0];
  const bxMax = fl([bx.x + bx.w, 0])[0];
  const anchors: CharacterAnchors = {
    bounds: { x: r1(Math.min(bxMin, bxMax)), y: r1(bx.y), w: r1(bx.w), h: r1(bx.h) },
    handL: flipped ? { x: r1(hr[0]), y: r1(hr[1]) } : { x: r1(hl[0]), y: r1(hl[1]) },
    handR: flipped ? { x: r1(hl[0]), y: r1(hl[1]) } : { x: r1(hr[0]), y: r1(hr[1]) },
    face: { x: r1(fcp[0]), y: r1(fcp[1]) },
    feet: { x: r1(feetPt[0]), y: r1(feetPt[1]) },
  };
  if (signRect) {
    const inner = { x: signRect.x + 6, y: signRect.y + 14, w: signRect.w - 12, h: signRect.h - 20 };
    const a = apply(Mf, inner.x, inner.y);
    const b = apply(Mf, inner.x + inner.w, inner.y + inner.h);
    const a2 = fl(a);
    const b2 = fl(b);
    anchors.sign = { x: r1(Math.min(a2[0], b2[0])), y: r1(Math.min(a[1], b[1])), w: r1(Math.abs(b2[0] - a2[0])), h: r1(Math.abs(b[1] - a[1])) };
  }
  if (action === 'point-left' || action === 'point-right' || action === 'point-up' || action === 'point-down') {
    const a = action === 'point-left' ? armL : armR;
    let vx = a.hx - a.ex;
    let vy = a.hy - a.ey;
    if (lm.wingLen) { vx = a.hx - a.sx; vy = a.hy - a.sy; }
    const n = Math.hypot(vx, vy) || 1;
    // rotate by the figure's tilt, flip with the character
    const tr = p.tilt * R;
    const rx = (vx / n) * Math.cos(tr) - (vy / n) * Math.sin(tr);
    const ry = (vx / n) * Math.sin(tr) + (vy / n) * Math.cos(tr);
    anchors.pointing = { dx: r3(flipped ? -rx : rx) + 0, dy: r3(ry) + 0 };
  }
  return { core, full, anchors };
}

function cheeksSvg(body: CharacterBody, P: Palette): string {
  const c = body.face.cheeks;
  if (!c) return '';
  return c.pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${c.r}" fill="${P.blush}" opacity=".75"/>`).join('');
}
