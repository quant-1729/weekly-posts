// Tween as one of the brand characters (CH-1). Tween keeps its own rig (src/lib/mascot/tween.ts); this file only
// adapts it to the shared drawing shape: the same canvas (viewBox -10 0 260 260), anchors, and every action.
//
// Tween's own 18 poses are drawn by the existing rig, untouched: the output is that rig's markup inside one
// `<g transform="translate scale">` that fits Tween's 550-unit canvas into ours. The 23 actions Tween lacks map to the
// nearest Tween pose (table below). Only `hold-sign` adds drawing: a blank placard with two ink hands on it (Tween's
// arms are drawn behind its body, so the placard needs its own hands), and `point-down` lowers Tween's pointing arm.

import { tweenColorsFor, type TweenColors } from '@/lib/mascot/colors';
import { POSE_SPECS, tweenParts, type PoseSpec, type TweenPose } from '@/lib/mascot/tween';
import { normaliseHex } from '@/lib/render/color';
import { ik } from './rig';
import type { CharacterAction, CharacterAnchors, CharacterColors, CharacterDrawing } from './types';
import { Box, R, apply, chain, r1, rotate, scale, translate, type Mat, type Pt } from './util';

/** Tween's 550-unit rig space fitted into the 260-unit character canvas. */
export const TWEEN_FIT = { scale: 0.46, tx: 28, ty: 29 } as const;

export interface TweenMapping {
  pose: TweenPose;
  /** Changes some of the pose's values. Only used for actions Tween does not have. */
  tweak?: Partial<PoseSpec>;
  /** Adds the blank placard and two hands. */
  sign?: boolean;
}

// Hold-sign: the arms reach the placard's sides (wrist targets); the placard sits below the face, in front of the belly.
const SIGN = { x: 64, y: 298, w: 272, h: 100 } as const;
const HAND_L: Pt = [68, 346];
const HAND_R: Pt = [332, 346];
const SH_L: Pt = [108, 256];
const SH_R: Pt = [292, 256];

/** Tween's arm angles (it rotates the left arm by +angle toward -x, the right arm by -angle toward +x) for a wrist target. */
function tweenArm(shoulder: Pt, target: Pt, bend: number): [number, number] {
  const [a1, a2] = ik(shoulder, target[0], target[1], bend, 54, 42);
  return [-a1, -a2];
}
const SIGN_ARM_L = tweenArm(SH_L, [HAND_L[0] + 2, HAND_L[1] - 22], -1);
const SIGN_ARM_R = tweenArm(SH_R, [HAND_R[0] - 2, HAND_R[1] - 22], 1);

/**
 * Where each action comes from. Tween's own poses map to themselves.
 * Mapped (Tween lacks these): nearest pose, in words:
 *   point-down: point-right with the arm lowered; sit: perch (sits on the seat line); land: idle, a little lower;
 *   nod / shake-no: idle (worried face for no); thumbs-up, remind: wave; clap, jump: celebrate; namaste, heart, send: present
 *   (no letter for namaste and heart); surprised, oops: shrug; check-off, write, stamp: reach (the pen); search, loading: think;
 *   phone: talk; run-right / run-left: walk-right / walk-left leaning harder; hold-sign: idle with a blank placard.
 */
export const TWEEN_MAP: Record<CharacterAction, TweenMapping> = {
  idle: { pose: 'idle' },
  'walk-right': { pose: 'walk-right' },
  'walk-left': { pose: 'walk-left' },
  wave: { pose: 'wave' },
  'point-right': { pose: 'point-right' },
  'point-left': { pose: 'point-left' },
  'point-up': { pose: 'point-up' },
  'point-down': { pose: 'point-right', tweak: { uar: -34, far: -4, ex: 4, ey: 9 } },
  talk: { pose: 'talk' },
  think: { pose: 'think' },
  celebrate: { pose: 'celebrate' },
  sleep: { pose: 'sleep' },
  shrug: { pose: 'shrug' },
  peek: { pose: 'peek' },
  reach: { pose: 'reach' },
  present: { pose: 'present' },
  climb: { pose: 'climb' },
  perch: { pose: 'perch' },
  sit: { pose: 'perch' },
  cover: { pose: 'cover' },
  land: { pose: 'idle', tweak: { face: 'happy', drop: 4 } },
  namaste: { pose: 'present', tweak: { letter: false } },
  'thumbs-up': { pose: 'wave' },
  clap: { pose: 'celebrate' },
  nod: { pose: 'idle', tweak: { face: 'happy' } },
  'shake-no': { pose: 'idle', tweak: { face: 'worried', tilt: 2 } },
  surprised: { pose: 'shrug', tweak: { face: 'neutral', drop: 0, tilt: 0 } },
  oops: { pose: 'shrug' },
  heart: { pose: 'present', tweak: { letter: false } },
  'check-off': { pose: 'reach' },
  write: { pose: 'reach' },
  stamp: { pose: 'reach', tweak: { face: 'happy' } },
  search: { pose: 'think' },
  remind: { pose: 'wave' },
  'hold-sign': {
    pose: 'idle',
    tweak: { face: 'happy', ual: SIGN_ARM_L[0], fal: SIGN_ARM_L[1], uar: SIGN_ARM_R[0], far: SIGN_ARM_R[1] },
    sign: true,
  },
  phone: { pose: 'talk' },
  send: { pose: 'present' },
  jump: { pose: 'celebrate' },
  'run-right': { pose: 'walk-right', tweak: { lean: 7, turn: 16, ual: 60, fal: 30, uar: -60, far: -30 } },
  'run-left': { pose: 'walk-left', tweak: { lean: -7, turn: -16, ual: 60, fal: 30, uar: -60, far: -30 } },
  loading: { pose: 'think' },
};

