"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  previewOptionAction,
  saveWordsAction,
  setBlockAction,
  setPhotoAction,
  chooseDesignAction,
  setFilterAction,
} from "@/app/(app)/create/[briefId]/actions";
import { alertClass, cardClass, errorClass, hintClass, inputClass, labelClass, outlineButton, primaryButton, secondaryButton, smallButton, strongButton } from "@/components/ui";
import { FilterSection } from "./design-filter";
import { chooseWithFilter, redrawWithFilter, type FilterActions } from "./design-filter-logic";
import { DEFAULT_POST_FILTER, type PostFilter } from "@/lib/design/filter-presets";
import type { DesignPageData, OptionView } from "@/lib/create";
import type { DesignOption } from "@/lib/design/types";
import { fill, s } from "@/lib/i18n/strings";

const t = s.create.design;
const SCHEMES: DesignOption["scheme"][] = ["primary", "light", "dark", "accent"];
const SLIDER_DELAY_MS = 300;
const filterActions: FilterActions = {
  preview: previewOptionAction,
  setFilter: setFilterAction,
  choose: chooseDesignAction,
};

/**
 * The design step (PRD v3 G-5 to G-7): the three options for the first channel's main size sit in the centre with
 * their reports (what had no room); every design control lives in the right-hand panel (layout, colours, words on
 * the picture, photo, lines to show, filter) with "Use this design" at its bottom, which draws every size the
 * channels need. Only things that change the picture are edited here; captions and hashtags are edited in Review.
 * Everything on a picture comes from the details; the words are checked again when they are saved.
 */
