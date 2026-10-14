// Tween, drawn as a still SVG (D9). Pure and server-safe: no React, no CSS variables, no animation.
//
// This is a port of the owner's Tween rig (vendor/tween-mascot-kit/source/components/mascot/TweenRig.tsx).
// The rig is posed by CSS variables and CSS transforms per `data-state` (rig.css). resvg cannot apply those, so
// each pose's values are turned into SVG `transform` attributes with the same pivots:
//   shoulders (108,256) and (292,256), elbows 54 units down, hips (172,340) and (228,340), scarf tail (126,314),
//   body bob/lean about (200,440), face tilt about (200,200), feather (266,112; it only moves while animating).
// The reference test (tests/mascot/tween-reference.test.ts) compares every pose with the kit's own PNG renders.
// The canvas is the kit's 550 x 550 one (viewBox -75 -80 550 550), so a pose stands on the same spot in every file.

import type { TweenColors } from './colors';
import { DEFAULT_TWEEN_COLORS } from './colors';

export const TWEEN_VIEWBOX = '-75 -80 550 550';
export const TWEEN_CANVAS = 550;

/** Every still pose the renderer can draw. The post poses (see poses.ts) are a subset. */
export const TWEEN_POSES = [
  'idle',
  'talk',
  'wave',
  'point-left',
  'point-right',
  'point-up',
  'think',
  'celebrate',
  'shrug',
  'sleep',
  'peek',
  'reach',
  'present',
  'climb',
  'perch',
  'cover',
  'walk-left',
  'walk-right',
] as const;
export type TweenPose = (typeof TWEEN_POSES)[number];

type Face = 'neutral' | 'happy' | 'think' | 'joy' | 'sleep' | 'worried';

/** One pose: the values rig.css sets per state, plus what the state shows (face, props). */
export interface PoseSpec {
  face: Face;
  /** Upper and fore arm angles in degrees: left arm (screen left) and right arm. */
  ual: number;
  fal: number;
  uar: number;
  far: number;
  /** Leg angles. */
  ll: number;
  lr: number;
  /** Face shift in px, body lean and face tilt in degrees, body drop in px, scarf tail angle. */
  turn: number;
  lean: number;
  tilt: number;
  drop: number;
  tail: number;
  /** Where the pupils look. */
  ex: number;
  ey: number;
  /** Extended index finger on this arm. */
  index: 'l' | 'r' | null;
  props: 'dots' | 'zs' | 'confetti' | null;
  letter: boolean;
  cover: boolean;
  /** The mouth shows the open "talking" shape. */
  talking: boolean;
  /** Mirrored about the body centre (the peek pose). */
  mirror: boolean;
}

const REST: PoseSpec = {
  face: 'neutral',
  ual: 24,
  fal: 10,
  uar: -24,
  far: -10,
  ll: 0,
  lr: 0,
  turn: 0,
  lean: 0,
  tilt: 0,
  drop: 0,
  tail: 0,
  ex: 0,
  ey: 0,
  index: null,
  props: null,
  letter: false,
  cover: false,
  talking: false,
  mirror: false,
};

const pose = (over: Partial<PoseSpec>): PoseSpec => ({ ...REST, ...over });

