// The mascot rig (R15, D4): draws one character from a closed parts catalogue.
// Pure code, no AI, no fonts, no <text>, no <image>, no external references.
// Everything is authored in a 400x400 space (the renderer's MASCOT_BOX) and is
// transparent. The same spec in any pose gives the same body; only arms, eyes,
// mouth and small props change (so reviewers see one character in 8 poses).

import type { MascotSpec } from '@/lib/ai/schemas';
import { MASCOT_POSES, type MascotPose } from '@/lib/ai/prompts/mascot';
import { contrast, normaliseHex, parseHex, toHex } from '@/lib/render/color';

export const MASCOT_VIEW = 400;
export { MASCOT_POSES };
export type { MascotPose };

type Shape = MascotSpec['body']['shape'];
type LimbStyle = MascotSpec['limbs']['style'];

// ---------------------------------------------------------------------------
// Colours and contrast
// ---------------------------------------------------------------------------

const DARK = '#2B1A12';
const CREAM = '#FFF4E0';
const GOLD = '#FFC93C';
const MOUTH = '#5A1A2A';
const TONGUE = '#FF8FA3';
const OL = 9; // body outline
const LO = 6; // limb outline (each side)

function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** Moves `color` toward white or black (whichever contrasts more with `against`) until the ratio reaches `min`. */
export function ensureContrast(color: string, against: string, min: number): string {
  const c = normaliseHex(color);
  if (contrast(c, against) >= min) return c;
  const toward = contrast('#ffffff', against) >= contrast('#000000', against) ? '#ffffff' : '#000000';
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const m = mix(c, toward, t);
    if (contrast(m, against) >= min) return m;
  }
  return toward;
}

export interface MascotPalette {
  body: string;
  /** Outline colour: dark, or cream when the body is too dark for a dark outline to show. */
  ink: string;
  /** Eyes, brows and mouth line: dark, or cream on a dark body. */
  faceInk: string;
  /** Highlight dots inside eyes. */
  eyeHi: string;
  limb: string;
  accent: string;
  accentDark: string;
  accentLight: string;
  pattern: string;
}

export function mascotPalette(spec: MascotSpec): MascotPalette {
  const body = normaliseHex(spec.body.color);
  const ink = contrast(body, DARK) >= 2.0 ? DARK : CREAM;
  const faceInk = contrast(body, DARK) >= 3.0 ? DARK : CREAM;
  const accent = ensureContrast(spec.accent_color, body, 1.5);
  return {
    body,
    ink,
    faceInk,
    eyeHi: faceInk === DARK ? '#FFFFFF' : body,
    limb: ensureContrast(spec.limbs.color, body, 1.8),
    accent,
    accentDark: mix(accent, '#000000', 0.25),
    accentLight: mix(accent, '#ffffff', 0.4),
    pattern: ensureContrast(spec.body.pattern_color, body, 1.35),
  };
}

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------

const f = (v: number): string => String(Math.round(v * 10) / 10);

function strokeAttrs(color: string, w: number): string {
  return `stroke="${color}" stroke-width="${f(w)}" stroke-linejoin="round" stroke-linecap="round"`;
}

/** Shapes drawn with one shared outline: the outline of the union only. */
function union(items: string, fill: string, ink: string, ow: number): string {
  return `<g fill="none" ${strokeAttrs(ink, ow * 2)}>${items}</g><g fill="${fill}" stroke="none">${items}</g>`;
}

function star(cx: number, cy: number, r: number): string {
  const k = r * 0.14;
  return (
    `M${f(cx)} ${f(cy - r)}Q${f(cx + k)} ${f(cy - k)} ${f(cx + r)} ${f(cy)}Q${f(cx + k)} ${f(cy + k)} ${f(cx)} ${f(cy + r)}` +
    `Q${f(cx - k)} ${f(cy + k)} ${f(cx - r)} ${f(cy)}Q${f(cx - k)} ${f(cy - k)} ${f(cx)} ${f(cy - r)}Z`
  );
}

// ---------------------------------------------------------------------------
// Body shapes
// ---------------------------------------------------------------------------

interface ShapeDef {
  d: string;
  bottom: number;
  eyeY: number;
  eyeDX: number;
  mouthY: number;
  neckY: number;
  neckHW: number;
  shoulderY: number;
  shoulderHW: number;
  feetX: number;
  hatY: number;
  hatW: number;
  hl: { x: number; y: number; rx: number; ry: number; rot: number };
}

