/**
 * Tween's movement planner: pure geometry, no DOM (mascot.md 3.2).
 *
 * Tween only ever moves along the bottom edge of the viewport (a horizontal offset `x`); it never walks across content.
 * To point at something it (1) asks for a scroll that puts the target's top below the header, (2) picks a stand-point on
 * the bottom edge that does not sit over the target's text, preferring the gutter beside the content and otherwise a
 * bottom corner, and (3) says which way to point. All inputs are viewport coordinates in CSS pixels.
 */
import type { PointDir } from "./machine";

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Viewport = { width: number; height: number };

export const ROAM_MIN_WIDTH = 768;
export const WALK_SPEED = 190; // px per second
export const WALK_MIN_MS = 380;
export const WALK_MAX_MS = 1700;

export const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height });
export const overlapArea = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Roaming is for desktop widths with motion allowed and the visitor's consent (not paused, not "do not roam"). */
export function canRoam(o: { width: number; reducedMotion: boolean; paused: boolean; noRoam: boolean }): boolean {
  return o.width >= ROAM_MIN_WIDTH && !o.reducedMotion && !o.paused && !o.noRoam;
}

/** Keep the sprite fully inside the viewport horizontally, at every size from tiny phones to wide monitors. */
export function clampX(x: number, vw: number, w: number, margin: number): number {
  const max = Math.max(0, vw - w - margin);
  const min = Math.min(margin, max);
  return Math.min(Math.max(x, min), max);
}

export const homeX = (vw: number, w: number, margin: number): number => clampX(vw - w - margin, vw, w, margin);

export function walkDuration(from: number, to: number): number {
  return Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, Math.round((Math.abs(to - from) / WALK_SPEED) * 1000)));
}

/**
 * How far to scroll (positive = down) so the target is readable above Tween's strip.
 * A target already inside the readable area is left alone; a taller one or an off-screen one gets its top aligned
 * just under the header, so its first screen of content is what the visitor sees.
 */
export function planScroll(o: { targetTop: number; targetBottom: number; viewportHeight: number; headerOffset: number; stripHeight: number }): number {
  const readableBottom = o.viewportHeight - o.stripHeight;
  const height = o.targetBottom - o.targetTop;
  const fits = height <= readableBottom - o.headerOffset;
  const inside = o.targetTop >= o.headerOffset - 4 && o.targetBottom <= readableBottom + 4;
  if (fits && inside) return 0;
  if (!fits && o.targetTop >= o.headerOffset - 4 && o.targetTop <= o.headerOffset + 120) return 0;
  return Math.round(o.targetTop - o.headerOffset);
}

export type PointPlan = {
  /** Left offset of the sprite from the viewport's left edge. */
  x: number;
  facing: "left" | "right";
  pointDir: PointDir;
  /** True when the stand-point does not touch any `avoid` rect. */
  clear: boolean;
  duration: number;
};

export type PointInput = {
  viewport: Viewport;
  /** Sprite footprint. */
  size: { width: number; height: number };
  /** Distance from the viewport bottom to the sprite's feet. */
  bottomOffset: number;
  margin: number;
  currentX: number;
  /** Target rect after scrolling (viewport coordinates); null when the target cannot be found. */
  target: Rect | null;
  /** Horizontal extent of the target's text, for finding a gutter. Falls back to the target rect. */
  contentLeft?: number;
  contentRight?: number;
  /** Rects Tween must not stand on: target text, form fields, the primary call to action. */
  avoid: Rect[];
  /** Extra footprint stacked above the sprite while the panel is open (it shares the stand-point's x range). */
  panel?: { width: number; height: number } | null;
};

export function planPoint(i: PointInput): PointPlan {
  const { viewport: vp, size, margin } = i;
  const top = vp.height - i.bottomOffset - size.height;
  const footprint = (x: number): Rect => {
    const r = rect(x, top, size.width, size.height);
    if (i.panel) {
      const px = Math.min(Math.max(x + size.width - i.panel.width, 0), Math.max(0, vp.width - i.panel.width));
      return { left: Math.min(r.left, px), top: top - i.panel.height, right: Math.max(r.right, px + i.panel.width), bottom: r.bottom };
    }
    return r;
  };

  const cl = i.contentLeft ?? i.target?.left ?? 0;
  const cr = i.contentRight ?? i.target?.right ?? vp.width;
  const candidates = new Set<number>();
  candidates.add(homeX(vp.width, size.width, margin));
  candidates.add(clampX(margin, vp.width, size.width, margin));
  const GUTTER_MARGIN = 4; // a gutter stand-point may sit closer to the edge than a dock does
  if (cl - size.width >= GUTTER_MARGIN * 2) candidates.add(clampX((cl - size.width) / 2, vp.width, size.width, GUTTER_MARGIN)); // left gutter, centred
  if (vp.width - cr - size.width >= GUTTER_MARGIN * 2) candidates.add(clampX(cr + (vp.width - cr - size.width) / 2, vp.width, size.width, GUTTER_MARGIN)); // right gutter

  const score = (x: number) => i.avoid.reduce((sum, a) => sum + overlapArea(footprint(x), a), 0);
  const list = [...candidates].map((x) => ({ x, overlap: score(x) }));
  list.sort((a, b) => a.overlap - b.overlap || Math.abs(a.x - i.currentX) - Math.abs(b.x - i.currentX));
  const best = list[0] ?? { x: homeX(vp.width, size.width, margin), overlap: 0 };

  const centre = best.x + size.width / 2;
  let pointDir: PointDir = "up";
  let facing: "left" | "right" = centre >= vp.width / 2 ? "left" : "right";
  if (i.target) {
    if (centre < i.target.left) pointDir = "right";
    else if (centre > i.target.right) pointDir = "left";
    else pointDir = "up";
    if (pointDir !== "up") facing = pointDir;
    else facing = centre >= (i.target.left + i.target.right) / 2 ? "left" : "right";
  }
  return { x: best.x, facing, pointDir, clear: best.overlap === 0, duration: walkDuration(i.currentX, best.x) };
}

/** Walking direction from one x to another. */
export const walkDir = (from: number, to: number): "left" | "right" => (to >= from ? "right" : "left");

/** Where the panel opens relative to the sprite: toward the side with room. */
export function panelAlign(x: number, panelWidth: number, vw: number): "left" | "right" {
  return x + panelWidth <= vw ? "left" : "right";
}