/** The values below are rig.css, one line per `[data-state]` rule. */
export const POSE_SPECS: Record<TweenPose, PoseSpec> = {
  idle: pose({}),
  talk: pose({ uar: -64, far: -46, talking: true }),
  wave: pose({ face: 'happy', uar: -150, far: -20, tilt: -3 }),
  'point-right': pose({ uar: -90, far: 0, turn: 9, ex: 8, ey: -1, lean: 2, index: 'r' }),
  'point-left': pose({ ual: 90, fal: 0, turn: -9, ex: -8, ey: -1, lean: -2, index: 'l' }),
  'point-up': pose({ uar: -168, far: -4, ex: 5, ey: -9, tilt: -2, index: 'r' }),
  think: pose({ face: 'think', uar: -80, far: -118, ex: 7, ey: -9, tilt: -4, turn: 3, props: 'dots' }),
  celebrate: pose({ face: 'joy', ual: 150, fal: 14, uar: -150, far: -14, ll: 12, lr: -12, props: 'confetti' }),
  shrug: pose({ face: 'worried', ual: 46, fal: 80, uar: -46, far: -80, tilt: 4, drop: 2, ex: -3, ey: 2 }),
  sleep: pose({ face: 'sleep', ual: 16, fal: 4, uar: -16, far: -4, drop: 8, tilt: 5, turn: 2, props: 'zs' }),
  peek: pose({ uar: -118, far: -34, ex: -7, ey: -2, tilt: -5, mirror: true }),
  reach: pose({ face: 'think', uar: 18, far: -64, ex: -4, ey: 8, tilt: 4, drop: 3 }),
  present: pose({ face: 'happy', uar: -112, far: -38, ex: 6, ey: -4, tilt: -3, turn: 4, letter: true }),
  climb: pose({ ual: 165, fal: 10, uar: -165, far: -10, ey: -9 }),
  perch: pose({ face: 'happy', ual: 58, fal: -30, uar: -58, far: 30, ey: 4, tilt: -2 }),
  // The kit's still frame of the walk cycle: --walk is 1 but the stride and swing loops are removed, so the legs and arms rest;
  // what remains is the lean, the face turned toward travel, the look direction and the scarf tail trailing behind.
  'walk-right': pose({ turn: 12, lean: 3, tail: 20, ex: 8, ey: 1 }),
  'walk-left': pose({ turn: -12, lean: -3, tail: -20, ex: -8, ey: 1 }),
  cover: pose({ face: 'happy', ual: -140, fal: 0, uar: 140, far: 0, ey: -9, ex: 2, drop: 2, cover: true }),
};

export function isTweenPose(v: unknown): v is TweenPose {
  return typeof v === 'string' && (TWEEN_POSES as readonly string[]).includes(v);
}

// Feather colours: a real peacock feather, the only teal and gold in the brand. Not brandable.
const TEAL = '#119C9A';
const TEAL_DARK = '#0B6F73';
const TEAL_LIGHT = '#3CC6A8';
const GOLD = '#F3B63A';
const ORANGE = '#F26A21';
const EYE_BLUE = '#1D5FA8';
const WHITE = '#FFFFFF';

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const rot = (deg: number, cx = 0, cy = 0) => (deg === 0 ? '' : cx === 0 && cy === 0 ? `rotate(${n(deg)})` : `rotate(${n(deg)} ${cx} ${cy})`);

function arm(side: 'l' | 'r', x: number, upper: number, fore: number, p: PoseSpec, c: TweenColors): string {
  const t = side === 'l' ? 1 : -1;
  const pointing = p.index === side;
  const hand =
    `<path d="M-6 0 C-12 8 -14 22 -9 31 C-5 37 5 37 9 31 C14 22 12 8 6 0 Z" fill="${c.ink}"/>` +
    `<ellipse cx="${t * 11}" cy="9" rx="5" ry="9.5" fill="${c.ink}" transform="rotate(${t * -28} ${t * 11} 9)"/>`;
  const index = pointing ? `<rect x="-4.4" y="22" width="8.8" height="26" rx="4.4" fill="${c.ink}"/>` : '';
  const fingers = pointing
    ? ''
    : `<g stroke="${c.inkLight}" stroke-width="2.2" stroke-linecap="round" fill="none"><path d="M-3.4 22 V30"/><path d="M3.4 22 V30"/></g>`;
  const letter =
    side === 'r' && p.letter
      ? `<rect x="-25" y="14" width="50" height="34" rx="4" fill="${WHITE}" stroke="${c.ink}" stroke-width="3"/>` +
        `<path d="M-23 17 L0 34 L23 17" fill="none" stroke="${c.ink}" stroke-width="3" stroke-linejoin="round"/>` +
        `<circle cx="0" cy="34" r="5" fill="${c.coral}"/>`
      : '';
  return (
    `<g transform="translate(${x} 256)"><g${upper ? ` transform="${rot(upper)}"` : ''}>` +
    `<path d="M-10 0 L10 0 L7 54 L-7 54 Z" fill="${c.ink}"/><circle cx="0" cy="0" r="10" fill="${c.ink}"/>` +
    `<g transform="translate(0 54)${fore ? ' ' + rot(fore) : ''}">` +
    `<circle cx="0" cy="0" r="7.5" fill="${c.ink}"/><path d="M-7.5 0 L7.5 0 L5.5 42 L-5.5 42 Z" fill="${c.ink}"/>` +
    `<path d="M-6.2 38 H6.2" stroke="${c.inkLight}" stroke-width="3.4" stroke-linecap="round"/>` +
    `<g transform="translate(0 42)">${index}${hand}${fingers}${letter}</g></g></g></g>`
  );
}

