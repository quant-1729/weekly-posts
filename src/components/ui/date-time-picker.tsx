"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { inputClass, popoverClass, strongButton } from "@/components/ui";
import { useDismiss } from "@/components/ui/use-dismiss";
import {
  firstDayOfWeek,
  firstEnabledDate,
  fromInstant,
  isDayDisabled,
  isTimeDisabled,
  makeLimits,
  monthGrid,
  shiftMonth,
  timesFor,
  toInstant,
  weekdayHeaders,
} from "@/components/ui/date-time-utils";
import { addDaysIso } from "@/lib/occasions/dates";
import { fill, s } from "@/lib/i18n/strings";

export type PickerLabels = typeof s.picker;

const noopSubscribe = () => () => undefined;
const browserLocale = () => (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-GB");

const navButton =
  "inline-flex size-8 items-center justify-center rounded-full text-sub transition hover:bg-fill-active hover:text-title disabled:cursor-not-allowed disabled:text-faint max-md:size-11";

/**
 * A themed date-time picker: a button that opens a calendar (month grid, today marked, past days and days after the end date
 * disabled, the week starting where the locale says) and a list of times. Everything is read and written in the brand's time
 * zone; the value is the stored instant (an ISO string).
 *
 * - Free mode (no `allowed`): any day from today to `endsOn`, times in `stepMinutes` steps at least the queue's lead time ahead.
 * - Restricted mode (`allowed`): only the instants the queue offers; days without one are disabled and each day lists its own times.
 *
 * Keyboard: arrow keys move over the days, Home/End go to the start/end of the week, PageUp/PageDown change the month, Enter or
 * Space picks; the time list takes Up/Down/Home/End and Enter; Escape closes and returns to the button.
 * `defaultOpen` and `now` are for tests.
 */
export function DateTimePicker({
  value,
  onChange,
  timezone,
  label,
  endsOn = null,
  allowed = null,
  suggested = null,
  stepMinutes = 15,
  locale,
  now,
  disabled = false,
  defaultOpen = false,
  labels = s.picker,
}: {
  /** The picked instant (ISO), or null. */
  value: string | null;
  onChange: (iso: string) => void;
  /** The brand's time zone (IANA). */
  timezone: string;
  /** Names the button and the popover for screen readers (for example "Time for Instagram"). */
  label: string;
  /** Last local date that may be picked. */
  endsOn?: string | null;
  /** Restrict to these instants. */
  allowed?: readonly string[] | null;
  /** Mark these instants as suggestions (a small "Suggested" on the day and the time); any other time stays selectable. */
  suggested?: readonly string[] | null;
  stepMinutes?: number;
  /** BCP 47 locale for names and the first day of the week; the browser's language by default. */
  locale?: string;
  now?: Date;
  disabled?: boolean;
  defaultOpen?: boolean;
  labels?: PickerLabels;
}) {
  const browser = useSyncExternalStore(noopSubscribe, browserLocale, () => "en-GB");
  const loc = locale ?? browser;
  const [clock] = useState(() => now ?? new Date());
  const at = now ?? clock;
  const limits = useMemo(() => makeLimits({ now: at, timezone, endsOn, allowed, suggested }), [at, timezone, endsOn, allowed, suggested]);

  const selected = value ? fromInstant(value, timezone) : null;
  const startDate = selected?.date ?? firstEnabledDate(limits) ?? limits.today;

  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<{ date: string | null; time: string | null }>({ date: selected?.date ?? null, time: selected?.time ?? null });
  const [monthKey, setMonthKey] = useState(startDate.slice(0, 7));
  const [focused, setFocused] = useState(startDate);
  const pendingFocus = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const close = useCallback((reason: "escape" | "outside" | "done" = "done") => {
    setOpen(false);
    if (reason === "escape") trigger.current?.focus();
  }, []);
  useDismiss(open, root, close);

  // Move keyboard focus to the day the state points at, after the render that shows it.
  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    pendingFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focused}"]`)?.focus();
  }, [open, focused, monthKey]);

  const weekStart = firstDayOfWeek(loc);
  const [year, month] = monthKey.split("-").map(Number);
  const weeks = monthGrid(year, month, weekStart);
  const today = limits.today;
  const monthTitle = new Intl.DateTimeFormat(loc, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
  const dayLong = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const timeFmt = new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const wallTime = (t: string) => timeFmt.format(new Date(Date.UTC(2024, 0, 1, Number(t.slice(0, 2)), Number(t.slice(3, 5)))));
  const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

  const times = draft.date ? timesFor(draft.date, limits, stepMinutes) : [];
  const timeOk = (t: string) => draft.date !== null && !isTimeDisabled(draft.date, t, limits);

  const shown = selected
    ? new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value!))
    : null;

  function openPopover() {
    const sel = value ? fromInstant(value, timezone) : null;
    const target = sel?.date ?? firstEnabledDate(limits) ?? limits.today;
    setDraft({ date: sel?.date ?? null, time: sel?.time ?? null });
    setMonthKey(target.slice(0, 7));
    setFocused(target);
    pendingFocus.current = true;
    setOpen(true);
  }

  function pickDate(date: string) {
    if (isDayDisabled(date, limits)) return;
    const offered = timesFor(date, limits, stepMinutes).filter((t) => !isTimeDisabled(date, t, limits));
    // Keep the time already chosen when it also exists on the new day; with a single offered time, take it.
    const time = draft.time && offered.includes(draft.time) ? draft.time : offered.length === 1 ? offered[0] : null;
    setDraft({ date, time });
    setFocused(date);
    if (time) onChange(toInstant(date, time, timezone));
  }

  function pickTime(time: string) {
    if (!draft.date || isTimeDisabled(draft.date, time, limits)) return;
    setDraft({ date: draft.date, time });
    onChange(toInstant(draft.date, time, timezone));
  }

  function goTo(date: string) {
    pendingFocus.current = true;
    setFocused(date);
    setMonthKey(date.slice(0, 7));
  }

  function onGridKey(e: KeyboardEvent<HTMLTableElement>) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      return goTo(addDaysIso(focused, step[e.key]));
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const col = (asDate(focused).getUTCDay() - weekStart + 7) % 7;
      return goTo(addDaysIso(focused, e.key === "Home" ? -col : 6 - col));
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const by = e.key === "PageUp" ? -1 : 1;
      const [y, m] = shiftMonth(focused.slice(0, 7), by).split("-").map(Number);
      const day = Math.min(Number(focused.slice(8, 10)), new Date(Date.UTC(y, m, 0)).getUTCDate());
      return goTo(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[role=option]:not([aria-disabled=true])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, n))]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
  }

  const tabbableTime = draft.time && times.includes(draft.time) && timeOk(draft.time) ? draft.time : times.find(timeOk);
  const prevDisabled = shiftMonth(monthKey, 0) <= today.slice(0, 7);
  const nextDisabled = endsOn !== null && shiftMonth(monthKey, 1) > endsOn.slice(0, 7);

  return (
    <div ref={root} className="relative" data-date-time-picker>
      <button
        ref={trigger}
        type="button"
        className={`${inputClass.replace(/^block /, "")} flex items-center justify-between gap-2 text-left`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${uid}-popover`}
        aria-label={`${label}: ${shown ?? labels.choose}`}
        disabled={disabled}
        data-picker-trigger
        onClick={() => (open ? close() : openPopover())}
      >
        <span className={`min-w-0 truncate ${shown ? "text-ink" : "text-helper"}`}>{shown ?? labels.choose}</span>
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-desc" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>

      <div
        id={`${uid}-popover`}
        role="dialog"
        aria-label={label}
        hidden={!open}
        data-picker-popover
        className={`${popoverClass} absolute left-0 top-full mt-1 w-[min(22rem,calc(100vw-2rem))] p-3 md:w-[31rem]`}
      >
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="min-w-0 md:w-[17.5rem] md:shrink-0">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" className={navButton} aria-label={labels.previousMonth} disabled={prevDisabled} onClick={() => setMonthKey(shiftMonth(monthKey, -1))}>
                <Chevron dir="left" />
              </button>
              <p className="text-ui text-title" aria-live="polite" data-month-title>
                {monthTitle}
              </p>
              <button type="button" className={navButton} aria-label={labels.nextMonth} disabled={nextDisabled} onClick={() => setMonthKey(shiftMonth(monthKey, 1))}>
                <Chevron dir="right" />
              </button>
            </div>
            <table ref={gridRef} role="grid" aria-label={monthTitle} className="w-full table-fixed border-separate border-spacing-y-0.5 text-center" onKeyDown={onGridKey} data-grid>
              <thead>
                <tr>
                  {weekdayHeaders(loc, weekStart).map((w) => (
                    <th key={w.long} scope="col" abbr={w.long} className="pb-1 text-note font-normal text-desc">
                      {w.short.slice(0, 2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week[0].date}>
                    {week.map((d) => {
                      const off = isDayDisabled(d.date, limits);
                      const isSel = draft.date === d.date;
                      const isToday = d.date === today;
                      return (
                        <td key={d.date} role="gridcell" aria-selected={isSel} className="p-0">
                          {d.inMonth ? (
                            <button
                              type="button"
                              data-date={d.date}
                              data-today={isToday ? "" : undefined}
                              data-selected={isSel ? "" : undefined}
                              data-suggested={limits.suggestedDays.has(d.date) ? "" : undefined}
                              aria-label={dayLong.format(asDate(d.date)) + (limits.suggestedDays.has(d.date) ? `, ${labels.suggested}` : "")}
                              aria-disabled={off}
                              aria-current={isToday ? "date" : undefined}
                              tabIndex={d.date === focused ? 0 : -1}
                              onClick={() => pickDate(d.date)}
                              onFocus={() => setFocused(d.date)}
                              className={`mx-auto flex size-9 items-center justify-center rounded-full text-[13px] leading-5 transition max-md:size-11 ${
                                isSel
                                  ? "bg-ink text-white"
                                  : off
                                    ? "cursor-not-allowed text-faint line-through decoration-transparent"
                                    : "text-ink hover:bg-fill-active"
                              } ${isToday && !isSel ? "font-semibold ring-1 ring-coral" : ""}`}
                            >
                              <span className="relative">
                                {Number(d.date.slice(8, 10))}
                                {limits.suggestedDays.has(d.date) && !isSel ? <span aria-hidden="true" className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-coral" /> : null}
                              </span>
                            </button>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="min-w-0 flex-1">
            <p className="mb-2 text-ui text-title" id={`${uid}-times`}>
              {labels.time}
            </p>
            {draft.date && times.length === 0 ? (
              <p className="text-[13px] leading-[18px] text-desc">{labels.noTimes}</p>
            ) : !draft.date ? (
              <p className="text-[13px] leading-[18px] text-desc">{labels.chooseDay}</p>
            ) : (
              <div ref={listRef} role="listbox" aria-labelledby={`${uid}-times`} className="max-h-48 space-y-0.5 overflow-y-auto pr-1 md:max-h-64" onKeyDown={onListKey} data-times>
                {times.map((t) => {
                  const off = !timeOk(t);
                  const isSel = draft.time === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="option"
                      data-time={t}
                      aria-selected={isSel}
                      aria-disabled={off}
                      tabIndex={t === tabbableTime ? 0 : -1}
                      onClick={() => pickTime(t)}
                      className={`flex min-h-8 w-full items-center rounded-xl px-3 text-left text-[13px] leading-5 transition max-md:min-h-11 ${
                        isSel ? "bg-ink text-white" : off ? "cursor-not-allowed text-faint" : "text-ink hover:bg-fill-active"
                      }`}
                    >
                      <span>{wallTime(t)}</span>
                      {draft.date && limits.suggestedTimes.has(`${draft.date} ${t}`) ? <span className={`ml-auto text-note ${isSel ? "text-white/80" : "text-desc"}`}>{labels.suggested}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-2">
          <p className="min-w-0 text-note text-desc">{fill(labels.timezoneNote, { zone: timezone })}</p>
          <button type="button" className={strongButton} onClick={() => close()}>
            {labels.done}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