/** Tween's palette from the shared brand colours: the scarf takes the accent; the coral props take `body` when given. */
export function tweenColorsFromCharacter(c: CharacterColors): TweenColors {
  const base = tweenColorsFor(null, normaliseHex(c.accent, '#2B4CFF'));
  return {
    ...base,
    scarfDark: normaliseHex(c.accentDark, base.scarfDark),
    coral: c.body ? normaliseHex(c.body, base.coral) : base.coral,
  };
}

const M_FIT: Mat = chain(translate(TWEEN_FIT.tx, TWEEN_FIT.ty), scale(TWEEN_FIT.scale));

interface ArmPts {
  elbow: Pt;
  wrist: Pt;
  hand: Pt;
  dir: Pt;
  /** Matrix of the hand's frame (origin at the wrist, y along the forearm), in the bob group. */
  m: Mat;
}

function armPts(shoulder: Pt, upper: number, fore: number): ArmPts {
  const m1 = chain(translate(shoulder[0], shoulder[1]), rotate(upper));
  const m2 = chain(m1, translate(0, 54), rotate(fore));
  const m3 = chain(m2, translate(0, 42));
  const elbow = apply(m1, 0, 54);
  const wrist = apply(m2, 0, 42);
  const hand = apply(m3, 0, 20);
  const th = (upper + fore) * R;
  return { elbow, wrist, hand, dir: [-Math.sin(th), Math.cos(th)], m: m3 };
}

