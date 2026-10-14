"use client";

import { useState, useTransition } from "react";
import { saveCheckinAction } from "@/app/(app)/results/actions";
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
    <section aria-labelledby="checkin-title" className="space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-4 md:max-w-2xl">
      <div>
        <h2 id="checkin-title" className="font-semibold">
          {title}
        </h2>
        <p className="text-sm text-stone-600">{fill(c.weekLabel, { date: formatDayMonth(weekStart) })}</p>
      </div>
      <div role="group" aria-label={c.groupLabel} className="flex gap-2">
        {ANSWERS.map((a) => {
          const selected = answer === a;
          return (
            <button
              key={a}
              type="button"
              aria-pressed={selected}
              disabled={pending}
              onClick={() => tap(a)}
              className={`min-h-12 flex-1 rounded-lg border px-3 py-2 text-base font-medium disabled:opacity-60 ${
                selected ? "border-[#E4572E] bg-[#E4572E] text-white" : "border-stone-300 bg-white text-stone-800"
              }`}
            >
              {LABELS[a]}
            </button>
          );
        })}
      </div>
      <p role="status" className="min-h-5 text-sm text-stone-600">
        {pending ? c.saving : answer && !error ? fill(c.saved, { answer: LABELS[answer] }) : ""}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
