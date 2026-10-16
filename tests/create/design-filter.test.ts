import { describe, expect, it, vi } from "vitest";
import { chooseWithFilter, optionOf, redrawWithFilter, type FilterActions } from "@/components/create/design-filter-logic";
import type { OptionView } from "@/lib/create";
import type { PostFilter } from "@/lib/design/filter-presets";

const view = (n: number, layoutId = `layout-${n}`): OptionView =>
  ({
    option: { themeId: `theme-${n}`, layoutId: "orig", scheme: "primary" },
    used: { layoutId, scheme: "light" },
    src: `img-${n}`,
  }) as unknown as OptionView;
const views = [view(0), view(1), view(2)];
const warm: PostFilter = { preset: "warm", intensity: 70 };

function fakes() {
  const preview = vi.fn(async (_id: string, o: { themeId: string }, f: PostFilter) => ({ ok: true as const, view: { ...view(Number(o.themeId.slice(-1))), src: `${o.themeId}-${f.preset}-${f.intensity}` } as OptionView }));
  const setFilter = vi.fn(async (_id: string, _f: PostFilter, o?: { themeId: string }) => ({ ok: true as const, redrawn: true, preview: o ? ({ ...view(Number(o.themeId.slice(-1))), src: "stored" } as OptionView) : null }));
  const choose = vi.fn(async () => ({ ok: true as const }));
  return { preview, setFilter, choose } as unknown as FilterActions & { preview: typeof preview; setFilter: typeof setFilter; choose: typeof choose };
}

describe("design step filter calls", () => {
  it("before a design: previews the selected option first, then the others, each with the filter", async () => {
    const actions = fakes();
    const seen: number[] = [];
    const r = await redrawWithFilter({ actions, briefId: "b1", views, selected: 1, filter: warm, designed: false, onView: (i) => seen.push(i) });
    expect(r).toEqual({ ok: true, redrawn: false });
    expect(actions.setFilter).not.toHaveBeenCalled();
    expect(actions.preview.mock.calls.map((c) => [c[0], c[1].themeId, c[2]])).toEqual([
      ["b1", "theme-1", warm],
      ["b1", "theme-0", warm],
      ["b1", "theme-2", warm],
    ]);
    expect(seen).toEqual([1, 0, 2]);
    // The option sent is the one in use now (its layout and colours), not the one it started as.
    expect(actions.preview.mock.calls[0][1]).toMatchObject({ layoutId: "layout-1", scheme: "light" });
  });

  it("after a design exists: stores and redraws through setFilter, reports the redraw, then refreshes the other previews", async () => {
    const actions = fakes();
    const got: Record<number, string> = {};
    const r = await redrawWithFilter({ actions, briefId: "b1", views, selected: 0, filter: warm, designed: true, onView: (i, v) => (got[i] = v.src) });
    expect(r).toEqual({ ok: true, redrawn: true });
    expect(actions.setFilter).toHaveBeenCalledWith("b1", warm, optionOf(views[0]));
    expect(actions.preview).toHaveBeenCalledTimes(2);
    expect(got).toMatchObject({ 0: "stored" });
  });

  it("stops at the first error and says why", async () => {
    const actions = fakes();
    actions.preview.mockResolvedValueOnce({ ok: false, message: "Nope" } as never);
    const r = await redrawWithFilter({ actions, briefId: "b1", views, selected: 0, filter: warm, designed: false, onView: () => undefined });
    expect(r).toEqual({ ok: false, message: "Nope" });
    expect(actions.preview).toHaveBeenCalledTimes(1);
  });

  it("drops answers that a newer change replaced", async () => {
    const actions = fakes();
    const seen: number[] = [];
    await redrawWithFilter({ actions, briefId: "b1", views, selected: 0, filter: warm, designed: false, onView: (i) => seen.push(i), isStale: () => true });
    expect(seen).toEqual([]);
    expect(actions.preview).toHaveBeenCalledTimes(1);
  });

  it("'Use this design' passes the filter with the option in use", async () => {
    const actions = fakes();
    await chooseWithFilter({ actions, briefId: "b1", view: views[2], filter: warm });
    expect(actions.choose).toHaveBeenCalledWith("b1", optionOf(views[2]), warm);
  });
});
