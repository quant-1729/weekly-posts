// Nudge: a sticky note. The note takes the `body` colour (butter yellow by default); the tick takes the accent.

import type { CharacterBody } from '../body';

export const nudge: CharacterBody = {
  id: 'nudge',
  defaults: { body: '#FFD66B', bodyDark: '#F2C14E', bodyLight: '#FBE9A9', bodyLine: '#E2B23A' },
  cx: 120,
  bottom: 186,
  shoulders: { l: [64, 138], r: [176, 138] },
  armScale: 1,
  limb: { width: 5.5, color: (P) => P.navy, hand: 6, handBig: 9 },
  legs: { hips: { l: [100, 186], r: [140, 186] }, len: 36, foot: { rx: 10, ry: 5, dx: 7 } },
  face: {
    style: 'oval',
    eyes: [[106, 126], [140, 126]],
    size: 1.03,
    mouth: [123, 144],
    mouthScale: 1.1,
    mouthStroke: 3.6,
  },
  rot: { deg: -3, cx: 120, cy: 186 },
  card: { x: 150, y: 108 },
  sign: { x: 50, y: 160, w: 140, h: 44 },
  shadow: { cy: 244, rx: 46 },
  bbox: () => [60, 70, 188, 196],
  draw: ({ P }) => ({
    art:
      `<path d="M66,77 L182,77 L182,169 L160,191 L66,191 Z" fill="${P.navy}" opacity=".10"/>` +
      `<path d="M62,72 L178,72 L178,164 L156,186 L62,186 Z" fill="${P.body}"/>` +
      `<path d="M62,72 L178,72 L178,90 L62,90 Z" fill="${P.bodyDark}"/>` +
      `<path d="M70,150 H170 M70,168 H150" stroke="${P.bodyLine}" stroke-width="1.2" opacity=".55"/>` +
      `<path d="M178,164 L156,186 L186,194 Z" fill="${P.bodyLight}" stroke="${P.bodyLine}" stroke-width="1"/>` +
      `<rect x="74" y="96" width="15" height="15" rx="2.5" fill="none" stroke="${P.navy}" stroke-width="2.6"/>` +
      `<path d="M77.7,103.0 l4.5,5.4 l9.9,-11.7" stroke="${P.accentDark}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  }),
};
