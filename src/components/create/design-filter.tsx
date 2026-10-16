"use client";

import { chipClass, hintClass, labelClass } from "@/components/ui";
import { POST_FILTER_LABELS, POST_FILTER_PRESETS, type PostFilter } from "@/lib/design/filter-presets";
import { s } from "@/lib/i18n/strings";

const t = s.create.design.filter;

/**
 * The "Filter" section of the design panel: preset chips and a strength slider. It only reports changes through
 * `onChange`; the design studio redraws the previews (and the stored pictures after a design was used).
 */
export function FilterSection({ value, disabled, busy, note, onChange }: { value: PostFilter; disabled?: boolean; busy?: boolean; note?: string | null; onChange: (next: PostFilter) => void }) {
  return (
    <fieldset className="space-y-2" disabled={disabled} data-design-filter aria-busy={busy}>
      <legend className={labelClass}>{t.title}</legend>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.title}>
        {POST_FILTER_PRESETS.map((p) => (
          <button key={p} type="button" className={chipClass(value.preset === p)} aria-pressed={value.preset === p} data-filter-preset={p} onClick={() => onChange({ ...value, preset: p })}>
            {POST_FILTER_LABELS[p]}
          </button>
        ))}
      </div>
      <div>
        <label className={labelClass} htmlFor="filter-intensity">
          {t.intensity}
        </label>
        <input
          id="filter-intensity"
          type="range"
          min={0}
          max={100}
          step={5}
          className="w-full accent-ink"
          value={value.intensity}
          disabled={disabled || value.preset === "none"}
          onChange={(ev) => onChange({ ...value, intensity: Number(ev.target.value) })}
        />
      </div>
      {busy ? (
        <p role="status" className="text-[13px] leading-[18px] text-desc">
          {t.redrawing}
        </p>
      ) : (
        <p className={hintClass}>{t.hint}</p>
      )}
      {note ? <p className="text-[13px] leading-[18px] text-desc">{note}</p> : null}
    </fieldset>
  );
}