const SHAPES: Record<Shape, ShapeDef> = {
  round: {
    d: 'M80 226A120 110 0 1 1 320 226A120 110 0 1 1 80 226Z',
    bottom: 336,
    eyeY: 196,
    eyeDX: 41,
    mouthY: 236,
    neckY: 286,
    neckHW: 100,
    shoulderY: 246,
    shoulderHW: 114,
    feetX: 56,
    hatY: 128,
    hatW: 124,
    hl: { x: 140, y: 160, rx: 30, ry: 15, rot: -35 },
  },
  drop: {
    d: 'M200 84C216 132 314 186 314 262C314 314 264 338 200 338C136 338 86 314 86 262C86 186 184 132 200 84Z',
    bottom: 338,
    eyeY: 214,
    eyeDX: 38,
    mouthY: 252,
    neckY: 300,
    neckHW: 92,
    shoulderY: 262,
    shoulderHW: 108,
    feetX: 58,
    hatY: 142,
    hatW: 96,
    hl: { x: 138, y: 232, rx: 24, ry: 12, rot: -62 },
  },
  cup: {
    d: 'M92 134Q92 118 110 118L290 118Q308 118 308 134L286 316Q284 338 262 338L138 338Q116 338 114 316Z',
    bottom: 338,
    eyeY: 196,
    eyeDX: 42,
    mouthY: 236,
    neckY: 284,
    neckHW: 90,
    shoulderY: 240,
    shoulderHW: 96,
    feetX: 48,
    hatY: 122,
    hatW: 150,
    hl: { x: 134, y: 166, rx: 24, ry: 12, rot: -75 },
  },
  box: {
    d: 'M134 120H266Q306 120 306 160V298Q306 338 266 338H134Q94 338 94 298V160Q94 120 134 120Z',
    bottom: 338,
    eyeY: 200,
    eyeDX: 42,
    mouthY: 240,
    neckY: 288,
    neckHW: 104,
    shoulderY: 248,
    shoulderHW: 106,
    feetX: 56,
    hatY: 124,
    hatW: 140,
    hl: { x: 132, y: 158, rx: 26, ry: 11, rot: -40 },
  },
  pear: {
    d: 'M200 94C252 94 264 140 264 170C264 202 318 214 318 266C318 314 272 338 200 338C128 338 82 314 82 266C82 214 136 202 136 170C136 140 148 94 200 94Z',
    bottom: 338,
    eyeY: 182,
    eyeDX: 33,
    mouthY: 220,
    neckY: 262,
    neckHW: 112,
    shoulderY: 262,
    shoulderHW: 110,
    feetX: 58,
    hatY: 108,
    hatW: 104,
    hl: { x: 168, y: 130, rx: 12, ry: 20, rot: -15 },
  },
  bean: {
    d: 'M200 100C270 100 306 156 306 230C306 300 268 338 200 338C132 338 94 300 94 230C94 156 130 100 200 100Z',
    bottom: 338,
    eyeY: 200,
    eyeDX: 39,
    mouthY: 240,
    neckY: 288,
    neckHW: 88,
    shoulderY: 252,
    shoulderHW: 104,
    feetX: 52,
    hatY: 112,
    hatW: 128,
    hl: { x: 146, y: 158, rx: 24, ry: 12, rot: -50 },
  },
};

const clipId = (shape: Shape) => `mx-clip-${shape}`;

// ---------------------------------------------------------------------------
// Body group (static: identical in every pose)
// ---------------------------------------------------------------------------

function legs(p: MascotPalette, sd: ShapeDef, style: LimbStyle): string {
  const w = { stick: 6, noodle: 15, mitten: 13 }[style];
  const foot = { stick: { rx: 15, ry: 8 }, noodle: { rx: 17, ry: 10 }, mitten: { rx: 20, ry: 12 } }[style];
  let out = '';
  for (const side of [-1, 1]) {
    const x = 200 + side * sd.feetX;
    const y0 = sd.bottom - 10;
    const y1 = sd.bottom + 14;
    out += `<path d="M${f(x)} ${f(y0)}L${f(x)} ${f(y1)}" fill="none" ${strokeAttrs(p.ink, w + LO * 2)}/>`;
    out += `<path d="M${f(x)} ${f(y0)}L${f(x)} ${f(y1)}" fill="none" stroke="${p.limb}" stroke-width="${w}" stroke-linecap="round"/>`;
    out += `<ellipse cx="${f(x + side * 4)}" cy="${f(sd.bottom + 18)}" rx="${foot.rx}" ry="${foot.ry}" fill="${p.limb}" ${strokeAttrs(p.ink, 6)}/>`;
  }
  return out;
}