export function drawTween(action: CharacterAction, colors: CharacterColors, opts: { mirror?: boolean } = {}): CharacterDrawing {
  const map = TWEEN_MAP[action] ?? TWEEN_MAP.idle;
  const spec: PoseSpec = { ...POSE_SPECS[map.pose], ...(map.tweak ?? {}) };
  const tc = tweenColorsFromCharacter(colors);
  const parts = tweenParts({ pose: map.pose, colors: tc, tweak: map.tweak });

  // ---- geometry in Tween's rig space ----
  const bob: Mat = chain(rotate(spec.lean, 200, 440), translate(0, spec.drop));
  const flipRig: Mat = spec.mirror ? chain(translate(400, 0), scale(-1, 1)) : [1, 0, 0, 1, 0, 0];
  const toCanvas = (m: Mat): Mat => chain(M_FIT, flipRig, m);
  const mb = toCanvas(bob);
  const L = armPts(SH_L, spec.ual, spec.fal);
  const R_ = armPts(SH_R, spec.uar, spec.far);

  const box = new Box();
  box.rect(mb, 96, 88, 208, 262);
  // legs
  ([[172, spec.ll, -14], [228, spec.lr, 14]] as const).forEach(([hx, ang, foot]) => {
    const ml = chain(mb, translate(hx, 340), rotate(ang));
    box.rect(ml, -8.5, 0, 17, 86);
    box.ellipse(ml, foot, 95, 29, 12.5);
  });
  // arms
  for (const [sh, upper, fore, letter] of [
    [SH_L, spec.ual, spec.fal, false],
    [SH_R, spec.uar, spec.far, spec.letter],
  ] as const) {
    const m1 = chain(mb, translate(sh[0], sh[1]), rotate(upper));
    const m2 = chain(m1, translate(0, 54), rotate(fore));
    const m3 = chain(m2, translate(0, 42));
    box.rect(m1, -10, -10, 20, 74);
    box.rect(m2, -7.5, -7.5, 15, 50);
    box.rect(m3, -17, 0, 34, 38);
    if (spec.index) box.rect(m3, -4.4, 22, 8.8, 26);
    if (letter) box.rect(m3, -25, 14, 50, 34);
  }
  // feather, scarf, cover hands
  box.ellipse(chain(mb, translate(268, 112), rotate(22), scale(0.84)), 0, -73, 42, 80);
  box.rect(chain(mb, translate(126, 314), rotate(spec.tail)), -30, -8, 52, 105);
  box.rect(mb, 88, 284, 224, 46);
  if (spec.cover) box.rect(mb, 105, 148, 190, 90);

  let extra = '';
  let signAnchor: CharacterAnchors['sign'];
  if (map.sign) {
    const s = SIGN;
    const ink = tc.ink;
    extra +=
      `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="16" fill="#ffffff" stroke="${tc.inkLight}" stroke-width="5"/>` +
      `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="22" rx="11" fill="${tc.scarf}"/>` +
      `<ellipse cx="${HAND_L[0]}" cy="${HAND_L[1]}" rx="15" ry="19" fill="${ink}" stroke="${tc.inkLight}" stroke-width="2.5"/>` +
      `<ellipse cx="${HAND_R[0]}" cy="${HAND_R[1]}" rx="15" ry="19" fill="${ink}" stroke="${tc.inkLight}" stroke-width="2.5"/>`;
    box.rect(mb, s.x - 3, s.y - 3, s.w + 6, s.h + 6);
    box.ellipse(mb, HAND_L[0], HAND_L[1], 17, 21);
    box.ellipse(mb, HAND_R[0], HAND_R[1], 17, 21);
    const a = apply(mb, s.x + 14, s.y + 30);
    const b = apply(mb, s.x + s.w - 14, s.y + s.h - 14);
    signAnchor = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
  }

  // ---- assemble ----
  const flipped = !!opts.mirror;
  // `extra` only exists for hold-sign, which has no lean, drop or mirror: it can be drawn in plain rig space.
  const inner = `<g transform="translate(${TWEEN_FIT.tx} ${TWEEN_FIT.ty}) scale(${TWEEN_FIT.scale})">${parts}${extra}</g>`;
  const body = flipped ? `<g transform="translate(240 0) scale(-1 1)">${inner}</g>` : inner;

  const fl = (p: Pt): Pt => (flipped ? [240 - p[0], p[1]] : p);
  const toPix = (p: Pt): Pt => fl(apply(mb, p[0], p[1]));
  // Tween's left arm is on the screen's left unless the pose mirrors it.
  const pl = toPix(L.hand);
  const pr = toPix(R_.hand);
  const screenSwap = spec.mirror !== flipped;
  const [handL, handR] = screenSwap ? [pr, pl] : [pl, pr];
  const faceM = chain(mb, translate(spec.turn, 0), rotate(spec.tilt, 200, 200));
  const face = fl(apply(faceM, 200, 190));
  const seatY = map.pose === 'perch' ? 350 : 447.5;
  const feetP = toPix([200, seatY]);

  const bnd = box.toRect();
  const bx0 = flipped ? 240 - (bnd.x + bnd.w) : bnd.x;
  const anchors: CharacterAnchors = {
    bounds: { x: r1(bx0), y: r1(bnd.y), w: r1(bnd.w), h: r1(bnd.h) },
    handL: { x: r1(handL[0]), y: r1(handL[1]) },
    handR: { x: r1(handR[0]), y: r1(handR[1]) },
    face: { x: r1(face[0]), y: r1(face[1]) },
    feet: { x: r1(feetP[0]), y: r1(feetP[1]) },
  };
  if (signAnchor) {
    const sx = flipped ? 240 - (signAnchor.x + signAnchor.w) : signAnchor.x;
    anchors.sign = { x: r1(sx), y: r1(signAnchor.y), w: r1(signAnchor.w), h: r1(signAnchor.h) };
  }
  if (action === 'point-left' || action === 'point-right' || action === 'point-up' || action === 'point-down') {
    const a = action === 'point-left' ? L : R_;
    // direction in rig space -> bob rotation -> mirrors
    const th = spec.lean * R;
    let dx = a.dir[0] * Math.cos(th) - a.dir[1] * Math.sin(th);
    const dy = a.dir[0] * Math.sin(th) + a.dir[1] * Math.cos(th);
    if (spec.mirror) dx = -dx;
    if (flipped) dx = -dx;
    const n = Math.hypot(dx, dy) || 1;
    anchors.pointing = { dx: Math.round((dx / n) * 1000) / 1000 + 0, dy: Math.round((dy / n) * 1000) / 1000 + 0 };
  }
  return { body, anchors };
}