export function DesignStudio({ data }: { data: DesignPageData }) {
  const router = useRouter();
  const [views, setViews] = useState<OptionView[]>(data.options);
  const [selected, setSelected] = useState(data.usedIndex ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<PostFilter>(data.filter ?? DEFAULT_POST_FILTER);
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterNote, setFilterNote] = useState<string | null>(null);
  const filterRun = useRef(0);
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const view = views[selected];
  const working = busy !== null || refreshing;

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function swap(next: DesignOption, name: string) {
    setBusy(name);
    setError(null);
    const r = await previewOptionAction(data.briefId, next, filter);
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setViews((all) => all.map((v, i) => (i === selected ? r.view : v)));
  }

  const layoutAt = Math.max(0, view.layouts.findIndex((l) => l.id === view.used.layoutId));
  const moveLayout = (step: number) => {
    const next = view.layouts[(layoutAt + step + view.layouts.length) % view.layouts.length];
    if (next) void swap({ ...view.option, layoutId: next.id, scheme: view.used.scheme }, "layout");
  };

  async function chooseIt() {
    setBusy("use");
    setError(null);
    const r = await chooseWithFilter({ actions: filterActions, briefId: data.briefId, view, filter });
    if (!r.ok) {
      setBusy(null);
      setError(r.message);
      return;
    }
    router.push(`/create/${data.briefId}/review`);
  }

  useEffect(() => () => {
    if (filterTimer.current) clearTimeout(filterTimer.current);
  }, []);

  /** Draws the three previews again (and, after a design was used, the stored pictures) with the new filter. */
  async function redraw(next: PostFilter) {
    const run = ++filterRun.current;
    setFilterBusy(true);
    const r = await redrawWithFilter({
      actions: filterActions,
      briefId: data.briefId,
      views,
      selected,
      filter: next,
      designed: data.designed,
      isStale: () => run !== filterRun.current,
      onView: (i, v) => setViews((all) => all.map((old, at) => (at === i ? v : old))),
    });
    if (run !== filterRun.current) return; // a newer change took over
    setFilterBusy(false);
    if (!r.ok) setError(r.message);
    else setFilterNote(r.redrawn ? t.filter.redrawn : null);
  }

  /** The preset chips redraw at once; the slider waits a moment after the last move. */
  function applyFilter(next: PostFilter) {
    const slider = next.preset === filter.preset;
    setFilter(next);
    setError(null);
    setFilterNote(null);
    setFilterBusy(true);
    filterRun.current++; // whatever is still being drawn is out of date
    if (filterTimer.current) clearTimeout(filterTimer.current);
    if (slider) filterTimer.current = setTimeout(() => void redraw(next), SLIDER_DELAY_MS);
    else void redraw(next);
  }

  async function setPhoto(photoId: string | null) {
    setBusy("photo");
    setError(null);
    const r = await setPhotoAction(data.briefId, photoId);
    setBusy(null);
    if (!r.ok) setError(r.message);
    else refresh();
  }

  async function setBlock(key: string, on: boolean) {
    setBusy("block");
    setError(null);
    const r = await setBlockAction(data.briefId, key, on);
    setBusy(null);
    if (!r.ok) setError(r.message);
    else refresh();
  }

  const noProblems = view.lines.problems.length === 0;

  return (
    <div className="space-y-4" data-design-studio aria-busy={working}>
      <p className="text-[14px] leading-5 text-desc">{t.intro}</p>

      {data.designed ? <p className={alertClass("grey")}>{t.designedNote}</p> : null}

      <section aria-label={t.flagsTitle} data-design-flags>
        {data.flags.length > 0 ? (
          <div className={`space-y-2 ${alertClass("warn")}`}>
            <h2 className="text-ui text-warn-tx">{t.flagsTitle}</h2>
            <p className="text-[13px] leading-[18px] text-desc">{t.flagsIntro}</p>
            <ul className="space-y-1">
              {data.flags.map(({ flag }) => (
                <li key={flag.id} className="text-[13px] leading-[18px]">
                  <span className="text-desc">{s.approvals.flags.kinds[flag.kind]} · {fill(s.approvals.flags.where, { field: flag.slide !== undefined ? `${fill(s.create.review.slideStrip.slideN, { n: flag.slide + 1 })}, ${s.approvals.fieldNames[flag.field]}` : s.approvals.fieldNames[flag.field] })}: </span>
                  <mark>{flag.text}</mark>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={`flex items-center gap-2 ${alertClass("ok")}`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ok-tx" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l3 3 5-6" />
            </svg>
            {t.flagsNone}
          </p>
        )}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" data-design-layout>
        <section className="min-w-0 space-y-3" aria-label="Design options" data-design-options>
          {data.slideCount ? <p className={hintClass}>{fill(t.carouselSet, { n: data.slideCount })}</p> : null}
          <ul className={`grid gap-4 transition-opacity ${data.slideCount ? "" : "sm:grid-cols-3"} ${filterBusy ? "opacity-60" : ""}`} aria-busy={filterBusy}>
            {views.map((v, i) => {
              const active = i === selected;
              return (
                <li key={`${v.option.themeId}-${v.option.layoutId}-${i}`} data-option={i} data-selected={active} className={`min-w-0 space-y-2 ${cardClass} ${active ? "border-coral ring-1 ring-coral" : ""}`}>
                  {v.slides && v.slides.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-1" data-slide-strip role="group" aria-label={fill(t.previewAlt, { n: i + 1 })}>
                      {v.slides.map((src, k) => (
                        <button key={k} type="button" className="shrink-0" onClick={() => setSelected(i)} aria-pressed={active} data-slide={k + 1}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={fill(t.slideAlt, { option: i + 1, n: k + 1, total: v.slides!.length })} className="h-56 w-auto rounded-xl bg-well object-contain" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button type="button" className="block w-full" onClick={() => setSelected(i)} aria-pressed={active}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.src} alt={fill(t.previewAlt, { n: i + 1 })} className="w-full rounded-xl bg-well object-contain" />
                    </button>
                  )}
                  <p className="text-card-title text-title">{fill(t.optionN, { n: i + 1 })}</p>
                  <div className="space-y-1 text-[13px] leading-[18px]" data-option-report>
                    {v.lines.problems.map((p) => (
                      <p key={p} className="text-err-tx">{p}</p>
                    ))}
                    {v.lines.noRoom.length > 0 ? <p className="text-warn-tx">{fill(t.noRoom, { items: v.lines.noRoom.join(", ") })}</p> : null}
                    {v.lines.notShown.length > 0 ? <p className="text-desc">{fill(t.notShown, { items: v.lines.notShown.join(", ") })}</p> : null}
                    {v.lines.problems.length === 0 && v.lines.noRoom.length === 0 && v.lines.notShown.length === 0 ? <p className="font-medium text-ok-tx">{t.fits}</p> : null}
                  </div>
                  <button type="button" className={`${active ? strongButton : smallButton} w-full`} onClick={() => setSelected(i)} aria-pressed={active}>
                    {active ? t.selected : t.choose}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={hintClass}>{fill(t.formats, { list: data.formats.map((f) => t.formatNames[f]).join(", ") })}</p>
          {data.carousel ? <p className={alertClass("grey")}>{t.carousel}</p> : null}
        </section>

        <aside className="flex min-w-0 flex-col bg-cream lg:sticky lg:top-[52px] lg:h-[calc(100dvh-52px)]" aria-label={t.panelTitle} data-design-panel>
          <div className="min-h-0 flex-1 space-y-5 p-4 lg:overflow-y-auto">
            <div className="space-y-2" data-panel-layout>
              <h2 className={`${labelClass} !mb-0`}>{t.quick.layout}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={smallButton} disabled={working || view.layouts.length < 2} onClick={() => moveLayout(-1)}>
                  {t.quick.previous}
                </button>
                <button type="button" className={smallButton} disabled={working || view.layouts.length < 2} onClick={() => moveLayout(1)}>
                  {t.quick.next}
                </button>
              </div>
              <p className="text-[13px] leading-[18px] text-desc" data-layout-label>
                {fill(t.quick.layoutOf, { n: layoutAt + 1, total: view.layouts.length, name: view.layouts[layoutAt]?.name ?? view.used.layoutId })}
              </p>
              <div>
                <label className={labelClass} htmlFor="scheme">{t.quick.scheme}</label>
                <select id="scheme" className={inputClass} value={view.used.scheme} disabled={working} onChange={(ev) => void swap({ ...view.option, layoutId: view.used.layoutId, scheme: ev.target.value as DesignOption["scheme"] }, "scheme")}>
                  {SCHEMES.map((sc) => (
                    <option key={sc} value={sc}>{t.quick.schemes[sc]}</option>
                  ))}
                </select>
              </div>
              <p className={hintClass}>{t.quick.logoCornerNote}</p>
            </div>

            <WordsForm data={data} disabled={working} onSaved={refresh} />

            <fieldset className="space-y-2" disabled={working} data-panel-photo>
              <legend className={labelClass}>{t.quick.photo}</legend>
              <p className={hintClass}>{t.quick.photoNote}</p>
              {data.photos.length === 0 ? <p className="text-[13px] leading-[18px] text-desc">{t.quick.photoEmpty}</p> : null}
              <div className="grid grid-cols-4 gap-2">
                {data.photos.map((p) => (
                  <label key={p.id} className={`block cursor-pointer rounded-xl p-1 text-center text-note focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral ${data.photoId === p.id ? "outline-2 outline-offset-2 outline-coral" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.description} className="aspect-square w-full rounded-lg object-cover" />
                    <input type="radio" name="photo" className="mt-1" checked={data.photoId === p.id} onChange={() => void setPhoto(p.id)} />
                  </label>
                ))}
              </div>
              <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-line-input px-3 py-2 text-[14px]">
                <input type="radio" name="photo" checked={data.photoId === null} onChange={() => void setPhoto(null)} />
                <span>{t.quick.photoNone}</span>
              </label>
            </fieldset>

            <fieldset className="space-y-2" disabled={working} data-panel-blocks>
              <legend className={labelClass}>{t.quick.blocks}</legend>
              <p className={hintClass}>{t.quick.blocksHint}</p>
              <ul className="space-y-1">
                {data.blocks.map((blk) => (
                  <li key={blk.key} data-block={blk.key}>
                    <label className="flex items-start gap-2.5 py-1 text-[14px] leading-5">
                      <input type="checkbox" checked={blk.on} disabled={blk.text === null} onChange={(ev) => void setBlock(blk.key, ev.target.checked)} />
                      <span className="min-w-0">
                        <span className="block">{blk.label}</span>
                        <span className="block break-words text-note text-desc">{blk.text ?? t.quick.notAdded}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            {data.filterApplies ? <FilterSection value={filter} disabled={busy !== null || refreshing} busy={filterBusy} note={filterNote} onChange={applyFilter} /> : null}
          </div>

          <div className="space-y-2 border-t border-divider p-4" data-editor-footer>
            {error ? (
              <p role="alert" className={errorClass}>
                {error}
              </p>
            ) : null}
            <div className="min-w-0 space-y-1 text-[13px] leading-[18px] text-desc">
              {busy === "use" ? <p role="status">{t.usingHint}</p> : null}
              {!noProblems ? <p className="font-medium text-err-tx">{t.problems}</p> : null}
              {refreshing ? <p role="status">{t.writingTitle}</p> : null}
            </div>
            <button type="button" data-use-design className={`${primaryButton} w-full`} disabled={working || filterBusy || !noProblems} onClick={() => void chooseIt()}>
              {busy === "use" ? t.using : t.useThis}
            </button>
            <Link href={`/create/${data.briefId}/show`} className={`${outlineButton} w-full`}>
              {t.back}
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The headline, second line, button text and mascot line on the picture: saved and checked again. (Captions and hashtags are edited in Review.) */
function WordsForm({ data, disabled, onSaved }: { data: DesignPageData; disabled: boolean; onSaved: () => void }) {
  const w = t.words;
  const [headline, setHeadline] = useState(data.words.headline);
  const [subline, setSubline] = useState(data.words.subline);
  const [ctaText, setCtaText] = useState(data.words.ctaText);
  const [bubble, setBubble] = useState(data.words.bubble);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; lines: string[] } | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    // No captions or hashtags are sent: saveCopy keeps the ones already stored.
    const r = await saveWordsAction(data.briefId, { headline, subline, ctaText, bubble: data.hasMascot ? bubble : undefined });
    setSaving(false);
    if (!r.ok) {
      setMessage({ ok: false, lines: r.errors });
      return;
    }
    setMessage({ ok: true, lines: data.designed && r.changed ? [r.message, t.stale] : [r.message] });
    if (r.changed) onSaved();
  }

  return (
    <form
      className="min-w-0 space-y-3"
      data-panel-words
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <div>
        <h2 className={`${labelClass} !mb-0`}>{w.title}</h2>
        <p className={`${hintClass} !mb-0`}>{w.hint}</p>
      </div>
      <div>
        <label className={labelClass} htmlFor="words-headline">{w.headline}</label>
        <input id="words-headline" className={inputClass} value={headline} onChange={(ev) => setHeadline(ev.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor="words-subline">{w.subline}</label>
        <input id="words-subline" className={inputClass} value={subline} onChange={(ev) => setSubline(ev.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor="words-cta">{w.cta}</label>
        <input id="words-cta" className={inputClass} value={ctaText} onChange={(ev) => setCtaText(ev.target.value)} />
      </div>
      {data.hasMascot ? (
        <div>
          <label className={labelClass} htmlFor="words-bubble">{w.bubble}</label>
          <input id="words-bubble" className={inputClass} value={bubble} onChange={(ev) => setBubble(ev.target.value)} />
        </div>
      ) : null}
      <button type="submit" className={secondaryButton} disabled={disabled || saving}>
        {saving ? w.saving : w.save}
      </button>
      {message ? (
        <div role={message.ok ? "status" : "alert"} className={message.ok ? "text-[13px] font-medium leading-[18px] text-ok-tx" : errorClass}>
          {message.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      ) : null}
    </form>
  );
}
