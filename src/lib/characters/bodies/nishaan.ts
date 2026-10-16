// Nishaan: a ribbon bookmark. The ribbon takes the accent colour; the little gold tuft stays gold.

import type { CharacterBody } from '../body';

export const nishaan: CharacterBody = {
  id: 'nishaan',
  defaults: { body: '#2BB5B0', bodyDark: '#1A8C88', bodyLight: '#E3F6F5', bodyLine: '#1A8C88' },
  cx: 120,
  bottom: 214,
  shoulders: { l: [88, 124], r: [152, 124] },
  armScale: 1,
  limb: { width: 5.5, color: (P) => P.navy, hand: 6, handBig: 9 },
  legs: { hips: { l: [90, 214], r: [150, 214] }, len: 4, foot: { rx: 11, ry: 5.5, dx: 4 } },
  face: {
    style: 'round',
    eyes: [[106, 88], [134, 88]],
    size: 9.5,
    mouth: [120, 108],
    mouthScale: 1,
  },
  card: { x: 134, y: 100 },
  sign: { x: 60, y: 126, w: 120, h: 56 },
  shadow: { cy: 244, rx: 40 },
  bbox: () => [84, 8, 156, 226],
  draw: ({ P }) => ({
    art:
      `<path d="M86,30 L154,30 L154,214 L120,188 L86,214 Z" fill="${P.accent}"/>` +
      `<path d="M86,30 L154,30 L154,52 L86,52 Z" fill="${P.accentDark}"/>` +
      `<path d="M140,30 L154,30 L154,214 L140,203 Z" fill="${P.accentDark}" opacity=".35"/>` +
      `<path d="M106,140 l8,8 l16,-18" stroke="#ffffff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>` +
      `<path d="M120,30 C118,18 128,10 136,14" stroke="${P.gold}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
      `<circle cx="138" cy="15" r="4.5" fill="${P.gold}"/>`,
  }),
};
