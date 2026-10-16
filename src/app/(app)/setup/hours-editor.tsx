"use client";

import { DAY_KEYS, type DayKey } from "@/lib/contacts/types";
import { inputClass, outlineButton } from "@/components/ui";
import type { DraftHoursDays } from "@/lib/setup/draft";
import { s } from "@/lib/i18n/strings";

const t = s.setupV2.hours;

const timeInput = `${inputClass} !w-32`;

/** A simple week: tick the days you are open and give one pair of times for each. */
export function HoursEditor({
  days,
  onChange,
}: {
  days: DraftHoursDays;
  onChange: (next: DraftHoursDays) => void;
}) {
  const set = (d: DayKey, patch: Partial<DraftHoursDays[DayKey]>) => onChange({ ...days, [d]: { ...days[d], ...patch } });

  function copyFirst() {
    const first = DAY_KEYS.find((d) => days[d].on);
    if (!first) return;
    const next = { ...days };
    for (const d of DAY_KEYS) if (days[d].on) next[d] = { ...days[d], open: days[first].open, close: days[first].close };
    onChange(next);
  }

  return (
    <div className="space-y-2" data-testid="hours-editor">
      <ul className="space-y-2">
        {DAY_KEYS.map((d) => (
          <li key={d} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line-light bg-white px-3 py-1.5">
            <label className="flex min-h-11 w-40 items-center gap-2.5 text-ui text-title">
              <input type="checkbox" checked={days[d].on} onChange={(e) => set(d, { on: e.target.checked })} />
              <span>{t.days[d]}</span>
            </label>
            {days[d].on ? (
              <span className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  className={timeInput}
                  value={days[d].open}
                  aria-label={`${t.days[d]} ${t.from}`}
                  onChange={(e) => set(d, { open: e.target.value })}
                />
                <span>{t.to}</span>
                <input
                  type="time"
                  className={timeInput}
                  value={days[d].close === "24:00" ? "23:59" : days[d].close}
                  aria-label={`${t.days[d]} ${t.to}`}
                  onChange={(e) => set(d, { close: e.target.value })}
                />
              </span>
            ) : (
              <span className="text-[14px] text-desc">{t.closed}</span>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className={outlineButton} onClick={copyFirst}>
        {t.copyFirst}
      </button>
    </div>
  );
}
