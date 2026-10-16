// Baton: a relay baton. The baton takes the `body` colour (gold by default); the two bands take the accent.

import type { CharacterBody } from '../body';

export const baton: CharacterBody = {
  id: 'baton',
  defaults: { body: '#F2B33D', bodyDark: '#C98A1B', bodyLight: '#FFD98A', bodyLine: '#C98A1B' },
  cx: 120,
  bottom: 208,
  shoulders: { l: [92, 140], r: [148, 140] },
  armScale: 1.05,
  limb: { width: 5.5, color: (P) => P.navy, hand: 6, handBig: 9 },
  legs: { hips: { l: [108, 204], r: [132, 204] }, len: 18, foot: { rx: 10, ry: 5, dx: 5 } },
  face: {
    style: 'oval',
    eyes: [[110, 112], [132, 112]],
    size: 0.88,
    mouth: [121, 128],
    mouthScale: 0.9,
    cheeks: { pts: [[100, 126], [142, 126]], r: 4.5 },
  },
  card: { x: 128, y: 112 },
  sign: { x: 60, y: 138, w: 120, h: 56 },
  shadow: { cy: 244, rx: 42 },
  bbox: () => [42, 40, 152, 211],
  draw: ({ P }) => ({
    art:
      `<path d="M50,92 H76 M44,112 H76 M54,132 H76" stroke="#AFC0D4" stroke-width="3" stroke-linecap="round"/>` +
      `<rect x="90" y="40" width="60" height="168" rx="30" fill="${P.body}"/>` +
      `<rect x="98" y="52" width="10" height="140" rx="5" fill="${P.bodyLight}" opacity=".9"/>` +
      `<rect x="138" y="52" width="6" height="140" rx="3" fill="${P.bodyDark}" opacity=".45"/>` +
      `<rect x="90" y="62" width="60" height="9" fill="${P.accent}"/><rect x="90" y="176" width="60" height="9" fill="${P.accent}"/>`,
  }),
};
