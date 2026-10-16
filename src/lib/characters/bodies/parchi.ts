// Parchi: the paper slip. The rig's native body (the kit's own drawing), with the three-row checklist on it.

import type { CharacterBody } from '../body';
import { KIT } from '../body';
import { rowsSvg, stampSvg, tick } from '../parts';

const ZIG = 'M78,62 ' + Array.from({ length: 11 }, (_, i) => `L${82 + 8 * i},${i % 2 === 0 ? 55 : 62}`).join(' ') + ' L162,62';
const BODY = `${ZIG} L162,190 L148,204 L78,204 Z`;

export const parchi: CharacterBody = {
  id: 'parchi',
  defaults: { body: KIT.paper, bodyDark: KIT.paper, bodyLight: KIT.paper, bodyLine: KIT.edge },
  cx: 120,
  bottom: 204,
  shoulders: { l: [80, 132], r: [160, 132] },
  armScale: 1,
  limb: { width: 5.5, color: (P) => P.navy, hand: 5.8, handBig: 9 },
  legs: { hips: { l: [104, 204], r: [136, 204] }, len: 24, foot: { rx: 10, ry: 5, dx: 5 } },
  face: {
    style: 'oval',
    eyes: [[106, 100], [134, 100]],
    size: 1,
    mouth: [120, 116],
    mouthScale: 1,
    cheeks: { pts: [[94, 112], [146, 112]], r: 5.5 },
  },
  nativeRows: true,
  sign: { x: 50, y: 124, w: 140, h: 62 },
  shadow: { cy: 246, rx: 48 },
  bbox: () => [77, 54, 163, 205],
  draw: ({ P, p }) => ({
    art:
      `<path d="${BODY}" fill="${P.navy}" opacity=".10" transform="translate(4 4)"/>` +
      `<path d="${BODY}" fill="${P.paper}" stroke="${P.edge}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<rect x="78" y="62" width="84" height="16" fill="${P.accent}"/>` +
      `${tick(91, 70, 0.5, '#ffffff', 2.6)}<rect x="104" y="68" width="30" height="4" rx="2" fill="#ffffff" opacity=".8"/><rect x="138" y="68" width="16" height="4" rx="2" fill="#ffffff" opacity=".5"/>` +
      `<path d="M162,190 L148,204 L148,190 Z" fill="${P.fold}" stroke="${P.edge}" stroke-width="1"/>` +
      rowsSvg(p, P) +
      (p.stamp ? stampSvg(P) : ''),
  }),
};