function leg(side: 'l' | 'r', angle: number, c: TweenColors): string {
  const x = side === 'l' ? 172 : 228;
  const foot = side === 'l' ? -14 : 14;
  return (
    `<g transform="translate(${x} 340)"><g${angle ? ` transform="${rot(angle)}"` : ''}>` +
    `<path d="M-8.5 0 L8.5 0 L5 86 L-5 86 Z" fill="${c.ink}"/><ellipse cx="${foot}" cy="95" rx="29" ry="12.5" fill="${c.ink}"/></g></g>`
  );
}

const MOUTH_SMILE = (w: string) => `<path d="M181 252 Q200 268 219 252" fill="none" stroke="${w}" stroke-width="7" stroke-linecap="round"/>`;
const MOUTH_HAPPY = (w: string) => `<path d="M172 248 Q200 282 228 248 Z" fill="${w}"/>`;
const MOUTH_FLAT = (w: string) => `<path d="M186 258 L214 254" fill="none" stroke="${w}" stroke-width="7" stroke-linecap="round"/>`;
const MOUTH_WAVY = (w: string) => `<path d="M182 264 Q191 254 200 264 Q209 274 218 264" fill="none" stroke="${w}" stroke-width="7" stroke-linecap="round"/>`;
const MOUTH_SLEEP = (w: string) => `<path d="M190 258 Q200 265 210 258" fill="none" stroke="${w}" stroke-width="6" stroke-linecap="round"/>`;
const MOUTH_TALK = (w: string) => `<path d="M176 249 Q200 278 224 249 Z" fill="${w}"/>`;
const MOUTH_JOY = (w: string, tongue: string) =>
  `<path d="M168 246 Q200 294 232 246 Z" fill="${w}"/><path d="M184 270 Q200 282 216 270 Q200 264 184 270 Z" fill="${tongue}"/>`;

function face(p: PoseSpec, c: TweenColors): string {
  const w = c.eye;
  const open = p.face !== 'sleep' && p.face !== 'joy';
  let s = '';
  if (open) {
    s +=
      `<ellipse cx="156" cy="190" rx="33" ry="36" fill="${w}"/><ellipse cx="244" cy="190" rx="33" ry="36" fill="${w}"/>` +
      `<g transform="translate(${n(p.ex)} ${n(p.ey)})">` +
      `<circle cx="163" cy="193" r="17" fill="${c.ink}"/><circle cx="251" cy="193" r="17" fill="${c.ink}"/>` +
      `<circle cx="168" cy="187" r="5" fill="${w}"/><circle cx="256" cy="187" r="5" fill="${w}"/></g>`;
  }
  if (p.face === 'sleep') {
    s += `<g fill="none" stroke="${w}" stroke-width="8" stroke-linecap="round"><path d="M126 188 Q156 216 186 188"/><path d="M214 188 Q244 216 274 188"/></g>`;
  }
  if (p.face === 'joy') {
    s += `<g fill="none" stroke="${w}" stroke-width="9" stroke-linecap="round"><path d="M130 200 Q156 160 182 200"/><path d="M218 200 Q244 160 270 200"/></g>`;
  }
  if (p.face === 'think') {
    s += `<path d="M134 140 L178 133" stroke="${w}" stroke-width="7" stroke-linecap="round"/>`;
  }
  if (p.face === 'worried') {
    s += `<g stroke="${w}" stroke-width="7" stroke-linecap="round"><path d="M132 148 L180 134"/><path d="M268 148 L220 134"/></g>`;
  }
  if (p.talking && p.face !== 'sleep' && p.face !== 'joy') s += MOUTH_TALK(w);
  else if (p.face === 'neutral') s += MOUTH_SMILE(w);
  else if (p.face === 'happy') s += MOUTH_HAPPY(w);
  else if (p.face === 'think') s += MOUTH_FLAT(w);
  else if (p.face === 'worried') s += MOUTH_WAVY(w);
  else if (p.face === 'sleep') s += MOUTH_SLEEP(w);
  else s += MOUTH_JOY(w, c.scarf);
  const t = [p.turn ? `translate(${n(p.turn)} 0)` : '', rot(p.tilt, 200, 200)].filter(Boolean).join(' ');
  return `<g${t ? ` transform="${t}"` : ''}>${s}</g>`;
}

