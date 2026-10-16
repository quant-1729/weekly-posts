// Mynu: an Indian myna (from the kit's directions sheet). The body takes the `body` colour (slate by default); the wings,
// which are its arms, stay ink with a white patch; the beak and eye patches stay yellow. The accent colours the small props.

import type { CharacterBody } from '../body';

const BEL = '#C9D6E6';
const r1 = (n: number) => Math.round(n * 10) / 10;

export const mynu: CharacterBody = {
  id: 'mynu',
  defaults: { body: '#3a506b', bodyDark: '#2c3f56', bodyLight: '#5b7391', bodyLine: '#2c3f56' },
  cx: 120,
  bottom: 216,
  shoulders: { l: [68, 150], r: [172, 150] },
  armScale: 1.3,
  limb: {
    width: 0,
    color: (P) => P.navy,
    hand: 6,
    handBig: 9,
    wingLen: 54,
    drawWing: (a, ang, P) =>
      `<g transform="translate(${r1(a.sx)} ${r1(a.sy)}) rotate(${r1(-ang)})">` +
      `<path d="M-12,0 C-17,26 -8,46 0,54 C8,46 17,26 12,0 Z" fill="${P.navy}"/><ellipse cx="0" cy="38" rx="5.5" ry="8" fill="#ffffff"/></g>`,
  },
  legs: {
    hips: { l: [108, 212], r: [132, 212] },
    len: 22,
    width: 4.5,
    foot: { rx: 10, ry: 6, dx: 0 },
    custom: ({ hx, hy, a, len, P }) => {
      const fx = hx + len * Math.sin((a * Math.PI) / 180);
      const fy = hy + len * Math.cos((a * Math.PI) / 180);
      return {
        svg: `<path d="M${hx},${hy} L${r1(fx)},${r1(fy)} M${r1(fx)},${r1(fy)} l-8,4 M${r1(fx)},${r1(fy)} l8,4 M${r1(fx)},${r1(fy)} l0,6" stroke="${P.gold}" stroke-width="4.5" stroke-linecap="round" fill="none"/>`,
        fx,
        fy: fy + 3,
        padX: 10,
        padY: 3,
      };
    },
  },
  face: {
    style: 'round',
    eyes: [[96, 108], [144, 108]],
    size: 10,
    mouth: [120, 124],
    mouthScale: 1,
    beak: true,
  },
  card: { x: 80, y: 156 },
  sign: { x: 50, y: 156, w: 140, h: 56 },
  signGrip: 22,
  shadow: { cy: 244, rx: 42 },
  bbox: () => [60, 44, 180, 242],
  draw: ({ P, id }) => ({
    art:
      `<defs><clipPath id="${id}-egg"><ellipse cx="120" cy="142" rx="58" ry="74"/></clipPath></defs>` +
      `<ellipse cx="120" cy="142" rx="58" ry="74" fill="${P.body}"/>` +
      `<g clip-path="url(#${id}-egg)"><path d="M50,136 Q120,156 190,136 L190,40 L50,40 Z" fill="${P.navy}"/><ellipse cx="120" cy="186" rx="36" ry="30" fill="${BEL}"/></g>` +
      `<path d="M114,72 C108,58 115,52 120,46 C120,56 125,61 122,72 Z" fill="${P.navy}"/>` +
      `<ellipse cx="91" cy="110" rx="18" ry="15" fill="${P.gold}" transform="rotate(-10 91 110)"/><ellipse cx="149" cy="110" rx="18" ry="15" fill="${P.gold}" transform="rotate(10 149 110)"/>`,
  }),
};
