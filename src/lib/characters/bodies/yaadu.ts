// Yaadu: a baby elephant (from the kit's directions sheet). The body takes the `body` colour (blue-grey by default);
// the lanyard and badge tick take the accent. The trunk and ears move with the action; pink ear linings and toenails stay.

import type { CharacterBody } from '../body';
import type { CharacterAction } from '../types';

const IN = '#F3C6B6';
const CREAM = '#FFF4E2';

type Trunk = readonly [number, number, number, number, number, number];
const REST: Trunk = [120, 136, 116, 150, 128, 156];
const RAISED: Trunk = [118, 80, 140, 50, 166, 36];
const TRUNKS: Partial<Record<CharacterAction, Trunk>> = {
  wave: [122, 136, 142, 148, 146, 134],
  remind: [122, 136, 142, 148, 146, 134],
  'thumbs-up': [122, 136, 142, 148, 146, 134],
  'point-right': [126, 134, 146, 144, 162, 134],
  'point-left': [114, 134, 94, 144, 78, 134],
  'point-up': [118, 100, 134, 70, 146, 44],
  think: [152, 112, 178, 68, 146, 52],
  search: [152, 112, 178, 68, 146, 52],
  celebrate: RAISED,
  jump: RAISED,
  land: RAISED,
  clap: RAISED,
  surprised: RAISED,
  heart: RAISED,
  sleep: [118, 136, 112, 154, 100, 158],
};
const RAISED_ACTIONS: ReadonlySet<CharacterAction> = new Set(['celebrate', 'jump', 'land', 'clap', 'surprised', 'heart', 'point-up', 'think', 'search']);

function earAngle(a: CharacterAction): number {
  if (a === 'celebrate' || a === 'jump' || a === 'surprised' || a === 'clap') return 8;
  if (a === 'shrug' || a === 'sleep' || a === 'oops') return -14;
  return 0;
}

export const yaadu: CharacterBody = {
  id: 'yaadu',
  defaults: { body: '#86A3C4', bodyDark: '#5F80A8', bodyLight: '#A9C0DA', bodyLine: '#5F80A8' },
  cx: 120,
  bottom: 224,
  shoulders: { l: [86, 170], r: [154, 170] },
  armScale: 1,
  limb: { width: 13, color: (P) => P.bodyDark, hand: 8.5, handBig: 10 },
  legs: {
    hips: { l: [105, 204], r: [135, 204] },
    len: 36,
    width: 4,
    foot: { rx: 11, ry: 3, dx: 0 },
    custom: ({ hx, hy, a, len, side, P }) => {
      const fx = hx + len * Math.sin((a * Math.PI) / 180);
      const fy = hy + len * Math.cos((a * Math.PI) / 180);
      const n1 = side === -1 ? -5 : -4;
      const n2 = side === -1 ? 4 : 5;
      return {
        svg:
          `<g transform="rotate(${Math.round(-a * 10) / 10} ${hx} ${hy})"><rect x="${hx - 11}" y="${hy}" width="22" height="${len}" rx="10" fill="${P.bodyDark}"/>` +
          `<circle cx="${hx + n1}" cy="${hy + len - 4}" r="3" fill="${CREAM}"/><circle cx="${hx + n2}" cy="${hy + len - 4}" r="3" fill="${CREAM}"/></g>`,
        fx,
        fy: fy - 3,
        padX: 11,
        padY: 3,
      };
    },
  },
  face: {
    style: 'round',
    eyes: [[100, 96], [140, 96]],
    size: 11,
    mouth: [142, 136],
    mouthScale: 0.9,
    mouthStroke: 3,
    cheeks: { pts: [[88, 120], [152, 118]], r: 7 },
  },
  card: { x: 80, y: 150 },
  sign: { x: 50, y: 168, w: 140, h: 56 },
  signGrip: 18,
  shadow: { cy: 244, rx: 48 },
  bbox: ({ p }) => (p.cover ? [64, 32, 182, 226] : [28, RAISED_ACTIONS.has(p.action) ? 22 : 32, 212, 226]),
  draw: ({ P, p }) => {
    const B = P.body;
    const BD = P.bodyDark;
    const ear = earAngle(p.action);
    const trunk = TRUNKS[p.action] ?? REST;
    const tdrop = p.action === 'sleep' ? 6 : 0;
    const tr = `M120,${112 + tdrop} C${trunk[0]},${trunk[1] + tdrop} ${trunk[2]},${trunk[3] + tdrop} ${trunk[4]},${trunk[5] + tdrop}`;
    const earsBack =
      `<g transform="rotate(${-ear} 78 92)"><ellipse cx="62" cy="106" rx="32" ry="40" fill="${BD}" transform="rotate(-12 62 106)"/><ellipse cx="66" cy="108" rx="21" ry="29" fill="${IN}" transform="rotate(-12 66 108)"/></g>` +
      `<g transform="rotate(${ear} 162 92)"><ellipse cx="178" cy="106" rx="32" ry="40" fill="${BD}" transform="rotate(12 178 106)"/><ellipse cx="174" cy="108" rx="21" ry="29" fill="${IN}" transform="rotate(12 174 108)"/></g>`;
    const earsFront =
      `<ellipse cx="100" cy="94" rx="25" ry="30" fill="${BD}" transform="rotate(-18 100 94)"/><ellipse cx="102" cy="96" rx="16" ry="20" fill="${IN}" transform="rotate(-18 102 96)"/>` +
      `<ellipse cx="140" cy="97" rx="25" ry="30" fill="${BD}" transform="rotate(18 140 97)"/><ellipse cx="138" cy="99" rx="16" ry="20" fill="${IN}" transform="rotate(18 138 99)"/>`;
    return {
      art:
        `<ellipse cx="120" cy="188" rx="44" ry="36" fill="${B}"/>` +
        `<path d="M101,150 L120,182 L139,150" stroke="${P.accent}" stroke-width="4" fill="none" stroke-linejoin="round"/>` +
        `<rect x="107" y="180" width="26" height="20" rx="4" fill="#ffffff" stroke="${P.accent}" stroke-width="1.6"/>` +
        `<path d="M113,190 l4.5,4.5 l8,-8" stroke="${P.accent}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        (p.cover ? '' : earsBack) +
        `<circle cx="120" cy="100" r="56" fill="${B}"/>` +
        `<path d="M114,46 q-2,-8 2,-12 M121,45 q0,-9 4,-12 M128,47 q2,-7 7,-9" stroke="${BD}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
      after:
        `<path d="${tr}" stroke="${BD}" stroke-width="22" fill="none" stroke-linecap="round"/>` +
        `<path d="${tr}" stroke="${B}" stroke-width="17.5" fill="none" stroke-linecap="round"/>` +
        `<ellipse cx="${trunk[4]}" cy="${trunk[5] + tdrop}" rx="2.6" ry="2" fill="${P.navy}" opacity=".55"/>` +
        (p.cover ? earsFront : ''),
    };
  },
};
