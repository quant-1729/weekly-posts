"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { researchNowAction } from "@/app/(app)/ideas/actions";
import { alertClass, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";

const t = s.ideas.page;

/**
 * The top line of the Ideas page: when research last ran, "Research now", the runs left and the cost note. While a
 * run is going (started here, or by the weekly job) it shows a calm progress state; a run can take about a minute.
 */
export function ResearchBar({
  lastRunLabel,
  runsLeft,
  runsMax,
  costLabel,
  disabledReason,
  running,
}: {
  /** "today", "yesterday", "3 days ago" or a date; null when never. */
  lastRunLabel: string | null;
  runsLeft: number;
  runsMax: number;
  costLabel: string;
  /** The text of why the button is off, or null when it can be pressed. */
  disabledReason: string | null;
  /** A run started elsewhere is still going. */
  running: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const busy = pending || running;

  // A run that started elsewhere: look again every few seconds until it ends.
  useEffect(() => {
    if (!running || pending) return;
    const id = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(id);
  }, [running, pending, router]);

  const press = () => {
    setMessage(null);
    start(async () => {
      const res = await researchNowAction();
      if (res.ok) setMessage({ tone: "ok", text: res.cards > 0 ? t.done : t.doneNothing });
      else setMessage({ tone: "err", text: res.message });
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-ui text-sub">{lastRunLabel ? fill(t.lastRun, { when: lastRunLabel }) : t.lastRunNone}</p>
        <button type="button" onClick={press} disabled={busy || disabledReason !== null} aria-describedby="research-note" className={secondaryButton}>
          {t.researchNow}
        </button>
      </div>
      <p id="research-note" className="text-[13px] leading-[18px] text-desc">
        {disabledReason ?? `${fill(t.runsLeft, { n: runsLeft, max: runsMax })}. ${fill(t.costNote, { usd: costLabel })}`}
      </p>
      {busy && (
        <div role="status" className={`${alertClass("grey")} space-y-2`}>
          <p className="text-ui text-title">{t.researching}</p>
          <p className="text-[13px] leading-[18px] text-desc">{t.researchingHint}</p>
          <div className="h-1 overflow-hidden rounded-full bg-fill-active" aria-hidden="true">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-coral" />
          </div>
        </div>
      )}
      {message && !busy && (
        <p role={message.tone === "err" ? "alert" : "status"} className={message.tone === "err" ? "text-[13px] leading-[18px] text-err-tx" : "text-[13px] leading-[18px] text-desc"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
