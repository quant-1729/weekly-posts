// Path data for shapes, masks and badges, in a local w x h box (origin top-left). Pure.

const r = (n: number) => Math.round(n * 10) / 10;

/** A small seeded random (deterministic: the same seed draws the same blob in the browser and on the server). */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s % 100000) / 100000;
  };
}

export function roundRect(w: number, h: number, rad: number, x = 0, y = 0): string {
  const k = Math.max(0, Math.min(rad, w / 2, h / 2));
  if (k === 0) return `M${r(x)} ${r(y)}H${r(x + w)}V${r(y + h)}H${r(x)}Z`;
  return `M${r(x + k)} ${r(y)}H${r(x + w - k)}A${r(k)} ${r(k)} 0 0 1 ${r(x + w)} ${r(y + k)}V${r(y + h - k)}A${r(k)} ${r(k)} 0 0 1 ${r(x + w - k)} ${r(y + h)}H${r(x + k)}A${r(k)} ${r(k)} 0 0 1 ${r(x)} ${r(y + h - k)}V${r(y + k)}A${r(k)} ${r(k)} 0 0 1 ${r(x + k)} ${r(y)}Z`;
}

export const ellipse = (w: number, h: number, x = 0, y = 0): string =>
  `M${r(x)} ${r(y + h / 2)}A${r(w / 2)} ${r(h / 2)} 0 1 0 ${r(x + w)} ${r(y + h / 2)}A${r(w / 2)} ${r(h / 2)} 0 1 0 ${r(x)} ${r(y + h / 2)}Z`;