function patternSvg(spec: MascotSpec, p: MascotPalette, sd: ShapeDef): string {
  const fill = p.pattern;
  switch (spec.body.pattern) {
    case 'dots': {
      let s = '';
      let row = 0;
      for (let y = 112; y < 350; y += 36) {
        for (let x = row % 2 ? 98 : 120; x < 320; x += 44) s += `<circle cx="${x}" cy="${y}" r="8.5"/>`;
        row++;
      }
      return `<g fill="${fill}">${s}</g>`;
    }
    case 'stripes': {
      let s = '';
      for (let x = -40; x < 460; x += 54) s += `M${x} 70L${x - 110} 370`;
      return `<path d="${s}" fill="none" stroke="${fill}" stroke-width="20"/>`;
    }
    case 'swirl': {
      const cx = 200;
      const cy = (sd.eyeY + sd.bottom) / 2 + 20;
      let d = '';
      for (let i = 0; i <= 90; i++) {
        const t = i / 90;
        const th = t * 7.2;
        const r = 4 + t * 170;
        d += `${i === 0 ? 'M' : 'L'}${f(cx + r * Math.cos(th))} ${f(cy + r * Math.sin(th))}`;
      }
      return `<path d="${d}" fill="none" stroke="${fill}" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    default:
      return '';
  }
}

interface Layered {
  /** Drawn inside the body clip, under the outline. */
  clipped: string;
  /** Drawn on top of the body outline. */
  top: string;
}

function headSvg(spec: MascotSpec, p: MascotPalette, sd: ShapeDef): Layered {
  const cx = 200;
  const by = sd.hatY;
  const w = sd.hatW;
  switch (spec.head) {
    case 'topi': {
      const h = Math.min(w * 0.42, by - 30);
      const d = `M${f(cx - w / 2)} ${f(by + 4)}Q${f(cx - w / 2 - 2)} ${f(by - h * 0.8)} ${f(cx - w * 0.4)} ${f(by - h)}L${f(cx + w * 0.4)} ${f(by - h)}Q${f(cx + w / 2 + 2)} ${f(by - h * 0.8)} ${f(cx + w / 2)} ${f(by + 4)}Q${f(cx)} ${f(by + 14)} ${f(cx - w / 2)} ${f(by + 4)}Z`;
      return {
        clipped: '',
        top:
          `<path d="${d}" fill="${p.accent}" ${strokeAttrs(p.ink, 7)}/>` +
          `<path d="M${f(cx - w * 0.42)} ${f(by - h * 0.15)}Q${f(cx)} ${f(by + 8)} ${f(cx + w * 0.42)} ${f(by - h * 0.15)}" fill="none" ${strokeAttrs(p.accentDark, 5)}/>`,
      };
    }
    case 'chef_hat': {
      const h = Math.min(w * 0.8, by - 28);
      const bandH = h * 0.3;
      const puffY = by - bandH;
      const r1 = w * 0.23;
      const parts =
        `<rect x="${f(cx - w * 0.4)}" y="${f(by - bandH)}" width="${f(w * 0.8)}" height="${f(bandH + 6)}" rx="8"/>` +
        `<circle cx="${f(cx - w * 0.26)}" cy="${f(puffY - h * 0.22)}" r="${f(r1)}"/>` +
        `<circle cx="${f(cx + w * 0.26)}" cy="${f(puffY - h * 0.22)}" r="${f(r1)}"/>` +
        `<circle cx="${f(cx)}" cy="${f(puffY - h * 0.34)}" r="${f(r1 * 1.15)}"/>`;
      return {
        clipped: '',
        top:
          union(parts, '#FFFFFF', p.ink, 7) +
          `<path d="M${f(cx - w * 0.4)} ${f(by - bandH)}L${f(cx + w * 0.4)} ${f(by - bandH)}" fill="none" stroke="#D9D2C5" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M${f(cx - w * 0.14)} ${f(by - bandH - 6)}L${f(cx - w * 0.12)} ${f(by - bandH - h * 0.2)}M${f(cx + w * 0.14)} ${f(by - bandH - 6)}L${f(cx + w * 0.12)} ${f(by - bandH - h * 0.2)}" fill="none" stroke="#D9D2C5" stroke-width="4" stroke-linecap="round"/>`,
      };
    }
    case 'cap': {
      const h = Math.min(w * 0.5, by - 30);
      const dome = `M${f(cx - w / 2)} ${f(by + 4)}Q${f(cx - w / 2)} ${f(by - h * 1.25)} ${f(cx)} ${f(by - h * 1.25)}Q${f(cx + w / 2)} ${f(by - h * 1.25)} ${f(cx + w / 2)} ${f(by + 4)}Z`;
      const brim = `M${f(cx - w * 0.56)} ${f(by + 2)}Q${f(cx)} ${f(by + 26)} ${f(cx + w * 0.56)} ${f(by + 2)}Q${f(cx)} ${f(by + 8)} ${f(cx - w * 0.56)} ${f(by + 2)}Z`;
      return {
        clipped: '',
        top:
          `<path d="${dome}" fill="${p.accent}" ${strokeAttrs(p.ink, 7)}/>` +
          `<path d="${brim}" fill="${p.accentDark}" ${strokeAttrs(p.ink, 7)}/>` +
          `<circle cx="${f(cx)}" cy="${f(by - h * 1.25 + 1)}" r="6" fill="${p.accentDark}" ${strokeAttrs(p.ink, 4)}/>`,
      };
    }
    case 'headband': {
      const y = by - 6;
      const band = `M40 ${f(y)}Q200 ${f(y + 12)} 360 ${f(y)}L360 ${f(y + 18)}Q200 ${f(y + 30)} 40 ${f(y + 18)}Z`;
      const bx = cx + w * 0.34;
      const by2 = y + 13;
      return {
        clipped: `<path d="${band}" fill="${p.accent}" ${strokeAttrs(p.ink, 6)}/>`,
        top:
          union(
            `<path d="M${f(bx)} ${f(by2)}L${f(bx + 26)} ${f(by2 - 18)}L${f(bx + 26)} ${f(by2 + 18)}Z"/><path d="M${f(bx)} ${f(by2)}L${f(bx - 26)} ${f(by2 - 18)}L${f(bx - 26)} ${f(by2 + 18)}Z"/>`,
            p.accentLight,
            p.ink,
            5,
          ) + `<circle cx="${f(bx)}" cy="${f(by2)}" r="8" fill="${p.accent}" ${strokeAttrs(p.ink, 4)}/>`,
      };
    }
    case 'flower': {
      const fx = cx + 14;
      const fr = Math.min(22, (by - 24) / 2.2);
      const fy = by - fr * 0.9;
      let petals = '';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        petals += `<circle cx="${f(fx + Math.cos(a) * fr * 0.95)}" cy="${f(fy + Math.sin(a) * fr * 0.95)}" r="${f(fr * 0.62)}"/>`;
      }
      const leaf = `M${f(cx - 6)} ${f(by + 6)}Q${f(cx - 30)} ${f(by - 4)} ${f(cx - 34)} ${f(by - 22)}Q${f(cx - 12)} ${f(by - 18)} ${f(cx - 6)} ${f(by + 6)}Z`;
      return {
        clipped: '',
        top:
          `<path d="${leaf}" fill="#58B368" ${strokeAttrs(p.ink, 5)}/>` +
          union(petals, p.accent, p.ink, 5) +
          `<circle cx="${f(fx)}" cy="${f(fy)}" r="${f(fr * 0.55)}" fill="${GOLD}" ${strokeAttrs(p.ink, 4)}/>`,
      };
    }
    default:
      return { clipped: '', top: '' };
  }
}