function cover(c: TweenColors): string {
  return (
    `<g stroke="${c.inkLight}" stroke-linecap="round">` +
    `<rect x="116" y="150" width="80" height="68" rx="26" fill="${c.ink}" stroke-width="3"/>` +
    `<path d="M136 152 V176 M156 151 V176 M176 152 V176" stroke-width="3" fill="none"/>` +
    `<ellipse cx="114" cy="200" rx="9" ry="15" fill="${c.ink}" stroke-width="3" transform="rotate(20 114 200)"/>` +
    `<rect x="204" y="172" width="80" height="62" rx="26" fill="${c.ink}" stroke-width="3"/>` +
    `<path d="M224 174 V196 M244 173 V196 M264 174 V196" stroke-width="3" fill="none"/>` +
    `<ellipse cx="286" cy="218" rx="9" ry="15" fill="${c.ink}" stroke-width="3" transform="rotate(-20 286 218)"/></g>`
  );
}

const FEATHER =
  `<g transform="translate(268 112) rotate(22) scale(0.84)">` +
  `<path d="M0 6 C-40 -30 -42 -98 0 -152 C42 -98 40 -30 0 6 Z" fill="${TEAL}"/>` +
  `<path d="M0 -2 C-28 -32 -30 -92 0 -138 C30 -92 28 -32 0 -2 Z" fill="${TEAL_LIGHT}" opacity="0.55"/>` +
  `<path d="M0 6 L0 -58" stroke="${TEAL_DARK}" stroke-width="3.5" stroke-linecap="round"/>` +
  `<path d="M-9 -20 L-26 -34 M9 -20 L26 -34 M-12 -42 L-30 -58 M12 -42 L30 -58 M-12 -118 L-24 -128 M12 -118 L24 -128" stroke="${TEAL_DARK}" stroke-width="2.6" stroke-linecap="round" opacity="0.75"/>` +
  `<ellipse cx="0" cy="-92" rx="20" ry="26" fill="${GOLD}"/><ellipse cx="0" cy="-92" rx="14" ry="19" fill="${ORANGE}"/>` +
  `<ellipse cx="0" cy="-92" rx="8.6" ry="12.4" fill="${EYE_BLUE}"/><ellipse cx="0" cy="-92" rx="4.6" ry="7.6" fill="${'#0B1C30'}"/>` +
  `<circle cx="-1.6" cy="-95" r="1.6" fill="${WHITE}"/></g>`;

function props(kind: PoseSpec['props'], c: TweenColors): string {
  if (kind === 'dots') {
    return `<g fill="${c.scarf}"><circle cx="88" cy="78" r="6"/><circle cx="66" cy="52" r="9"/><circle cx="42" cy="22" r="13"/></g>`;
  }
  if (kind === 'zs') {
    return (
      `<g fill="none" stroke="${c.scarf}" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M70 70 H90 L70 94 H90" stroke-width="6"/><path d="M48 44 H64 L48 64 H64" stroke-width="5"/><path d="M32 22 H44 L32 38 H44" stroke-width="4"/></g>`
    );
  }
  if (kind === 'confetti') {
    return (
      `<g><circle cx="58" cy="96" r="7" fill="${c.scarf}"/>` +
      `<rect x="332" y="86" width="14" height="14" rx="3" fill="${c.coral}" transform="rotate(20 339 93)"/>` +
      `<rect x="36" y="168" width="12" height="12" rx="3" fill="${c.coral}" transform="rotate(-18 42 174)"/>` +
      `<circle cx="352" cy="160" r="6" fill="${c.scarf}"/>` +
      `<path d="M96 40 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6 l14 -6 z" fill="${c.scarfDark}"/></g>`
    );
  }
  return '';
}

export interface HaloOptions {
  /** Halo colour. Default white. */
  color?: string;
}

