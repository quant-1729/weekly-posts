// Chitthi: a letter. White paper (not recoloured); the seal and the tick on the letter take the accent.

import type { CharacterBody } from '../body';
import { KIT } from '../body';

export const chitthi: CharacterBody = {
  id: 'chitthi',
  defaults: { body: '#FFFFFF', bodyDark: '#E4ECF6', bodyLight: '#FFFFFF', bodyLine: '#C9D6E6' },
  cx: 120,
  bottom: 184,
  shoulders: { l: [62, 140], r: [178, 140] },
  armScale: 1,
  limb: { width: 5.5, color: (P) => P.navy, hand: 6, handBig: 9 },
  legs: { hips: { l: [102, 182], r: [138, 182] }, len: 36, foot: { rx: 10, ry: 5, dx: 5 } },
  face: {
    style: 'oval',
    eyes: [[104, 122], [136, 122]],
    size: 1.03,
    mouth: [120, 140],
    mouthScale: 1,
    cheeks: { pts: [[88, 134], [152, 134]], r: 5.5 },
  },
  card: { x: 152, y: 108 },
  sign: { x: 50, y: 156, w: 140, h: 46 },
  shadow: { cy: 244, rx: 52 },
  bbox: () => [57, 53, 183, 186],
  draw: ({ P }) => {
    const E = '#C9D6E6';
    return {
      art:
        `<rect x="78" y="58" width="84" height="56" rx="4" fill="#FFFFFF" stroke="${E}" stroke-width="1.5" transform="rotate(-4 120 86)"/>` +
        `<path d="M90,72 H132 M90,82 H146 M90,92 H124" stroke="#AFC0D4" stroke-width="2.4" stroke-linecap="round" transform="rotate(-4 120 86)"/>` +
        `<path d="M140.4,98.0 l4.0,4.8 l8.8,-10.4" stroke="${P.accentDark}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M60,100 L120,62 L180,100 Z" fill="#E4ECF6" stroke="${E}" stroke-width="1.5" stroke-linejoin="round"/>` +
        `<rect x="60" y="96" width="120" height="88" rx="8" fill="#FFFFFF" stroke="${E}" stroke-width="1.5"/>` +
        `<path d="M62,182 L110,142 M178,182 L130,142" stroke="#D6E0EC" stroke-width="2"/>` +
        `<path d="M60,100 L120,140 L180,100" stroke="${E}" stroke-width="1.5" fill="none" stroke-linejoin="round"/>` +
        `<circle cx="160" cy="166" r="11" fill="${P.accent}"/>` +
        `<path d="M157.2,166.0 l2.8,3.3 l6.1,-7.2" stroke="${KIT.white}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    };
  },
};
