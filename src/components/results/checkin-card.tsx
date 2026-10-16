"use client";

import { useState, useTransition } from "react";
import { saveCheckinAction } from "@/app/(app)/results/actions";
import { cardClass, segButton, segTrack } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { formatDayMonth } from "@/lib/links/format";

// Not imported from links/ops: that file reads the database and must stay out of the browser bundle.
type CheckinAnswer = "none" | "few" | "many";
const ANSWERS: readonly CheckinAnswer[] = ["none", "few", "many"];
const c = s.results.card;
const LABELS: Record<CheckinAnswer, string> = { none: c.none, few: c.few, many: c.many };

/**
 * The one-tap check-in (Req 20): None, A few or Many for last week. The tapped answer is
 * highlighted and saved at once; tapping another changes it.
 */
export function CheckinCard({
  weekStart,
  initial,
  title = c.titleLastWeek,
}: {
  /** Monday of the week the question is about. */
  weekStart: string;
  initial: CheckinAnswer | null;
  title?: string;
}) {
  const [answer, setAnswer] = useState<CheckinAnswer | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const tap = (next: CheckinAnswer) => {
    const before = answer;
    setAnswer(next);
    setError(null);
    start(async () => {
      const res = await saveCheckinAction(weekStart, next);
      if (!res.ok) {
        setAnswer(before);
        setError(res.message);
      }
    });
  };

  return (
    <section aria-labelledby="checkin-title" className={`space-y-2 ${cardClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 id="checkin-title" className="text-card-title text-title">
            {title}
          </h2>
          <p className="text-[13px] leading-[18px] text-desc">{fill(c.weekLabel, { date: formatDayMonth(weekStart) })}</p>
        </div>
        <div role="group" aria-label={c.groupLabel} className={segTrack}>
        {ANSWERS.map((a) => {
          const selected = answer === a;
          return (
            <button
              key={a}
              type="button"
              aria-pressed={selected}
              disabled={pending}
              onClick={() => tap(a)}
              className={segButton(selected)}
            >
              {LABELS[a]}
            </button>
          );
        })}
        </div>
      </div>
      <p role="status" className="min-h-5 text-[13px] leading-[18px] text-desc">
        {pending ? c.saving : answer && !error ? fill(c.saved, { answer: LABELS[answer] }) : ""}
      </p>
      {error && (
        <p role="alert" className="text-[13px] leading-[18px] text-err-tx">
          {error}
        </p>
      )}
    </section>
  );
}
