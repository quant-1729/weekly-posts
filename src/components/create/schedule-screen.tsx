"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { confirmScheduleAction, logShareAction, postNowBriefAction, slotOptionsForPostAction, type ScheduleActionResult } from "@/app/(app)/create/[briefId]/actions";
import { alertClass, cardClass, errorClass, labelClass, linkButton, outlineButton, primaryButton, secondaryButton, smallButton } from "@/components/ui";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import type { ReviewPost } from "@/lib/create";
import { fill, s } from "@/lib/i18n/strings";
import { formatSlot } from "@/lib/queue/format";
import type { ScheduleLine, ScheduleStep } from "@/lib/queue/view";
import { SharePanel } from "./share-panel";

const t = s.create.schedule;


type Options = { at: string; label: string }[];

/**
 * The Schedule step (PRD v3 §4, S-1): the slot proposed for each approved channel post, with Confirm, "Post now" and
 * "Pick another time". Nothing is queued until the owner confirms. Posts already in the queue are listed as scheduled.
 */
export function ScheduleScreen({ briefId, initial, posts }: { briefId: string; initial: ScheduleStep; posts: ReviewPost[] }) {
  const [step, setStep] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [options, setOptions] = useState<Record<string, Options>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // The instants the queue suggests per post: marked in the picker; any other time that is allowed can be picked too.
  const allowedByPost = useMemo(() => Object.fromEntries(Object.entries(options).map(([id, list]) => [id, list.map((o) => o.at)])), [options]);

  async function run(name: string, fn: () => Promise<ScheduleActionResult>) {
    setBusy(name);
    setMessage(null);
    const r = await fn();
    if (r.step) setStep(r.step);
    setMessage({ kind: r.ok ? "ok" : "error", text: r.message });
    if (r.ok) {
      setPicked({});
      setOpen({});
    }
    setBusy(null);
  }

  async function toggle(line: ScheduleLine) {
    if (open[line.postId]) {
      setOpen({ ...open, [line.postId]: false });
      setPicked({ ...picked, [line.postId]: "" });
      return;
    }
    setBusy(`opts:${line.postId}`);
    const r = await slotOptionsForPostAction(line.postId);
    setBusy(null);
    if (!r.ok) return setMessage({ kind: "error", text: r.message });
    setOptions({ ...options, [line.postId]: r.options });
    setOpen({ ...open, [line.postId]: true });
    setPicked({ ...picked, [line.postId]: r.options[0]?.at ?? "" });
  }

  const lines = step.lines;
  if (lines.length === 0 || !lines.some((l) => l.approved)) {
    return (
      <div className={`space-y-3 ${cardClass}`} data-schedule-empty>
        <p>{t.none}</p>
        <Link href={`/create/${briefId}/review`} className={secondaryButton}>
          {t.backToReview}
        </Link>
      </div>
    );
  }

  const queued = lines.filter((l) => l.queued);
  const waiting = lines.filter((l) => !l.queued && l.approved);
  const draft = lines.filter((l) => !l.approved);
  const proposable = waiting.filter((l) => l.proposedAt !== null);
  const overrides = Object.fromEntries(Object.entries(picked).filter(([id, at]) => at && waiting.some((l) => l.postId === id)));
  const approvedPosts = posts.filter((p) => p.status === "approved" || p.status === "posted");

  return (
    <div className="space-y-4" data-schedule>
      <p className="text-[14px] leading-5 text-desc" data-schedule-note>
        {t.intro}
      </p>

      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? errorClass : "text-[13px] font-medium leading-[18px] text-ok-tx"} data-schedule-message>
          {message.text}
        </p>
      ) : null}

      {waiting.length > 0 ? (
        <ul className="space-y-3" data-schedule-proposals>
          {waiting.map((l) => {
            const chosen = open[l.postId] ? picked[l.postId] : "";
            const when = chosen ? formatSlot(chosen, step.timezone) : l.proposedWhen;
            return (
              <li key={l.postId} className={`min-w-0 space-y-3 ${cardClass}`} data-post-id={l.postId} data-channel={l.channel} data-proposal>
                {when ? (
                  <p className="min-w-0 break-words text-[14px] leading-5 text-title" data-proposal-line>
                    {fill(t.line, { channel: l.channelLabel, when, mode: l.modeLine })}
                  </p>
                ) : (
                  <div className="space-y-1" data-no-slot>
                    <p className="text-[14px] leading-5 text-title">{fill(t.noSlot, { channel: l.channelLabel, end: step.endsOn ? ` (${step.endsOn})` : "" })}</p>
                    <p className="text-[13px] leading-[18px] text-desc">{t.noSlotHelp}</p>
                  </div>
                )}
                {l.proposedAt ? (
                  <div className="space-y-2">
                    <button type="button" className={smallButton} disabled={busy !== null} onClick={() => void toggle(l)}>
                      {open[l.postId] ? t.pickClose : t.pickTime}
                    </button>
                    {open[l.postId] ? (
                      <div data-slot-picker>
                        <p className={labelClass}>
                          {fill(t.pickLabel, { channel: l.channelLabel })}
                        </p>
                        <DateTimePicker
                          label={fill(t.pickLabel, { channel: l.channelLabel })}
                          value={picked[l.postId] || null}
                          onChange={(at) => setPicked({ ...picked, [l.postId]: at })}
                          timezone={step.timezone}
                          endsOn={step.endsOn}
                          suggested={allowedByPost[l.postId] ?? []}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {waiting.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {proposable.length > 0 ? (
            <button type="button" data-confirm data-tween-target="schedule-confirm" className={primaryButton} disabled={busy !== null} onClick={() => void run("confirm", () => confirmScheduleAction(briefId, overrides))}>
              {busy === "confirm" ? t.confirming : t.confirm}
            </button>
          ) : null}
          <button type="button" data-post-now className={secondaryButton} disabled={busy !== null} onClick={() => void run("now", () => postNowBriefAction(briefId))}>
            {busy === "now" ? t.postingNow : t.postNow}
          </button>
        </div>
      ) : null}

      {queued.length > 0 ? (
        <section className={`space-y-3 ${cardClass}`} aria-label={t.scheduledTitle} data-scheduled>
          <h3 className="text-card-title text-title">{t.scheduledTitle}</h3>
          <ul className="space-y-2 text-[14px] leading-5">
            {queued.map((l) => (
              <li key={l.postId} data-queued-post={l.postId} data-queue-status={l.queued!.status}>
                {l.queued!.status === "scheduled" || l.queued!.status === "publishing"
                  ? fill(t.scheduledLine, { channel: l.channelLabel, when: l.queued!.when, mode: l.modeLine })
                  : fill(t.sentLine, { channel: l.channelLabel, status: s.queue.statuses[l.queued!.status] })}
              </li>
            ))}
          </ul>
          <Link href="/week" className={secondaryButton}>
            {t.seeQueue}
          </Link>
        </section>
      ) : null}

      {draft.length > 0 ? (
        <section className={`space-y-1 ${alertClass("warn")}`} data-not-approved>
          <h3 className="text-ui text-warn-tx">{t.notApprovedTitle}</h3>
          {draft.map((l) => (
            <p key={l.postId} className="text-[13px] leading-[18px]">
              {fill(t.notApproved, { channel: l.channelLabel })}
            </p>
          ))}
          <Link href={`/create/${briefId}/review`} className={linkButton}>
            {t.backToReview}
          </Link>
        </section>
      ) : null}

      {approvedPosts.length > 0 ? (
        <details className={cardClass}>
          <summary className="flex min-h-6 cursor-pointer items-center justify-between gap-3 text-card-title text-title max-md:min-h-11">
            {t.shareNow}
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-desc" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <ul className="mt-3 space-y-4">
            {approvedPosts.map((p) => (
              <li key={p.id} className="space-y-3" data-post-id={p.id}>
                <h3 className="text-ui text-title">{fill(s.create.review.postFor, { channel: p.label })}</h3>
                <SharePanel briefId={briefId} postId={p.id} channel={p.channel} images={p.images} shareText={p.shareText} onLog={(kind, format) => void logShareAction(p.id, kind, format)} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div>
        <Link href={`/create/${briefId}/review`} className={outlineButton}>
          {t.backToReview}
        </Link>
      </div>
    </div>
  );
}
