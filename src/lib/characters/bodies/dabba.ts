// Dabba: a three-tier tiffin. The tiers take the `body` colour (steel by default); the top band takes the accent,
// the middle band stays gold and the bottom band stays ink.

import type { CharacterBody } from '../body';

export const dabba: CharacterBody = {
  id: 'dabba',
  defaults: { body: '#CBD5E0', bodyDark: '#A3B1C2', bodyLight: '#EEF2F7', bodyLine: '#8C9AAC' },
  cx: 120,
  bottom: 220,
  shoulders: { l: [70, 154], r: [170, 154] },
  armScale: 1,
  limb: { width: 5.5, color: (P) => P.navy, hand: 6, handBig: 9 },
  legs: { hips: { l: [104, 218], r: [136, 218] }, len: 12, foot: { rx: 10, ry: 5, dx: 5 } },
  face: {
    style: 'oval',
    eyes: [[106, 114], [134, 114]],
    size: 0.95,
    mouth: [120, 128],
    mouthScale: 0.95,
  },
  card: { x: 150, y: 112 },
  sign: { x: 52, y: 140, w: 136, h: 62 },
  signGrip: 22,
  shadow: { cy: 244, rx: 54 },
  bbox: () => [64, 38, 176, 222],
  draw: ({ P }) => {
    const tier = (y: number, band: string) =>
      `<rect x="70" y="${y}" width="100" height="40" rx="10" fill="${P.body}"/>` +
      `<rect x="76" y="${y + 4}" width="12" height="30" rx="6" fill="${P.bodyLight}" opacity=".9"/>` +
      `<rect x="156" y="${y + 4}" width="8" height="30" rx="4" fill="${P.bodyDark}" opacity=".7"/>` +
      `<rect x="68" y="${y - 2}" width="104" height="7" rx="3.5" fill="${band}"/>`;
    return {
      art:
        `<path d="M80,104 C80,40 160,40 160,104" stroke="${P.bodyLine}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
        `<rect x="112" y="40" width="16" height="10" rx="4" fill="${P.bodyLine}"/>` +
        `<ellipse cx="120" cy="92" rx="48" ry="9" fill="${P.bodyDark}"/>` +
        tier(96, P.accent) + tier(138, P.gold) + tier(180, P.navy),
    };
  },
};