function neckSvg(spec: MascotSpec, p: MascotPalette, sd: ShapeDef): Layered {
  const ny = sd.neckY;
  const hw = sd.neckHW;
  switch (spec.neck) {
    case 'scarf': {
      const x1 = 200 - hw - 8;
      const x2 = 200 + hw + 8;
      const band = `M${f(x1)} ${f(ny - 14)}Q200 ${f(ny + 8)} ${f(x2)} ${f(ny - 14)}L${f(x2)} ${f(ny + 12)}Q200 ${f(ny + 34)} ${f(x1)} ${f(ny + 12)}Z`;
      const tx = 200 + hw * 0.45;
      const tail = `M${f(tx - 16)} ${f(ny + 22)}L${f(tx + 18)} ${f(ny + 20)}L${f(tx + 24)} ${f(ny + 62)}L${f(tx + 4)} ${f(ny + 54)}L${f(tx - 10)} ${f(ny + 64)}Z`;
      return {
        clipped: '',
        top:
          `<path d="${tail}" fill="${p.accentDark}" ${strokeAttrs(p.ink, 6)}/>` +
          `<path d="${band}" fill="${p.accent}" ${strokeAttrs(p.ink, 7)}/>` +
          `<path d="M${f(200 - hw * 0.5)} ${f(ny - 2)}l8 18M${f(200 - hw * 0.1)} ${f(ny + 4)}l8 18M${f(200 + hw * 0.25)} ${f(ny + 4)}l-8 18" fill="none" stroke="${p.accentLight}" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`,
      };
    }
    case 'bow': {
      const y = ny + 4;
      const wing = (s: number) =>
        `<path d="M${f(200 + s * 6)} ${f(y)}L${f(200 + s * 50)} ${f(y - 24)}Q${f(200 + s * 58)} ${f(y)} ${f(200 + s * 50)} ${f(y + 24)}Z"/>`;
      return {
        clipped: '',
        top:
          union(wing(-1) + wing(1), p.accent, p.ink, 6) +
          `<rect x="188" y="${f(y - 13)}" width="24" height="26" rx="9" fill="${p.accentDark}" ${strokeAttrs(p.ink, 5)}/>`,
      };
    }
    case 'apron': {
      const y = ny - 8;
      const apron = `M${200 - 36} ${f(y)}L${200 + 36} ${f(y)}L${200 + 36} ${f(y + 22)}L420 ${f(y + 50)}L420 420L-20 420L-20 ${f(y + 50)}L${200 - 36} ${f(y + 22)}Z`;
      return {
        clipped:
          `<path d="${apron}" fill="${p.accent}" ${strokeAttrs(p.ink, 6)}/>` +
          `<path d="M${200 - 36} ${f(y)}L${200 - 50} ${f(y - 16)}M${200 + 36} ${f(y)}L${200 + 50} ${f(y - 16)}" fill="none" ${strokeAttrs(p.ink, 6)}/>`,
        top: '',
      };
    }
    case 'dupatta': {
      const x1 = 200 - hw - 6;
      const x2 = 200 + hw + 6;
      const d = `M${f(x1)} ${f(ny - 28)}Q210 ${f(ny + 4)} ${f(x2)} ${f(ny + 44)}`;
      const dots = [0.2, 0.4, 0.6, 0.8]
        .map((t) => {
          const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * 210 + t * t * x2;
          const y = (1 - t) * (1 - t) * (ny - 28) + 2 * (1 - t) * t * (ny + 4) + t * t * (ny + 44);
          return `<circle cx="${f(x)}" cy="${f(y)}" r="3.5"/>`;
        })
        .join('');
      const tail = `M${f(x2 - 22)} ${f(ny + 36)}L${f(x2 + 6)} ${f(ny + 32)}L${f(x2 + 12)} ${f(ny + 84)}L${f(x2 - 16)} ${f(ny + 80)}Z`;
      return {
        clipped: '',
        top:
          `<path d="${tail}" fill="${p.accentDark}" ${strokeAttrs(p.ink, 6)}/>` +
          `<path d="${d}" fill="none" ${strokeAttrs(p.ink, 30 + 12)}/>` +
          `<path d="${d}" fill="none" stroke="${p.accent}" stroke-width="30" stroke-linecap="round"/>` +
          `<g fill="${p.accentLight}">${dots}</g>`,
      };
    }
    default:
      return { clipped: '', top: '' };
  }
}

function bodyGroup(spec: MascotSpec, p: MascotPalette, sd: ShapeDef): string {
  const id = clipId(spec.body.shape);
  const head = headSvg(spec, p, sd);
  const neck = neckSvg(spec, p, sd);
  const plateCy = (sd.eyeY + sd.mouthY) / 2 + 4;
  const plate =
    spec.body.pattern !== 'none'
      ? `<ellipse cx="200" cy="${f(plateCy)}" rx="86" ry="${f((sd.mouthY - sd.eyeY) / 2 + 46)}" fill="${p.body}"/>`
      : '';
  const pocket =
    spec.extra === 'apron_pocket'
      ? `<rect x="168" y="${f(sd.bottom - 58)}" width="64" height="38" rx="10" fill="${p.accentLight}" ${strokeAttrs(p.ink, 5)}/>` +
        `<path d="M176 ${f(sd.bottom - 50)}L224 ${f(sd.bottom - 50)}" fill="none" stroke="${p.accentDark}" stroke-width="3" stroke-dasharray="6 5" stroke-linecap="round"/>`
      : '';
  const m = sd.mouthY;
  const mustache =
    spec.face.mustache === 'thin'
      ? `<path d="M198 ${f(m - 9)}Q176 ${f(m - 19)} 156 ${f(m - 7)}M202 ${f(m - 9)}Q224 ${f(m - 19)} 244 ${f(m - 7)}" fill="none" ${strokeAttrs(p.faceInk, 6)}/>`
      : '';
  const cheeks = spec.face.cheeks
    ? `<g fill="#FF6F7D" fill-opacity="0.5"><circle cx="${f(200 - sd.eyeDX - 22)}" cy="${f(m - 2)}" r="12"/><circle cx="${f(200 + sd.eyeDX + 22)}" cy="${f(m - 2)}" r="12"/></g>`
    : '';
  const h = sd.hl;
  const highlight =
    `<ellipse cx="${h.x}" cy="${h.y}" rx="${h.rx}" ry="${h.ry}" fill="#FFFFFF" fill-opacity="0.34" transform="rotate(${h.rot} ${h.x} ${h.y})"/>` +
    `<circle cx="${f(h.x + (h.rot < -60 ? 2 : h.rx * 0.95))}" cy="${f(h.y + (h.rot < -60 ? h.rx * 1.2 : h.ry * 1.1))}" r="4.5" fill="#FFFFFF" fill-opacity="0.34"/>`;
  return (
    `<defs><clipPath id="${id}"><path d="${sd.d}"/></clipPath></defs>` +
    legs(p, sd, spec.limbs.style) +
    `<path d="${sd.d}" fill="${p.body}"/>` +
    `<g clip-path="url(#${id})">${patternSvg(spec, p, sd)}${plate}${neck.clipped}${head.clipped}${pocket}</g>` +
    `<path d="${sd.d}" fill="none" ${strokeAttrs(p.ink, OL)}/>` +
    highlight +
    cheeks +
    mustache +
    neck.top +
    head.top
  );
}

