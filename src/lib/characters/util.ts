// Small geometry helpers for the character rig: points, 2D matrices, a bounds accumulator, number formatting.
// Pure and deterministic.

export type Pt = readonly [number, number];

export const R = Math.PI / 180;

/** One decimal, like the kit's rig. */
export const f = (n: number): string => (Math.round(n * 10) / 10).toString();

export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** sin wave over period T seconds. */
export const wav = (t: number, T: number): number => Math.sin((2 * Math.PI * t) / T);

// ---- 2D affine matrices [a b c d e f], applied like an SVG transform list (leftmost applies last) ----

export type Mat = readonly [number, number, number, number, number, number];

export const IDENT: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Multiplies matrices left to right, the same order as an SVG transform attribute. */
export function chain(...ms: Mat[]): Mat {
  return ms.reduce((acc, m) => mul(acc, m), IDENT);
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number = sx): Mat => [sx, 0, 0, sy, 0, 0];
export const skewX = (deg: number): Mat => [1, 0, Math.tan(deg * R), 1, 0, 0];
export function rotate(deg: number, cx = 0, cy = 0): Mat {
  const c = Math.cos(deg * R);
  const s = Math.sin(deg * R);
  return chain(translate(cx, cy), [c, s, -s, c, 0, 0], translate(-cx, -cy));
}

export function apply(m: Mat, x: number, y: number): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// ---- bounds ----

/** Collects points (transformed by a matrix) and gives their box. */
export class Box {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  add(x: number, y: number): this {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
    return this;
  }

  /** A rectangle in local coordinates, mapped through `m`. */
  rect(m: Mat, x: number, y: number, w: number, h: number): this {
    for (const [px, py] of [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ]) {
      const [tx, ty] = apply(m, px, py);
      this.add(tx, ty);
    }
    return this;
  }

  /** A circle or ellipse in local coordinates (the box of its rotated bounding rectangle). */
  ellipse(m: Mat, cx: number, cy: number, rx: number, ry: number = rx): this {
    const [tx, ty] = apply(m, cx, cy);
    const hw = Math.hypot(m[0] * rx, m[2] * ry);
    const hh = Math.hypot(m[1] * rx, m[3] * ry);
    this.add(tx - hw, ty - hh);
    this.add(tx + hw, ty + hh);
    return this;
  }

  /** A line segment with round caps of the given stroke width. */
  seg(m: Mat, x1: number, y1: number, x2: number, y2: number, width: number): this {
    const r = width / 2;
    this.ellipse(m, x1, y1, r);
    this.ellipse(m, x2, y2, r);
    return this;
  }

  get empty(): boolean {
    return this.minX > this.maxX;
  }

  toRect(): { x: number; y: number; w: number; h: number } {
    return { x: this.minX, y: this.minY, w: this.maxX - this.minX, h: this.maxY - this.minY };
  }
}

/** Rounds to 0.1 so anchors are stable and short. */
export const r1 = (n: number): number => Math.round(n * 10) / 10;
