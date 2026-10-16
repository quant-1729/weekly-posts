"use client";

import { useEffect, useRef, useState } from "react";
import { alertClass, errorClass, hintClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { tweenSignal } from "@/lib/tween/events";
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

  // Tween (M-1) reacts to the batch: thinking while posts are written, then celebrating or shrugging.
  // The failure of the start call itself is signalled in onGenerate; `wasGenerating` is cleared there so it is not repeated.
  const wasGenerating = useRef(false);
  const batchStatus = view.batch?.status;
  useEffect(() => {
    if (generating && !wasGenerating.current) tweenSignal("generating");
    else if (!generating && wasGenerating.current) {
      if (batchStatus === "ready") tweenSignal("posts_ready");
      else if (batchStatus === "failed") tweenSignal("generate_failed");
    }
    wasGenerating.current = generating;
  }, [generating, batchStatus]);

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
      wasGenerating.current = false;
      tweenSignal("generate_failed");
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
      <p className="text-[13px] leading-[18px] text-desc">{fill(t.forWeek, { date: dayLabel(view.weekStart) })}</p>

      {generating ? (
        <div role="status" className={alertClass("grey")}>
          <p className="text-ui text-title">{t.generating}</p>
          <p className={hintClass}>{t.generatingHelp}</p>
        </div>
      ) : null}

      {failed && !generating ? (
        <div role="alert" className={alertClass("err")}>
          <p className="text-ui text-err-tx">{t.statusFailed}</p>
          <p className="text-[13px] leading-[18px]">{t.statusFailedHelp}</p>
        </div>
      ) : null}

      {regenFailed && !generating ? <p className="text-[13px] leading-[18px] text-warn-tx">{t.regenFailed}</p> : null}

      {!generating && batch?.status === "ready" ? <p className="text-ui text-ok-tx">{t.statusReady}</p> : null}

      {!generating && view.canGenerate ? (
        <div className="space-y-1">
          <button type="button" data-tween-target="generate" onClick={onGenerate} className={batch?.status === "ready" ? secondaryButton : primaryButton}>
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
        <ul className="grid gap-3 md:gap-4 lg:grid-cols-2" data-tween-target="posts">
          {view.posts.map((p) => (
            <PostCard key={p.id} post={p} photos={view.photos} weekStart={view.weekStart} onView={setView} />
          ))}
        </ul>
      ) : !generating && !failed ? (
        <p className="text-[14px] leading-5 text-desc">{t.emptyNone}</p>
      ) : null}
    </section>
  );
}