// ---------------------------------------------------------------------------
// Limbs and hands
// ---------------------------------------------------------------------------

type HandKind = 'open' | 'thumb' | 'point' | 'none';
type Pt = [number, number];

interface ArmDef {
  side: 1 | -1;
  /** Offsets from the shoulder; dx is outward for that side. */
  ctrl: Pt;
  end: Pt;
  hand: HandKind;
  /** Pointing direction in degrees (0 = right, 180 = left). */
  angle?: number;
  front: boolean;
}

const LIMB_W: Record<LimbStyle, number> = { stick: 6, noodle: 15, mitten: 12 };
const HAND_R: Record<LimbStyle, number> = { stick: 11, noodle: 14, mitten: 17 };

function armPath(style: LimbStyle, a: Pt, c: Pt, b: Pt): string {
  if (style === 'noodle') {
    // Wavy: the two control points sit either side of the straight line.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bendX = (c[0] - (a[0] + b[0]) / 2) * 0.6;
    const bendY = (c[1] - (a[1] + b[1]) / 2) * 0.6;
    return (
      `M${f(a[0])} ${f(a[1])}C${f(a[0] + dx / 3 + nx * 14 + bendX)} ${f(a[1] + dy / 3 + ny * 14 + bendY)} ` +
      `${f(a[0] + (dx * 2) / 3 - nx * 14 + bendX)} ${f(a[1] + (dy * 2) / 3 - ny * 14 + bendY)} ${f(b[0])} ${f(b[1])}`
    );
  }
  return `M${f(a[0])} ${f(a[1])}Q${f(c[0])} ${f(c[1])} ${f(b[0])} ${f(b[1])}`;
}

function handSvg(p: MascotPalette, style: LimbStyle, x: number, y: number, kind: HandKind, side: number, angle = 0): string {
  const r = HAND_R[style];
  if (kind === 'none') return '';
  let parts = `<circle cx="${f(x)}" cy="${f(y)}" r="${r}"/>`;
  if (kind === 'thumb') {
    const tw = r * 0.78;
    parts += `<rect x="${f(x - tw / 2 + side * r * 0.1)}" y="${f(y - r * 2.1)}" width="${f(tw)}" height="${f(r * 1.6)}" rx="${f(tw / 2)}"/>`;
  } else if (kind === 'point') {
    const fw = r * 0.62;
    parts += `<rect x="${f(x)}" y="${f(y - fw / 2 - r * 0.15)}" width="${f(r * 1.7)}" height="${f(fw)}" rx="${f(fw / 2)}" transform="rotate(${angle} ${f(x)} ${f(y)})"/>`;
  } else if (style === 'mitten') {
    parts += `<ellipse cx="${f(x - side * r * 0.85)}" cy="${f(y - r * 0.35)}" rx="${f(r * 0.4)}" ry="${f(r * 0.6)}" transform="rotate(${-side * 30} ${f(x - side * r * 0.85)} ${f(y - r * 0.35)})"/>`;
  }
  return union(parts, p.limb, p.ink, LO);
}

