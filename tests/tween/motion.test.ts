import { describe, expect, it } from "vitest";
import {
  DESKTOP_BOTTOM,
  NAV_CLEARANCE,
  ROAM_MIN_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_W,
  TOP_BAR_MIN_WIDTH,
  canRoam,
  clampX,
  dockLayout,
  homeX,
  overlapArea,
  panelAlign,
  planPoint,
  planScroll,
  rect,
  shellInset,
  walkDuration,
} from "@/lib/tween/motion";

// Ported from the Tween kit's unit tests (movement planner), with the Weekly Posts roaming width and dock.
describe("movement planner", () => {
  it("clamps inside the viewport at every size, even tiny ones", () => {
    for (const vw of [320, 375, 768, 1024, 1440, 1920, 90]) {
      for (const x of [-500, 0, 5, vw / 2, vw, vw + 500]) {
        const c = clampX(x, vw, 80, 12);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c + 80).toBeLessThanOrEqual(Math.max(vw, 80));
      }
    }
    expect(homeX(1440, 84, 20)).toBe(1440 - 84 - 20);
    expect(homeX(320, 64, 12)).toBe(320 - 64 - 12);
  });

  it("roams only on wide screens (1024 px and up) with motion allowed and the owner's consent", () => {
    const base = { width: 1280, reducedMotion: false, paused: false, noRoam: false };
    expect(ROAM_MIN_WIDTH).toBe(1024);
    expect(canRoam(base)).toBe(true);
    expect(canRoam({ ...base, width: 1024 })).toBe(true);
    expect(canRoam({ ...base, width: 1023 })).toBe(false);
    expect(canRoam({ ...base, width: 390 })).toBe(false);
    expect(canRoam({ ...base, reducedMotion: true })).toBe(false);
    expect(canRoam({ ...base, paused: true })).toBe(false);
    expect(canRoam({ ...base, noRoam: true })).toBe(false);
  });

  it("docks above the phone bottom nav bar below 768 px, and near the bottom edge where there is no bottom bar", () => {
    expect(TOP_BAR_MIN_WIDTH).toBe(768);
    for (const vw of [320, 375, 390, 480, 600, 767]) {
      const d = dockLayout(vw);
      expect(d.bottom, `vw ${vw}`).toBe(NAV_CLEARANCE);
      expect(d.bottom).toBeGreaterThanOrEqual(60); // the nav bar is about 59 px tall
    }
    for (const vw of [768, 900, 1023, 1024, 1440, 1920]) expect(dockLayout(vw).bottom, `vw ${vw}`).toBe(DESKTOP_BOTTOM);
    expect(dockLayout(390).w).toBeLessThan(dockLayout(1440).w);
  });

  it("on desktop the dock is in the bottom-right of the main area, never over the sidebar", () => {
    expect(SIDEBAR_MIN_WIDTH).toBe(1024);
    expect(shellInset(1023)).toBe(0);
    expect(shellInset(1024)).toBe(SIDEBAR_W);
    for (const vw of [1024, 1280, 1440, 1920]) {
      const d = dockLayout(vw);
      const inset = shellInset(vw);
      const x = homeX(vw, d.w, d.margin, inset);
      expect(x, `vw ${vw}`).toBeGreaterThanOrEqual(inset + d.margin);
      expect(x + d.w + d.margin).toBe(vw); // flush with the right edge
      // a clamp never pushes it into the sidebar, from either side
      expect(clampX(-500, vw, d.w, d.margin, inset)).toBeGreaterThanOrEqual(inset);
      expect(clampX(vw + 500, vw, d.w, d.margin, inset) + d.w).toBeLessThanOrEqual(vw);
    }
  });

  it("walk time follows distance within bounds", () => {
    expect(walkDuration(0, 1)).toBe(380);
    expect(walkDuration(0, 100000)).toBe(1700);
    expect(walkDuration(0, 380)).toBeGreaterThan(walkDuration(0, 190));
  });

  const base = { viewportHeight: 900, headerOffset: 96, stripHeight: 200 };
  it("scroll: leaves a target that is already readable", () => {
    expect(planScroll({ ...base, targetTop: 150, targetBottom: 500 })).toBe(0);
  });
  it("scroll: brings an off-screen target to the header edge (down and up)", () => {
    expect(planScroll({ ...base, targetTop: 2000, targetBottom: 2300 })).toBe(1904);
    expect(planScroll({ ...base, targetTop: -900, targetBottom: -600 })).toBe(-996);
  });
  it("scroll: a target taller than the viewport is aligned to its top, once", () => {
    expect(planScroll({ ...base, targetTop: 600, targetBottom: 4000 })).toBe(504);
    expect(planScroll({ ...base, targetTop: 100, targetBottom: 4000 })).toBe(0);
  });

  const input = (over: Partial<Parameters<typeof planPoint>[0]> = {}): Parameters<typeof planPoint>[0] => ({
    viewport: { width: 1440, height: 900 },
    size: { width: 84, height: 102 },
    bottomOffset: 24,
    margin: 20,
    currentX: 1336,
    target: rect(0, 100, 1440, 600),
    contentLeft: 100,
    contentRight: 1340,
    avoid: [],
    ...over,
  });

  it("point: a wide gutter beside the content is used, never outside the viewport", () => {
    const p = planPoint(input({ avoid: [rect(100, 780, 1240, 90)] }));
    expect(p.clear).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + 84).toBeLessThanOrEqual(1440);
    expect(p.x + 84 <= 100 || p.x >= 1340).toBe(true);
  });
  it("point: beside a narrow column, the stand-point is in a gutter and never over the column", () => {
    const column = rect(480, 0, 480, 900);
    const p = planPoint(input({ contentLeft: 480, contentRight: 960, target: rect(480, 120, 480, 300), avoid: [rect(480, 780, 480, 90)] }));
    expect(overlapArea(rect(p.x, 774, 84, 102), column)).toBe(0);
    expect(p.pointDir).toMatch(/left|right/);
  });
  it("point: with the sidebar, every stand-point is right of it, along the bottom of the main area", () => {
    const sidebar = rect(0, 0, SIDEBAR_W, 900);
    for (const target of [rect(300, 120, 500, 300), rect(900, 120, 400, 300), rect(SIDEBAR_W, 100, 1184, 600)]) {
      for (const currentX of [SIDEBAR_W + 20, 700, 1336]) {
        const p = planPoint(input({ inset: SIDEBAR_W, contentLeft: 300, contentRight: 1340, target, avoid: [rect(300, 780, 1040, 90)], currentX }));
        expect(overlapArea(rect(p.x, 774, 84, 102), sidebar)).toBe(0);
        expect(p.x).toBeGreaterThanOrEqual(SIDEBAR_W);
        expect(p.x + 84).toBeLessThanOrEqual(1440);
      }
    }
  });
  it("point: the gutter between the sidebar and the content is used on a wide screen", () => {
    const p = planPoint(
      input({ viewport: { width: 1920, height: 900 }, currentX: 1816, inset: SIDEBAR_W, contentLeft: 560, contentRight: 1660, target: rect(560, 100, 1100, 300), avoid: [rect(560, 780, 1100, 90)] }),
    );
    expect(p.clear).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(SIDEBAR_W);
    expect(p.x + 84 <= 560 || p.x >= 1660).toBe(true);
  });
  it("point: points toward the target side, or up when standing under it", () => {
    expect(planPoint(input({ target: rect(600, 100, 400, 300), avoid: [rect(100, 780, 1240, 90)] })).pointDir).toMatch(/left|right/);
    expect(planPoint(input({ target: rect(0, 100, 1440, 300), contentLeft: 0, contentRight: 1440, avoid: [] })).pointDir).toBe("up");
  });
  it("point: with no free spot it takes the least-covered one and reports not clear", () => {
    const wall = [rect(0, 760, 1440, 140)];
    const p = planPoint(input({ avoid: wall, viewport: { width: 400, height: 900 }, contentLeft: 0, contentRight: 400, target: rect(0, 100, 400, 600) }));
    expect(p.clear).toBe(false);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + 84).toBeLessThanOrEqual(400);
  });
  it("point: works for targets off-screen, taller than the viewport and tiny viewports", () => {
    expect(planPoint(input({ target: rect(0, 5000, 1440, 400) })).x).toBeGreaterThanOrEqual(0);
    expect(planPoint(input({ target: rect(0, -4000, 1440, 9000) })).x).toBeGreaterThanOrEqual(0);
    const tiny = planPoint(input({ viewport: { width: 320, height: 480 }, target: rect(0, 50, 320, 300), contentLeft: 16, contentRight: 304 }));
    expect(tiny.x).toBeGreaterThanOrEqual(0);
    expect(tiny.x + 84).toBeLessThanOrEqual(320);
    expect(planPoint(input({ target: null })).pointDir).toBe("up");
  });
  it("point: an open panel's footprint is avoided too", () => {
    const text = [rect(900, 560, 420, 200)]; // above the sprite, where the panel would sit
    const p = planPoint(input({ avoid: text, panel: { width: 352, height: 300 }, currentX: 1336 }));
    expect(overlapArea(rect(p.x, 774, 84, 102), text[0]!)).toBe(0);
  });
  it("panel opens toward the side with room", () => {
    expect(panelAlign(20, 352, 1440)).toBe("left");
    expect(panelAlign(1336, 352, 1440)).toBe("right");
  });
});
