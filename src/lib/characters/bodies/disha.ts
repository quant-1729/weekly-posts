// Disha: a compass. The needle takes the accent colour; the case stays ink, the dial stays pale, the ring stays gold.
// The "N" on the dial is drawn as a path (no text).

import type { CharacterBody } from '../body';

export const disha: CharacterBody = {
  id: 'disha',
  defaults: { body: '#F7FAFD', bodyDark: '#AFC0D4', bodyLight: '#FFFFFF', bodyLine: '#AFC0D4' },
  cx: 120,
  bottom: 208,
  shoulders: { l: [58, 152], r: [182, 152] },
  armScale: 1.3,
  limb: { width: 5.5, color: (P) => P.navy, hand: 6, handBig: 9 },
  legs: { hips: { l: [104, 206], r: [136, 206] }, len: 16, foot: { rx: 10, ry: 5, dx: 5 } },
  face: {
    style: 'oval',
    eyes: [[104, 146], [136, 146]],
    size: 0.95,
    mouth: [120, 164],
    mouthScale: 1,
    cheeks: { pts: [[92, 158], [148, 158]], r: 5.5 },
  },
  card: { x: 160, y: 110 },
  sign: { x: 40, y: 176, w: 160, h: 44 },
  signGrip: 20,
  shadow: { cy: 244, rx: 52 },
  bbox: () => [51, 50, 189, 210],
  draw: ({ P }) => {
    const ticks: string[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      const major = i % 3 === 0;
      const r1 = 52;
      const r2 = major ? 58 : 55;
      const sx = (n: number) => Math.round(n * 10) / 10;
      ticks.push(
        `<line x1="${sx(120 + r1 * Math.sin(a))}" y1="${sx(140 - r1 * Math.cos(a))}" x2="${sx(120 + r2 * Math.sin(a))}" y2="${sx(140 - r2 * Math.cos(a))}" stroke="#AFC0D4" stroke-width="${major ? 3 : 1.5}" stroke-linecap="round"/>`,
      );
    }
    return {
      art:
        `<circle cx="120" cy="66" r="11" fill="none" stroke="${P.gold}" stroke-width="6"/>` +
        `<rect x="112" y="72" width="16" height="10" rx="3" fill="${P.goldDark}"/>` +
        `<circle cx="120" cy="140" r="68" fill="${P.navy}"/><circle cx="120" cy="140" r="60" fill="#F7FAFD"/>` +
        ticks.join('') +
        `<path d="M114,104 V92 L126,104 V92" stroke="${P.navy}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<g transform="rotate(38 120 112)"><path d="M120,90 L126,112 L120,116 L114,112 Z" fill="${P.accent}"/><path d="M120,134 L126,112 L120,116 L114,112 Z" fill="#AFC0D4"/></g>` +
        `<circle cx="120" cy="113" r="3.5" fill="${P.navy}"/>`,
    };
  },
};
