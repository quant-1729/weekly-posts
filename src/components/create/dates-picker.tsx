"use client";

import { errorClass, inputClass, labelClass, secondaryButton } from "@/components/ui";
import { endsInText } from "@/lib/briefs/editor-state";
import { s } from "@/lib/i18n/strings";
import { EditorCard } from "./card";

const t = s.create.dates;

/**
 * Date range (B-4): a start and an end in the business's time zone. The end can't be before today
 * or before the start; the line under it says how long is left. A post is never used after its end date.
 */
export function DatesPicker({
  startsOn,
  endsOn,
  today,
  fromDescription,
  startError,
  endError,
  openEnded = false,
  canBeOpenEnded = false,
  onOpenEndedChange,
  onChange,
}: {
  startsOn: string;
  endsOn: string;
  /** Today's date (YYYY-MM-DD) in the business's time zone. */
  today: string;
  fromDescription: boolean;
  startError?: string;
  endError?: string;
  /** The offer runs with no end date (then the end date is off). */
  openEnded?: boolean;
  /** Only offers can choose "No end date". */
  canBeOpenEnded?: boolean;
  onOpenEndedChange?: (on: boolean) => void;
  onChange: (next: { startsOn: string; endsOn: string }) => void;
}) {
  const orderWrong = !!startsOn && !!endsOn && startsOn > endsOn;
  return (
    <EditorCard id="dates" title={t.title} hint={t.hint} fromDescription={fromDescription}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="dates-start" className={labelClass}>
            {t.start}
          </label>
          <input id="dates-start" type="date" className={inputClass} value={startsOn} aria-invalid={startError || orderWrong ? true : undefined} onChange={(e) => onChange({ startsOn: e.target.value, endsOn })} />
          {(startError || orderWrong) && (
            <p role="alert" className={errorClass}>
              {startError ?? t.startsAfter}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <label htmlFor="dates-end" className={labelClass}>
            {t.end}
          </label>
          <input
            id="dates-end"
            type="date"
            className={inputClass}
            min={startsOn && startsOn > today ? startsOn : today}
            value={endsOn}
            disabled={openEnded}
            aria-invalid={endError ? true : undefined}
            onChange={(e) => onChange({ startsOn, endsOn: e.target.value })}
          />
          {endError && (
            <p role="alert" className={errorClass}>
              {endError}
            </p>
          )}
        </div>
      </div>
      {canBeOpenEnded && (
        <label className="flex min-h-12 cursor-pointer items-start gap-3">
          <input type="checkbox" data-open-ended className="mt-1 h-5 w-5 shrink-0" checked={openEnded} onChange={(e) => onOpenEndedChange?.(e.target.checked)} />
          <span className="min-w-0 break-words">{t.openEnded}</span>
        </label>
      )}
      <p data-ends-in className="text-sm font-medium text-stone-700">
        {openEnded ? t.openEndedNote : endsInText(today, endsOn)}
      </p>
      {(startsOn || endsOn || openEnded) && (
        <button type="button" className={`${secondaryButton} md:min-w-0`} onClick={() => {
            onChange({ startsOn: "", endsOn: "" });
            onOpenEndedChange?.(false);
          }}>
          {t.clear}
        </button>
      )}
    </EditorCard>
  );
}