/**
 * Tween's drawing as SVG elements in rig coordinates (no `<svg>` wrapper), so a post template can place it.
 * `halo` adds the thin white glow that lets the navy body read on a dark background (the site uses 1.5 px).
 * `id` keeps the filter id unique when several Tweens share one document.
 */
export function tweenParts(args: {
  pose: TweenPose;
  colors?: TweenColors;
  halo?: boolean | HaloOptions;
  id?: string;
  /** Changes some of the pose's values (the reference test uses it to prove a wrong angle is caught). */
  tweak?: Partial<PoseSpec>;
}): string {
  const c = args.colors ?? DEFAULT_TWEEN_COLORS;
  const p: PoseSpec = { ...(POSE_SPECS[args.pose] ?? POSE_SPECS.idle), ...args.tweak };
  const id = (args.id ?? 'tw').replace(/[^a-zA-Z0-9_-]/g, '') || 'tw';

  const bobT = [rot(p.lean, 200, 440), p.drop ? `translate(0 ${n(p.drop)})` : ''].filter(Boolean).join(' ');
  const body =
    leg('l', p.ll, c) +
    leg('r', p.lr, c) +
    arm('l', 108, p.ual, p.fal, p, c) +
    arm('r', 292, p.uar, p.far, p, c) +
    `<rect x="96" y="88" width="208" height="262" rx="66" fill="${c.ink}"/>` +
    face(p, c) +
    (p.cover ? cover(c) : '') +
    FEATHER +
    // the scarf tail hangs from the knot; the band covers its top
    `<g transform="translate(126 314)"><g${p.tail ? ` transform="${rot(p.tail)}"` : ''}>` +
    `<path d="M-22 -8 L-30 82 Q-30 94 -18 95 L8 97 Q22 97 22 86 L20 -8 Z" fill="${c.scarfDark}"/>` +
    `<path d="M-3 -4 L-6 90" stroke="${c.scarfLight}" stroke-width="3" stroke-linecap="round" opacity="0.55"/></g></g>` +
    `<rect x="88" y="284" width="224" height="46" rx="23" fill="${c.scarf}"/>` +
    `<path d="M106 297 Q200 308 294 297" fill="none" stroke="${c.scarfLight}" stroke-width="4" stroke-linecap="round" opacity="0.6"/>` +
    `<path d="M106 318 Q200 330 294 318" fill="none" stroke="${c.scarfDark}" stroke-width="4" stroke-linecap="round" opacity="0.5"/>`;

  let figure = `<g${bobT ? ` transform="${bobT}"` : ''}>${body}</g>${props(p.props, c)}`;
  let defs = '';
  if (args.halo) {
    const color = typeof args.halo === 'object' && args.halo.color ? args.halo.color : '#FFFFFF';
    // Grow the silhouette a little, soften it, tint it, and draw the figure on top of that.
    defs =
      `<defs><filter id="${id}-halo" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">` +
      `<feMorphology in="SourceAlpha" operator="dilate" radius="2" result="grow"/>` +
      `<feGaussianBlur in="grow" stdDeviation="1.2" result="soft"/>` +
      `<feFlood flood-color="${color}" flood-opacity="0.95" result="tint"/>` +
      `<feComposite in="tint" in2="soft" operator="in" result="glow"/>` +
      `<feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
    figure = `<g filter="url(#${id}-halo)">${figure}</g>`;
  }

  const shadow = `<ellipse cx="200" cy="452" rx="98" ry="12" fill="${c.ink}" opacity="0.1"/>`;
  const inner = defs + shadow + figure;
  return p.mirror ? `<g transform="translate(400 0) scale(-1 1)">${inner}</g>` : inner;
}

/**
 * Tween as a standalone SVG on the kit's 550 x 550 canvas (viewBox -75 -80 550 550).
 * Transparent background; `size` is the width and height in pixels (default 550).
 */
export function renderTween(args: { pose: TweenPose; colors?: TweenColors; halo?: boolean | HaloOptions; size?: number; tweak?: Partial<PoseSpec> }): string {
  const size = args.size ?? TWEEN_CANVAS;
  const label = `Tween: ${args.pose}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${TWEEN_VIEWBOX}" role="img" aria-label="${label}">` +
    `<title>${label}</title>${tweenParts({ pose: args.pose, colors: args.colors, halo: args.halo, tweak: args.tweak })}</svg>`
  );
}
