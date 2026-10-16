// Dhaaga: a thread spool. The thread takes the accent colour; the wooden ends stay wood.

import type { CharacterBody } from '../body';
import { tick } from '../parts';

const WOOD = '#E8CFA6';
const WOOD_DARK = '#C9A97A';

export const dhaaga: CharacterBody = {
  id: 'dhaaga',
  defaults: { body: WOOD, bodyDark: WOOD_DARK, bodyLight: WOOD, bodyLine: WOOD_DARK },
  cx: 120,
  bottom: 210,
  shoulders: { l: [82, 140], r: [158, 140] },
  armScale: 1,
  limb: { width: 5.5, color: (P) => P.navy, hand: 6, handBig: 9 },
  legs: { hips: { l: [104, 208], r: [136, 208] }, len: 18, foot: { rx: 10, ry: 5, dx: 5 } },
  face: {
    style: 'round',
    eyes: [[104, 116], [136, 116]],
    size: 10,
    mouth: [120, 137],
    mouthScale: 1,
    smileAs: 'grin',
    cheeks: { pts: [[90, 132], [150, 132]], r: 5.5 },
  },
  card: { x: 148, y: 110 },
  sign: { x: 50, y: 150, w: 140, h: 52 },
  signGrip: 18,
  shadow: { cy: 244, rx: 56 },
  bbox: () => [68, 50, 198, 242],
  draw: ({ P }) => {
    const winding = Array.from({ length: 13 }, (_, i) => {
      const y = 80 + 9 * i;
      return `<path d="M84,${y} Q120,${y + 4} 156,${y}" stroke="${P.accentDark}" stroke-width="1.6" fill="none" opacity=".55"/>`;
    }).join('');
    return {
      art:
        `<path d="M156,170 C190,180 200,214 176,226 C158,236 150,222 160,214" stroke="${P.accent}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
        tick(170, 236, 0.8, P.accentDark, 3.5) +
        `<rect x="82" y="68" width="76" height="126" rx="6" fill="${P.accent}"/>` +
        winding +
        `<rect x="70" y="52" width="100" height="20" rx="10" fill="${WOOD}"/><rect x="70" y="190" width="100" height="20" rx="10" fill="${WOOD}"/>` +
        `<rect x="70" y="64" width="100" height="6" rx="3" fill="${WOOD_DARK}" opacity=".6"/><rect x="70" y="202" width="100" height="6" rx="3" fill="${WOOD_DARK}" opacity=".6"/>` +
        `<ellipse cx="120" cy="58" rx="8" ry="3" fill="${WOOD_DARK}"/>`,
    };
  },
};
