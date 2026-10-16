// Tiko: a capsule with a tick-shaped sprout (from the kit's directions sheet). The top half and the hands take the
// accent colour, the sprout its dark shade; the lower half stays ink navy.

import type { CharacterBody } from '../body';

const ARM = '#2F4A6B';

export const tiko: CharacterBody = {
  id: 'tiko',
  defaults: { body: '#2BB5B0', bodyDark: '#16807C', bodyLight: '#E3F6F5', bodyLine: '#16807C' },
  cx: 120,
  bottom: 216,
  shoulders: { l: [78, 150], r: [162, 150] },
  armScale: 1.35,
  limb: { width: 12, color: () => ARM, hand: 10, handBig: 12, handFill: (P) => P.accent, handStroke: (P) => P.accentDark },
  legs: { hips: { l: [106, 206], r: [134, 206] }, len: 22, width: 16, foot: { rx: 14, ry: 7, dx: 0 } },
  face: {
    style: 'round',
    eyes: [[102, 92], [138, 92]],
    size: 11,
    mouth: [120, 113],
    mouthScale: 1,
    mouthStroke: 3,
    cheeks: { pts: [[90, 110], [150, 110]], r: 6 },
  },
  card: { x: 80, y: 124 },
  sign: { x: 52, y: 124, w: 136, h: 62 },
  signGrip: 24,
  shadow: { cy: 244, rx: 44 },
  bbox: ({ p }) => [70, p.action === 'celebrate' ? 2 : p.action === 'think' || p.action === 'search' ? 4 : 6, 170, 238],
  draw: ({ P, p, id }) => {
    const TD = P.accentDark;
    let sprout: string;
    if (p.action === 'think' || p.action === 'search') {
      sprout = `<path d="M106,24 Q106,8 121,8 Q136,8 134,21 Q132,31 120,33 L119,40" stroke="${TD}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      const rot = p.action === 'sleep' || p.action === 'shrug' ? 28 : p.action.startsWith('point') ? 14 : 0;
      sprout =
        (p.action === 'celebrate' ? `<circle cx="118" cy="24" r="22" fill="${P.accent}" opacity=".25"/>` : '') +
        `<g transform="rotate(${rot} 116 40)"><path d="M102,24 L114,36 L136,12" stroke="${TD}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M114,36 L116,42" stroke="${TD}" stroke-width="6" stroke-linecap="round"/></g>`;
    }
    return {
      art:
        sprout +
        `<defs><clipPath id="${id}-cap"><rect x="72" y="40" width="96" height="176" rx="48"/></clipPath></defs>` +
        `<g clip-path="url(#${id}-cap)"><rect x="72" y="40" width="96" height="88" fill="${P.accent}"/><rect x="72" y="128" width="96" height="88" fill="${P.navy}"/>` +
        `<line x1="72" y1="128" x2="168" y2="128" stroke="#ffffff" stroke-opacity=".55" stroke-width="2"/></g>` +
        `<rect x="86" y="56" width="10" height="44" rx="5" fill="#ffffff" opacity=".35"/>`,
    };
  },
};