function armSvg(p: MascotPalette, style: LimbStyle, sd: ShapeDef, arm: ArmDef): string {
  const rx = 200 + arm.side * (sd.shoulderHW - 8);
  const ry = sd.shoulderY;
  const c: Pt = [rx + arm.side * arm.ctrl[0], ry + arm.ctrl[1]];
  const e: Pt = [rx + arm.side * arm.end[0], ry + arm.end[1]];
  const d = armPath(style, [rx, ry], c, e);
  const w = LIMB_W[style];
  return (
    `<path d="${d}" fill="none" ${strokeAttrs(p.ink, w + LO * 2)}/>` +
    `<path d="${d}" fill="none" stroke="${p.limb}" stroke-width="${w}" stroke-linecap="round"/>` +
    handSvg(p, style, e[0], e[1], arm.hand, arm.side, arm.angle)
  );
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

type EyeState = 'open' | 'closed' | 'wide' | 'up' | 'wink';
type MouthKind = 'smile' | 'grin' | 'big_o' | 'small_o' | 'hmm';
type BrowKind = 'normal' | 'raised' | 'think' | 'up';

interface PoseDef {
  arms: ArmDef[];
  eyes: EyeState;
  mouth: MouthKind;
  brows: BrowKind;
  /** Vertical offset of the whole character (negative = up). */
  lift: number;
  /** Prayer hands drawn at the chest. */
  prayer?: boolean;
}

const DOWN = (side: 1 | -1): ArmDef => ({ side, ctrl: [40, 14], end: [32, 66], hand: 'open', front: false });

function poseDef(pose: MascotPose, sd: ShapeDef): PoseDef {
  switch (pose) {
    case 'namaste': {
      const ty = sd.mouthY + 46 - sd.shoulderY;
      const arm = (side: 1 | -1): ArmDef => ({
        side,
        ctrl: [70 - (sd.shoulderHW - 8), ty + 12],
        end: [-(sd.shoulderHW - 8) + 4, ty],
        hand: 'none',
        front: true,
      });
      return { arms: [arm(-1), arm(1)], eyes: 'closed', mouth: 'smile', brows: 'normal', lift: 0, prayer: true };
    }
    case 'wave':
      return {
        arms: [DOWN(-1), { side: 1, ctrl: [62, -22], end: [46, -110], hand: 'open', front: false }],
        eyes: 'open',
        mouth: 'grin',
        brows: 'normal',
        lift: 0,
      };
    case 'happy':
      return { arms: [DOWN(-1), DOWN(1)], eyes: 'open', mouth: 'grin', brows: 'normal', lift: -5 };
    case 'thumbs_up':
      return {
        arms: [DOWN(-1), { side: 1, ctrl: [56, 6], end: [34, -50], hand: 'thumb', front: false }],
        eyes: 'wink',
        mouth: 'smile',
        brows: 'normal',
        lift: 0,
      };
    case 'point':
      return {
        arms: [{ side: -1, ctrl: [40, -2], end: [50, -22], hand: 'point', angle: 180, front: false }, DOWN(1)],
        eyes: 'open',
        mouth: 'small_o',
        brows: 'normal',
        lift: 0,
      };
    case 'excited':
      return {
        arms: [
          { side: -1, ctrl: [58, -34], end: [42, -126], hand: 'open', front: false },
          { side: 1, ctrl: [58, -34], end: [42, -126], hand: 'open', front: false },
        ],
        eyes: 'wide',
        mouth: 'big_o',
        brows: 'up',
        lift: -14,
      };
    case 'thinking': {
      const tx = 200 + 46 - (200 + sd.shoulderHW - 8);
      const ty = sd.mouthY + 34 - sd.shoulderY;
      return {
        arms: [DOWN(-1), { side: 1, ctrl: [34, ty + 30], end: [tx, ty], hand: 'open', front: true }],
        eyes: 'up',
        mouth: 'hmm',
        brows: 'think',
        lift: 0,
      };
    }
    case 'celebrate':
      return {
        arms: [
          { side: -1, ctrl: [66, -20], end: [62, -112], hand: 'open', front: false },
          { side: 1, ctrl: [66, -20], end: [62, -112], hand: 'open', front: false },
        ],
        eyes: 'open',
        mouth: 'grin',
        brows: 'raised',
        lift: -10,
      };
  }
}

// ---------------------------------------------------------------------------
// Face (pose-specific)
// ---------------------------------------------------------------------------

function arcUp(p: MascotPalette, cx: number, cy: number): string {
  return `<path d="M${f(cx - 15)} ${f(cy + 5)}Q${f(cx)} ${f(cy - 15)} ${f(cx + 15)} ${f(cy + 5)}" fill="none" ${strokeAttrs(p.faceInk, 7)}/>`;
}

function eyeSvg(p: MascotPalette, style: MascotSpec['face']['eyes'], cx: number, cy: number, state: EyeState): string {
  if (state === 'closed') return arcUp(p, cx, cy);
  const wide = state === 'wide';
  const up = state === 'up';
  const ox = up ? 4 : 0;
  const oy = up ? -7 : 0;
  switch (style) {
    case 'dot': {
      const r = wide ? 15 : 12;
      return (
        `<circle cx="${f(cx + ox)}" cy="${f(cy + oy)}" r="${r}" fill="${p.faceInk}"/>` +
        `<circle cx="${f(cx + ox + 4)}" cy="${f(cy + oy - 4)}" r="3.6" fill="${p.eyeHi}"/>`
      );
    }
    case 'round': {
      const r = wide ? 26 : 22;
      const pr = wide ? 9 : 11;
      return (
        `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="#FFFFFF" ${strokeAttrs(p.faceInk, 6)}/>` +
        `<circle cx="${f(cx + ox)}" cy="${f(cy + oy)}" r="${pr}" fill="${DARK}"/>` +
        `<circle cx="${f(cx + ox + 4)}" cy="${f(cy + oy - 4)}" r="3.6" fill="#FFFFFF"/>`
      );
    }
    case 'shine': {
      const r = wide ? 21 : 18;
      return (
        `<circle cx="${f(cx + ox)}" cy="${f(cy + oy)}" r="${r}" fill="${p.faceInk}"/>` +
        `<circle cx="${f(cx + ox - 5)}" cy="${f(cy + oy - 6)}" r="${wide ? 7.5 : 6.5}" fill="${p.eyeHi}"/>` +
        `<circle cx="${f(cx + ox + 6)}" cy="${f(cy + oy + 5)}" r="3" fill="${p.eyeHi}"/>`
      );
    }
    case 'sleepy': {
      if (wide) {
        return (
          `<circle cx="${f(cx)}" cy="${f(cy)}" r="14" fill="${p.faceInk}"/>` +
          `<circle cx="${f(cx + 4)}" cy="${f(cy - 4)}" r="3.6" fill="${p.eyeHi}"/>`
        );
      }
      const y = cy + oy;
      return (
        `<path d="M${f(cx - 16)} ${f(y - 3)}Q${f(cx)} ${f(y + 15)} ${f(cx + 16)} ${f(y - 3)}" fill="none" ${strokeAttrs(p.faceInk, 7)}/>` +
        `<path d="M${f(cx + 13)} ${f(y + 2)}l6 6" fill="none" ${strokeAttrs(p.faceInk, 4)}/>`
      );
    }
  }
}

const EYE_TOP: Record<MascotSpec['face']['eyes'], number> = { dot: 15, round: 26, shine: 21, sleepy: 16 };

function facePart(spec: MascotSpec, p: MascotPalette, sd: ShapeDef, pd: PoseDef): string {
  const lx = 200 - sd.eyeDX;
  const rx = 200 + sd.eyeDX;
  const ey = sd.eyeY;
  const st = pd.eyes;
  let out = '';
  out += eyeSvg(p, spec.face.eyes, lx, ey, st === 'wink' ? 'open' : st);
  out += eyeSvg(p, spec.face.eyes, rx, ey, st === 'wink' ? 'closed' : st);

  if (spec.face.brows) {
    const by = ey - EYE_TOP[spec.face.eyes] - 13 - (st === 'wide' ? 4 : 0) - (spec.extra === 'specs' ? 8 : 0);
    const br = (x: number, dy: number, tilt: number) =>
      `<path d="M${f(x - 14)} ${f(by + dy + 4 + tilt)}Q${f(x)} ${f(by + dy - 5)} ${f(x + 14)} ${f(by + dy + 4 - tilt)}" fill="none" ${strokeAttrs(p.faceInk, 7)}/>`;
    switch (pd.brows) {
      case 'raised':
        out += br(lx, -6, 0) + br(rx, -6, 0);
        break;
      case 'up':
        out += br(lx, -11, 0) + br(rx, -11, 0);
        break;
      case 'think':
        out += br(lx, 4, 3) + br(rx, -14, -2);
        break;
      default:
        out += br(lx, 0, 0) + br(rx, 0, 0);
    }
  }

  const m = sd.mouthY;
  switch (pd.mouth) {
    case 'smile':
      out += `<path d="M176 ${f(m)}Q200 ${f(m + 26)} 224 ${f(m)}" fill="none" ${strokeAttrs(p.faceInk, 7)}/>`;
      break;
    case 'grin':
      out +=
        `<path d="M170 ${f(m - 1)}Q200 ${f(m + 7)} 230 ${f(m - 1)}Q226 ${f(m + 35)} 200 ${f(m + 37)}Q174 ${f(m + 35)} 170 ${f(m - 1)}Z" fill="${MOUTH}" ${strokeAttrs(p.faceInk, 6)}/>` +
        `<ellipse cx="200" cy="${f(m + 26)}" rx="13" ry="7" fill="${TONGUE}"/>`;
      break;
    case 'big_o':
      out +=
        `<ellipse cx="200" cy="${f(m + 14)}" rx="18" ry="22" fill="${MOUTH}" ${strokeAttrs(p.faceInk, 6)}/>` +
        `<ellipse cx="200" cy="${f(m + 26)}" rx="10" ry="6" fill="${TONGUE}"/>`;
      break;
    case 'small_o':
      out += `<ellipse cx="200" cy="${f(m + 10)}" rx="12" ry="14" fill="${MOUTH}" ${strokeAttrs(p.faceInk, 6)}/>`;
      break;
    case 'hmm':
      out += `<path d="M184 ${f(m + 12)}Q194 ${f(m + 5)} 202 ${f(m + 11)}T220 ${f(m + 8)}" fill="none" ${strokeAttrs(p.faceInk, 7)}/>`;
      break;
  }
  return out;
}

function overlayPart(spec: MascotSpec, p: MascotPalette, sd: ShapeDef): string {
  if (spec.extra !== 'specs') return '';
  const r = spec.face.eyes === 'round' ? 31 : 27;
  const lx = 200 - sd.eyeDX;
  const rx = 200 + sd.eyeDX;
  const y = sd.eyeY;
  return (
    `<path d="M${f(lx + r)} ${f(y)}Q200 ${f(y - 8)} ${f(rx - r)} ${f(y)}M${f(lx - r)} ${f(y)}L${f(lx - r - 14)} ${f(y - 4)}M${f(rx + r)} ${f(y)}L${f(rx + r + 14)} ${f(y - 4)}" fill="none" ${strokeAttrs(p.ink, 6)}/>` +
    `<circle cx="${f(lx)}" cy="${f(y)}" r="${r}" fill="#FFFFFF" fill-opacity="0.16" ${strokeAttrs(p.ink, 7)}/>` +
    `<circle cx="${f(rx)}" cy="${f(y)}" r="${r}" fill="#FFFFFF" fill-opacity="0.16" ${strokeAttrs(p.ink, 7)}/>` +
    `<path d="M${f(lx - r * 0.55)} ${f(y - r * 0.45)}l8 -5M${f(rx - r * 0.55)} ${f(y - r * 0.45)}l8 -5" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`
  );
}

// ---------------------------------------------------------------------------
// Props (pose-specific, outside the body)
// ---------------------------------------------------------------------------

function sticker(d: string, fill: string, w = 4): string {
  return `<path d="${d}" fill="${fill}" ${strokeAttrs(DARK, w)}/>`;
}

function motionLines(cx: number, cy: number, angles: number[], r1: number, r2: number): string {
  const d = angles
    .map((a) => {
      const t = (a * Math.PI) / 180;
      return `M${f(cx + Math.cos(t) * r1)} ${f(cy + Math.sin(t) * r1)}L${f(cx + Math.cos(t) * r2)} ${f(cy + Math.sin(t) * r2)}`;
    })
    .join('');
  return `<path d="${d}" fill="none" ${strokeAttrs(DARK, 11)}/><path d="${d}" fill="none" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/>`;
}

function handPos(sd: ShapeDef, a: ArmDef, lift: number): Pt {
  return [200 + a.side * (sd.shoulderHW - 8 + a.end[0]), sd.shoulderY + a.end[1] + lift];
}

function propsPart(pose: MascotPose, p: MascotPalette, sd: ShapeDef, pd: PoseDef): string {
  switch (pose) {
    case 'wave': {
      const a = pd.arms.find((x) => x.side === 1 && x.hand === 'open' && x.end[1] < 0)!;
      const [hx, hy] = handPos(sd, a, pd.lift);
      return motionLines(hx + 6, hy - 2, [-80, -45, -10], 27, 41);
    }
    case 'excited': {
      let out = '';
      for (const a of pd.arms) {
        const [hx, hy] = handPos(sd, a, pd.lift);
        out += motionLines(hx, hy, a.side === 1 ? [-70, -35, -5] : [-110, -145, -175], 25, 38);
      }
      return out;
    }
    case 'thinking': {
      const dots: [number, number, number][] = [
        [318, 126, 6],
        [334, 100, 9],
        [352, 66, 13],
      ];
      return dots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFFFFF" ${strokeAttrs(DARK, 4)}/>`).join('');
    }
    case 'celebrate': {
      const stars: [number, number, number, string][] = [
        [58, 62, 22, GOLD],
        [346, 52, 18, GOLD],
        [112, 28, 12, '#FFFFFF'],
        [298, 24, 11, p.accentLight],
        [22, 150, 10, p.accentLight],
        [380, 150, 10, '#FFFFFF'],
      ];
      let out = stars.map(([x, y, r, c]) => sticker(star(x, y, r), c)).join('');
      const conf: [number, number, number, string][] = [
        [88, 104, 5, p.accent],
        [320, 100, 5, GOLD],
        [36, 100, 4, '#FFFFFF'],
        [368, 96, 4, p.accent],
        [150, 44, 4, GOLD],
      ];
      out += conf.map(([x, y, r, c]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" ${strokeAttrs(DARK, 2.5)}/>`).join('');
      return out;
    }
    default:
      return '';
  }
}

function prayerSvg(p: MascotPalette, style: LimbStyle, sd: ShapeDef): string {
  const r = HAND_R[style];
  const x = 200;
  const y = sd.mouthY + 46;
  const k = 1.45;
  const d = `M${x} ${f(y - r * 1.9 * k)}Q${f(x + r * 1.5 * k)} ${f(y - r * 0.3 * k)} ${x} ${f(y + r * 1.1 * k)}Q${f(x - r * 1.5 * k)} ${f(y - r * 0.3 * k)} ${x} ${f(y - r * 1.9 * k)}Z`;
  return (
    `<path d="${d}" fill="${p.limb}" ${strokeAttrs(p.ink, LO + 1)}/>` +
    `<path d="M${x} ${f(y - r * 1.5 * k)}L${x} ${f(y + r * 0.6 * k)}" fill="none" stroke="${p.ink}" stroke-width="3.5" stroke-linecap="round"/>`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MascotParts {
  /** Ground shadow (smaller when the character jumps). */
  ground: string;
  /** Arms drawn behind the body. */
  back: string;
  /** Legs, body, pattern, head and neck items, cheeks: identical in every pose for one spec. */
  body: string;
  /** Arms and hands drawn in front of the body. */
  front: string;
  /** Eyes, brows, mouth. */
  face: string;
  /** Glasses (static, over the eyes). */
  overlay: string;
  /** Sparkles, wave lines, thought dots. */
  props: string;
  /** Vertical lift of the character in this pose. */
  lift: number;
}

export function drawMascotParts(spec: MascotSpec, pose: MascotPose): MascotParts {
  const sd = SHAPES[spec.body.shape];
  const p = mascotPalette(spec);
  const pd = poseDef(pose, sd);
  const style = spec.limbs.style;
  const arms = (front: boolean) =>
    pd.arms
      .filter((a) => a.front === front)
      .map((a) => armSvg(p, style, sd, a))
      .join('');
  const shrink = pd.lift < -8 ? 0.8 : 1;
  return {
    ground: `<ellipse cx="200" cy="${f(sd.bottom + 30)}" rx="${f(104 * shrink)}" ry="${f(11 * shrink)}" fill="#000000" fill-opacity="0.16"/>`,
    back: arms(false),
    body: bodyGroup(spec, p, sd),
    front: arms(true) + (pd.prayer ? prayerSvg(p, style, sd) : ''),
    face: facePart(spec, p, sd, pd),
    overlay: overlayPart(spec, p, sd),
    props: propsPart(pose, p, sd, pd),
    lift: pd.lift,
  };
}

/** The mascot as an SVG `<g>` fragment in a 400x400 space, ready for the renderer's mascot slot. */
export function drawMascot(spec: MascotSpec, pose: MascotPose): string {
  const q = drawMascotParts(spec, pose);
  const lift = q.lift ? ` transform="translate(0 ${q.lift})"` : '';
  return `<g>${q.ground}<g${lift}>${q.back}<g data-part="body">${q.body}</g>${q.front}${q.face}${q.overlay}</g>${q.props}</g>`;
}

/** A complete transparent SVG document (viewBox 0 0 400 400) for export. */
export function drawMascotDocument(spec: MascotSpec, pose: MascotPose, size = MASCOT_VIEW): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${MASCOT_VIEW} ${MASCOT_VIEW}">` +
    drawMascot(spec, pose) +
    '</svg>'
  );
}