/** Smooth closed curve through points (Catmull-Rom to cubic Bézier). */
function smooth(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`;
  }
  return d + 'Z';
}

export function blob(w: number, h: number, seed = 1): string {
  const rand = rng(seed + 7);
  const n = 7;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const k = 0.78 + rand() * 0.22;
    pts.push([w / 2 + Math.cos(a) * (w / 2) * k, h / 2 + Math.sin(a) * (h / 2) * k]);
  }
  return smooth(pts);
}

/** A star-burst (sale sticker) with `points` spikes. */
export function burst(w: number, h: number, points = 18, inner = 0.84): string {
  const pts: string[] = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 === 0 ? 1 : inner;
    pts.push(`${r(w / 2 + Math.cos(a) * (w / 2) * k)} ${r(h / 2 + Math.sin(a) * (h / 2) * k)}`);
  }
  return `M${pts.join('L')}Z`;
}

export function star(w: number, h: number, points = 5): string {
  return burst(w, h, points, 0.45);
}

/** Scalloped seal edge. */
export function scallop(w: number, h: number, bumps = 22): string {
  const pts: [number, number][] = [];
  const n = bumps * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % 2 === 0 ? 1 : 0.93;
    pts.push([w / 2 + Math.cos(a) * (w / 2) * k, h / 2 + Math.sin(a) * (h / 2) * k]);
  }
  return smooth(pts);
}

export function arch(w: number, h: number): string {
  const rad = Math.min(w / 2, h);
  return `M0 ${r(h)}V${r(rad)}A${r(w / 2)} ${r(rad)} 0 0 1 ${r(w)} ${r(rad)}V${r(h)}Z`;
}

export function ribbon(w: number, h: number): string {
  const n = Math.min(h * 0.45, w * 0.12);
  return `M0 0H${r(w)}L${r(w - n)} ${r(h / 2)}L${r(w)} ${r(h)}H0L${r(n)} ${r(h / 2)}Z`;
}

export function flag(w: number, h: number): string {
  const n = Math.min(h * 0.5, w * 0.15);
  return `M0 0H${r(w)}L${r(w - n)} ${r(h / 2)}L${r(w)} ${r(h)}H0Z`;
}

/** A price tag pointing left, with a hole. */
export function tag(w: number, h: number): string {
  const n = Math.min(h * 0.5, w * 0.25);
  const k = Math.min(h * 0.18, 30);
  return `M${r(n)} 0H${r(w - k)}A${r(k)} ${r(k)} 0 0 1 ${r(w)} ${r(k)}V${r(h - k)}A${r(k)} ${r(k)} 0 0 1 ${r(w - k)} ${r(h)}H${r(n)}L0 ${r(h / 2)}Z${ellipse(h * 0.16, h * 0.16, n * 0.75, h / 2 - h * 0.08)}`;
}

export function wave(w: number, h: number, seed = 1): string {
  const amp = Math.min(h * 0.18, 60);
  const waves = 2 + (seed % 3);
  let d = `M0 ${r(amp)}`;
  const seg = w / waves;
  for (let i = 0; i < waves; i++) {
    const x0 = i * seg;
    d += `C${r(x0 + seg * 0.3)} ${r(amp * (i % 2 ? 2 : -0.2))} ${r(x0 + seg * 0.7)} ${r(amp * (i % 2 ? -0.2 : 2))} ${r(x0 + seg)} ${r(amp)}`;
  }
  return d + `V${r(h)}H0Z`;
}

export function squiggle(w: number, h: number, seed = 1): string {
  const waves = 3 + (seed % 4);
  const seg = w / waves;
  let d = `M0 ${r(h / 2)}`;
  for (let i = 0; i < waves; i++) d += `Q${r(i * seg + seg / 2)} ${r(i % 2 ? h : 0)} ${r((i + 1) * seg)} ${r(h / 2)}`;
  return d;
}

export const triangle = (w: number, h: number): string => `M${r(w / 2)} 0L${r(w)} ${r(h)}H0Z`;
export const diamond = (w: number, h: number): string => `M${r(w / 2)} 0L${r(w)} ${r(h / 2)}L${r(w / 2)} ${r(h)}L0 ${r(h / 2)}Z`;
export const hexagon = (w: number, h: number): string => `M${r(w * 0.25)} 0H${r(w * 0.75)}L${r(w)} ${r(h / 2)}L${r(w * 0.75)} ${r(h)}H${r(w * 0.25)}L0 ${r(h / 2)}Z`;

export function squircle(w: number, h: number): string {
  const k = 0.18;
  return `M${r(w / 2)} 0C${r(w * (1 - k))} 0 ${r(w)} ${r(h * k)} ${r(w)} ${r(h / 2)}C${r(w)} ${r(h * (1 - k))} ${r(w * (1 - k))} ${r(h)} ${r(w / 2)} ${r(h)}C${r(w * k)} ${r(h)} 0 ${r(h * (1 - k))} 0 ${r(h / 2)}C0 ${r(h * k)} ${r(w * k)} 0 ${r(w / 2)} 0Z`;
}

export function ticket(w: number, h: number, rad: number): string {
  const n = Math.min(h * 0.12, 40);
  const k = Math.max(0, Math.min(rad, w / 4, h / 4));
  return `M${r(k)} 0H${r(w - k)}A${r(k)} ${r(k)} 0 0 1 ${r(w)} ${r(k)}V${r(h / 2 - n)}A${r(n)} ${r(n)} 0 0 0 ${r(w)} ${r(h / 2 + n)}V${r(h - k)}A${r(k)} ${r(k)} 0 0 1 ${r(w - k)} ${r(h)}H${r(k)}A${r(k)} ${r(k)} 0 0 1 0 ${r(h - k)}V${r(h / 2 + n)}A${r(n)} ${r(n)} 0 0 0 0 ${r(h / 2 - n)}V${r(k)}A${r(k)} ${r(k)} 0 0 1 ${r(k)} 0Z`;
}

export function ring(w: number, h: number, thickness = 0.12): string {
  const t = Math.min(w, h) * thickness;
  return ellipse(w, h) + ellipse(w - 2 * t, h - 2 * t, t, t);
}

/** A mask outline for a picture. */
export function maskPath(mask: string, w: number, h: number, radius: number, seed = 3): string {
  switch (mask) {
    case 'rounded':
      return roundRect(w, h, radius);
    case 'circle':
      return ellipse(w, h);
    case 'arch':
      return arch(w, h);
    case 'blob':
      return blob(w, h, seed);
    case 'squircle':
      return squircle(w, h);
    case 'diamond':
      return diamond(w, h);
    case 'hexagon':
      return hexagon(w, h);
    case 'ticket':
      return ticket(w, h, radius);
    default:
      return roundRect(w, h, 0);
  }
}

export function badgePath(shape: string, w: number, h: number, points = 20): string {
  switch (shape) {
    case 'burst':
      return burst(w, h, points, 0.86);
    case 'circle':
      return ellipse(w, h);
    case 'ribbon':
      return ribbon(w, h);
    case 'flag':
      return flag(w, h);
    case 'tag':
      return tag(w, h);
    case 'stamp':
      return scallop(w, h);
    default:
      return roundRect(w, h, h / 2);
  }
}

/** The part of a badge words may use (as a share of the box). */
export const BADGE_INNER: Record<string, { w: number; h: number; dx?: number }> = {
  burst: { w: 0.68, h: 0.6 },
  circle: { w: 0.72, h: 0.62 },
  stamp: { w: 0.66, h: 0.58 },
  ribbon: { w: 0.74, h: 0.7 },
  flag: { w: 0.78, h: 0.7, dx: -0.04 },
  tag: { w: 0.66, h: 0.72, dx: 0.08 },
  pill: { w: 0.84, h: 0.68 },
};
