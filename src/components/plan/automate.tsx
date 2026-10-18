"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveAndScheduleAction } from "@/app/(app)/plan/actions";
import { approveButton, type PlanSummary } from "@/lib/plans/status";

type Approve = (planId: string) => Promise<{ ok: boolean; message: string }>;

/**
 * The bar at the bottom of the Automate page. The button names what it will do ("Approve and schedule 4 ready days") and says
 * why it is off when there is nothing to schedule. Once every day is scheduled the bar is gone (the success panel at the top
 * says so). `approve` is for tests.
 */
export function AutomatePanel({ planId, summary, time, approve = approveAndScheduleAction }: { planId: string; summary: PlanSummary; time: string; approve?: Approve }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (summary.total > 0 && summary.scheduled === summary.total) return null;
  const btn = approveButton(summary);
  const working = busy || pending;
  return (
    <div className="sticky bottom-4 z-10 mt-6 rounded-[20px] bg-ink px-5 py-4 text-white shadow-xl" data-automate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">
            {summary.ready > 0 ? `Approve ${summary.readyPosts} post${summary.readyPosts === 1 ? "" : "s"} and let them go out at ${time}` : "Nothing to approve yet"}
          </p>
          <p className="text-[12.5px] text-white/70" data-automate-note>
            {btn.reason ?? (summary.needsLook > 0 ? `${summary.needsLook} day${summary.needsLook === 1 ? "" : "s"} with something to check stay${summary.needsLook === 1 ? "s" : ""} back for you. Nothing is posted until you approve.` : "Nothing is posted until you approve.")}
          </p>
        </div>
        <button
          type="button"
          disabled={btn.disabled || working}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await approve(planId);
              // The result itself is shown by the panel at the top, from the stored queue; only a problem is said here.
              if (!r.ok) setMsg({ ok: false, text: r.message });
            } catch {
              setMsg({ ok: false, text: "Scheduling did not work. Please try again." });
            } finally {
              setBusy(false);
              start(() => router.refresh());
            }
          }}
          className="rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-ink disabled:opacity-50"
          data-approve-all
        >
          {working ? "Scheduling…" : btn.label}
        </button>
      </div>
      {msg ? (
        <p className="mt-2 rounded-xl bg-white/10 px-3 py-2 text-[13px]" role="alert" data-automate-problem>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
