// The Design step's filter calls, kept apart from the React component so they can be tested with fake actions.
import type { OptionView } from "@/lib/create";
import type { DesignOption } from "@/lib/design/types";
import type { PostFilter } from "@/lib/design/filter-presets";

type Failed = { ok: false; message: string };

export interface FilterActions {
  /** previewOptionAction: a fresh preview of one option with the filter (no AI). */
  preview: (briefId: string, option: DesignOption, filter: PostFilter) => Promise<{ ok: true; view: OptionView } | Failed>;
  /** setFilterAction: stores the filter and redraws the pictures of a design already used. */
  setFilter: (briefId: string, filter: PostFilter, option?: DesignOption) => Promise<({ ok: true; redrawn: boolean; preview: OptionView | null }) | Failed>;
  /** chooseDesignAction. */
  choose: (briefId: string, option: DesignOption, filter?: PostFilter) => Promise<{ ok: true } | Failed>;
}

/** The option exactly as the owner sees it now (the layout and colours in use). */
export const optionOf = (v: OptionView): DesignOption => ({ ...v.option, layoutId: v.used.layoutId, scheme: v.used.scheme });

/**
 * Draws the previews again with a filter: the selected option first, then the others, each handed to `onView` as it
 * arrives. If the design was already used (`designed`), the stored pictures are redrawn too (the posts become drafts
 * again: `redrawn`). Stops at the first error. `isStale` lets the caller drop an answer that a newer change replaced.
 */
export async function redrawWithFilter(args: {
  actions: FilterActions;
  briefId: string;
  views: OptionView[];
  selected: number;
  filter: PostFilter;
  designed: boolean;
  onView: (index: number, view: OptionView) => void;
  isStale?: () => boolean;
}): Promise<{ ok: true; redrawn: boolean } | Failed> {
  const { actions, briefId, views, selected, filter, designed, onView, isStale } = args;
  let redrawn = false;
  const first = optionOf(views[selected]);
  if (designed) {
    const r = await actions.setFilter(briefId, filter, first);
    if (!r.ok) return r;
    redrawn = r.redrawn;
    if (r.preview && !isStale?.()) onView(selected, r.preview);
  } else {
    const r = await actions.preview(briefId, first, filter);
    if (!r.ok) return r;
    if (!isStale?.()) onView(selected, r.view);
  }
  for (let i = 0; i < views.length; i++) {
    if (i === selected) continue;
    if (isStale?.()) break;
    const r = await actions.preview(briefId, optionOf(views[i]), filter);
    if (!r.ok) return r;
    if (!isStale?.()) onView(i, r.view);
  }
  return { ok: true, redrawn };
}

/** "Use this design" with the filter the owner picked. */
export function chooseWithFilter(args: { actions: Pick<FilterActions, "choose">; briefId: string; view: OptionView; filter: PostFilter }) {
  return args.actions.choose(args.briefId, optionOf(args.view), args.filter);
}
