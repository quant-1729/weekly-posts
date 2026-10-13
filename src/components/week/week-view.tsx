"use client";

import { useEffect, useRef, useState } from "react";
import { errorClass, hintClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import type { WeekView as WeekData } from "@/lib/weekly/view";
import { generateNowAction, getWeekViewAction } from "./actions";
import { PostCard } from "./post-card";

const POLL_MS = 3000;

function dayLabel(day: string | null): string {
  if (!day) return "";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * This week's batch: its status, the "Generate this week's posts" button (also "Generate new
 * posts" while the week has no approved posts), a generating state that polls every 3 seconds,
 * and the posts, each with Approve, Skip, Edit and Undo (V-16, see post-card.tsx). Mounted by the
 * /week page with `initial` from loadWeekView.
 */
export function WeekView({ initial }: { initial: WeekData }) {
  const t = s.week;
  const [view, setView] = useState<WeekData>(initial);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const generating = starting || view.batch?.status === "generating";

  useEffect(() => {
    if (!generating) return;
    const id = setInterval(async () => {
      const next = await getWeekViewAction(view.weekStart);
      if (!alive.current || !next) return;
      setView(next);
      if (next.batch && next.batch.status !== "generating") setStarting(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [generating, view.weekStart]);

  async function onGenerate() {
    setError(null);
    setStarting(true);
    const r = await generateNowAction();
    if (!alive.current) return;
    if (!r.ok) {
      setError(r.message);
      setStarting(false);
      return;
    }
    const next = await getWeekViewAction(r.weekStart);
    if (!alive.current) return;
    if (next) setView(next);
  }

  const batch = view.batch;
  const failed = batch?.status === "failed";
  const regenFailed = batch?.status === "ready" && batch.errorMessage !== "";

  return (
    <section className="space-y-4" aria-live="polite">
      <p className="text-sm text-stone-600">{fill(t.forWeek, { date: dayLabel(view.weekStart) })}</p>

      {generating ? (
        <div role="status" className="rounded-xl border border-stone-200 bg-stone-50 p-4">
          <p className="font-semibold text-stone-800">{t.generating}</p>
          <p className={hintClass}>{t.generatingHelp}</p>
        </div>
      ) : null}

      {failed && !generating ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="font-semibold text-red-800">{t.statusFailed}</p>
          <p className="text-sm text-red-700">{t.statusFailedHelp}</p>
        </div>
      ) : null}

      {regenFailed && !generating ? <p className="text-sm text-amber-800">{t.regenFailed}</p> : null}

      {!generating && batch?.status === "ready" ? <p className="font-semibold text-green-800">{t.statusReady}</p> : null}

      {!generating && view.canGenerate ? (
        <div className="space-y-1">
          <button type="button" onClick={onGenerate} className={batch?.status === "ready" ? secondaryButton : primaryButton}>
            {batch?.status === "ready" ? t.regenerate : t.generate}
          </button>
          {batch?.status === "ready" ? <p className={hintClass}>{fill(t.regenerateHelp, { n: view.regenerationsLeft })}</p> : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      {view.posts.length > 0 ? (
        <ul className="space-y-3">
          {view.posts.map((p) => (
            <PostCard key={p.id} post={p} photos={view.photos} weekStart={view.weekStart} onView={setView} />
          ))}
        </ul>
      ) : !generating && !failed ? (
        <p className="text-stone-600">{t.emptyNone}</p>
      ) : null}
    </section>
  );
}
