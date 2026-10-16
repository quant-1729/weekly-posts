// Contact sheets for the brand characters (CH-1): every character x the post actions, drawn by drawCharacter.
// Run: npx tsx scripts/character-sheet.mts [--out <dir>] [--debug] [--all] [--only <id,id>] [--accent #hex --dark #hex [--body #hex]]
// Output: <out>/<character>.png (one sheet per character), <out>/all.png (every character, post actions, smaller)
//   --debug  overlays the bounds (red), hands (blue), face (green), feet (orange) and sign / pointing anchors
//   --all    draws all 41 actions per character instead of the 14 post actions (<out>/<character>-all.png)
// Default out: the session scratchpad characters folder; override with --out.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { drawCharacter } from '../src/lib/characters/index';
import { CHARACTER_ACTIONS, CHARACTER_IDS, type CharacterAction, type CharacterColors, type CharacterId } from '../src/lib/characters/types';
import { BODIES } from '../src/lib/characters/bodies';

const DEFAULT_OUT = 'C:\\Users\\RITS\\AppData\\Local\\Temp\\claude\\C--Users-RITS-Projects-Post\\540820ea-fa16-4593-84f9-f3011aaa0d20\\scratchpad\\characters';

/** The actions posts use (the design brief's list). */
export const POST_ACTIONS: CharacterAction[] = [
  'idle', 'wave', 'present', 'hold-sign', 'point-left', 'point-right', 'point-up', 'peek', 'perch', 'celebrate', 'namaste', 'talk', 'thumbs-up', 'think',
];

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const out = opt('--out') ?? DEFAULT_OUT;
const debug = flag('--debug');
const all = flag('--all');
const only = (opt('--only') ?? '').split(',').filter(Boolean) as CharacterId[];
const colors: CharacterColors = { accent: opt('--accent') ?? '#2BB5B0', accentDark: opt('--dark') ?? '#1A8C88', body: opt('--body') };
const ids = (only.length ? only : [...CHARACTER_IDS]) as CharacterId[];
const actions: readonly CharacterAction[] = all ? CHARACTER_ACTIONS : POST_ACTIONS;

mkdirSync(out, { recursive: true });

function cell(id: CharacterId, action: CharacterAction, x: number, y: number, size: number): string {
  const d = drawCharacter(id, action, colors);
  const a = d.anchors;
  const shadowRx = id === 'tween' ? 48 : BODIES[id as Exclude<CharacterId, 'tween'>].shadow.rx;
  const shadow = action === 'perch' || action === 'sit'
    ? ''
    : `<ellipse cx="${a.feet.x}" cy="${a.feet.y + 5}" rx="${shadowRx}" ry="6.5" fill="#17253b" opacity="0.12"/>`;
  let dbg = '';
  if (debug) {
    dbg +=
      `<rect x="${a.bounds.x}" y="${a.bounds.y}" width="${a.bounds.w}" height="${a.bounds.h}" fill="none" stroke="#e11" stroke-width="0.8"/>` +
      `<circle cx="${a.handL.x}" cy="${a.handL.y}" r="3" fill="#06f"/><circle cx="${a.handR.x}" cy="${a.handR.y}" r="3" fill="#06f"/>` +
      `<circle cx="${a.face.x}" cy="${a.face.y}" r="3" fill="#0a0"/><circle cx="${a.feet.x}" cy="${a.feet.y}" r="3" fill="#f80"/>`;
    if (a.sign) dbg += `<rect x="${a.sign.x}" y="${a.sign.y}" width="${a.sign.w}" height="${a.sign.h}" fill="none" stroke="#a0f" stroke-width="1" stroke-dasharray="3 2"/>`;
    if (a.pointing) dbg += `<path d="M${a.handR.x},${a.handR.y} l${a.pointing.dx * 30},${a.pointing.dy * 30}" stroke="#a0f" stroke-width="2"/>`;
  }
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="-10 0 260 260"><rect x="-10" y="0" width="260" height="260" fill="#F3F6FA"/>${shadow}${d.body}${dbg}</svg>`;
}

function sheet(id: CharacterId, cols: number, size: number): Buffer {
  const rows = Math.ceil(actions.length / cols);
  const cells = actions.map((a, i) => cell(id, a, (i % cols) * size, Math.floor(i / cols) * size, size)).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * size}" height="${rows * size}" viewBox="0 0 ${cols * size} ${rows * size}">${cells}</svg>`;
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
}

const cols = all ? 8 : 7;
for (const id of ids) {
  const file = path.join(out, `${id}${all ? '-all' : ''}${debug ? '-debug' : ''}.png`);
  writeFileSync(file, sheet(id, cols, 260));
  console.log(file);
}

if (!all && !only.length) {
  // One overview: every character in a few actions.
  const pick: CharacterAction[] = ['idle', 'wave', 'hold-sign', 'point-right', 'celebrate'];
  const size = 200;
  const cells = ids.map((id, r) => pick.map((a, c) => cell(id, a, c * size, r * size, size)).join('')).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pick.length * size}" height="${ids.length * size}" viewBox="0 0 ${pick.length * size} ${ids.length * size}">${cells}</svg>`;
  const file = path.join(out, 'all.png');
  writeFileSync(file, Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()));
  console.log(file);
}
