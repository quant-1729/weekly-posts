// Gaanth: a cloth bundle (potli). The cloth takes the accent colour, the knot and the arms its dark shade; the gold band stays gold.

import type { CharacterBody } from '../body';

const BAG = 'M104,74 C70,86 52,128 56,172 C59,208 88,224 120,224 C152,224 181,208 184,172 C188,128 170,86 136,74 Z';

export const gaanth: CharacterBody = {
  id: 'gaanth',
  defaults: { body: '#2BB5B0', bodyDark: '#1A8C88', bodyLight: '#8FE0DB', bodyLine: '#1A8C88' },
  cx: 120,
  bottom: 224,
  shoulders: { l: [66, 160], r: [174, 160] },
  armScale: 1.25,
  limb: { width: 15, color: (P) => P.accentDark, hand: 9.5, handBig: 11, handFill: (P) => P.accent },
  legs: { hips: { l: [104, 214], r: [136, 214] }, len: 12, foot: { rx: 14, ry: 7.5, dx: 0 } },
  face: {
    style: 'round',
    eyes: [[102, 132], [138, 132]],
    size: 10.5,
    mouth: [120, 153],
    mouthScale: 1.05,
    smileAs: 'grin',
    cheeks: { pts: [[86, 150], [154, 150]], r: 6.5 },
  },
  card: { x: 156, y: 110 },
  sign: { x: 56, y: 164, w: 128, h: 50 },
  signGrip: 16,
  shadow: { cy: 244, rx: 50 },
  bbox: () => [50, 46, 190, 232],
  draw: ({ P, id }) => {
    const dots: string[] = [];
    [92, 109, 126, 143, 160, 177, 194, 211].forEach((y, r) => {
      for (let x = r % 2 === 0 ? 54 : 63; x <= 189; x += 18) dots.push(`<circle cx="${x}" cy="${y}" r="2.3"/>`);
    });
    const ear = `<path d="M0,0 C-8,-1 -16,-4 -21,-12" stroke="${P.accentDark}" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M-21,-12 C-30,-14 -34,-6 -30,0 C-26,-2 -22,-6 -21,-12 Z" fill="${P.accentDark}"/>`;
    return {
      art:
        `<defs><clipPath id="${id}-b"><path d="${BAG}"/></clipPath></defs>` +
        `<path d="${BAG}" fill="${P.accent}"/>` +
        `<g clip-path="url(#${id}-b)" fill="${P.accentLight}" opacity=".5">${dots.join('')}</g>` +
        `<path d="M162,96 C182,130 186,176 168,206 C178,170 176,128 156,92 Z" fill="${P.accentDark}" opacity=".35"/>` +
        `<path d="M100,76 C94,58 108,50 120,58 C132,50 146,58 140,76 Z" fill="${P.accent}"/>` +
        `<path d="M108,60 L112,74 M120,57 L120,74 M132,60 L128,74" stroke="${P.accentDark}" stroke-width="2" stroke-linecap="round"/>` +
        `<g transform="translate(112 64) rotate(-12)">${ear}</g>` +
        `<g transform="translate(128 64) scale(-1 1) rotate(-12)">${ear}</g>` +
        `<rect x="98" y="68" width="44" height="14" rx="7" fill="${P.gold}"/>` +
        `<path d="M106,75 h4 M116,75 h4 M126,75 h4" stroke="${P.goldDark}" stroke-width="2" stroke-linecap="round"/>` +
        `<circle cx="120" cy="66" r="8" fill="${P.gold}" stroke="${P.goldDark}" stroke-width="2"/>`,
    };
  },
};
