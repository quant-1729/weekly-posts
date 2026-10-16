"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { alertClass } from "@/components/ui";
import type { ReviewPost } from "@/lib/create";
import { fill, s } from "@/lib/i18n/strings";

const t = s.create.review;
const a = s.approvals;

const textAction =
  "inline-flex min-h-8 shrink-0 items-center rounded-full px-2.5 text-[13px] font-medium text-sub transition hover:bg-fill-active hover:text-title disabled:cursor-not-allowed disabled:text-faint max-md:min-h-11";

/**
 * The "Please check" items of one post as a compact list: one line each (icon, kind and the flagged text, "It's true" and
 * "Remove"). Clicking the text opens the details (where it is, the extra tick for health, money and education claims).
 * `defaultOpenId` is for tests.
 */
export function ReviewChecks({
  post,
  briefId,
  busy,
  acks,
  setAcks,
  onConfirm,
  onRemove,
  onEditCaption,
  defaultOpenId,
}: {
  post: ReviewPost;
  briefId: string;
  busy: boolean;
  acks: Record<string, boolean>;
  setAcks: (v: Record<string, boolean>) => void;
  onConfirm: (flagId: string, ack: boolean) => void;
  onRemove: (flagId: string) => void;
  onEditCaption: (channel: string) => void;
  defaultOpenId?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null);
  const base = useId();
  const open = post.openFlags;
  if (open.length === 0) return null;

  return (
    <section className="space-y-1.5" aria-label={a.flags.title} data-flags>
      <h3 className="flex items-center gap-1.5 text-ui text-warn-deep">
        {a.flags.title}
        <span className="text-note text-desc">· {open.length}</span>
      </h3>
      <ul className="space-y-1.5">
        {open.map((f) => {
          const canConfirm = f.kind !== "avoid";
          const ack = acks[`${post.id}:${f.id}`] === true;
          const expanded = openId === f.id;
          const detailsId = `${base}-${f.id}`;
          const needsTick = f.regulated && canConfirm && !ack;
          return (
            <li key={f.id} className="rounded-xl border border-warn-bd bg-warn-bg" data-flag-id={f.id} data-flag-kind={f.kind}>
              <div className="flex flex-wrap items-center gap-x-1 px-2.5 py-0.5">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-warn-tx" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 4l9 16H3L12 4z" />
                  <path d="M12 10v4M12 17.5v.01" />
                </svg>
                <button
                  type="button"
                  className="flex min-h-8 min-w-0 flex-1 basis-40 items-center gap-1.5 text-left text-[13px] leading-5 text-title max-md:min-h-11"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  aria-label={`${a.flags.kinds[f.kind]}: ${f.text}. ${expanded ? t.checkDetailsHide : t.checkDetailsShow}`}
                  onClick={() => setOpenId(expanded ? null : f.id)}
                >
                  {f.slide !== undefined ? (
                    <span className="shrink-0 font-medium text-title" data-flag-slide={f.slide + 1}>
                      {fill(t.slideStrip.slideN, { n: f.slide + 1 })}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-desc">{a.flags.kinds[f.kind]}</span>
                  <mark className="min-w-0 truncate bg-transparent font-medium text-title">{f.text}</mark>
                </button>
                <span className="flex shrink-0 items-center">
                  {canConfirm ? (
                    <button
                      type="button"
                      className={textAction}
                      disabled={busy}
                      onClick={() => {
                        // A health, money or education claim needs the tick first: show it.
                        if (needsTick) setOpenId(f.id);
                        else onConfirm(f.id, ack);
                      }}
                    >
                      {t.checkTrue}
                    </button>
                  ) : null}
                  {f.highlight ? (
                    <button type="button" className={textAction} disabled={busy} onClick={() => onRemove(f.id)}>
                      {t.checkRemove}
                    </button>
                  ) : f.field === "caption" ? (
                    <button type="button" className={textAction} disabled={busy} onClick={() => onEditCaption(post.channel)}>
                      {t.checkEdit}
                    </button>
                  ) : (
                    <Link href={`/create/${briefId}/design`} className={textAction}>
                      {t.checkEdit}
                    </Link>
                  )}
                </span>
              </div>
              <div id={detailsId} hidden={!expanded} className="space-y-2 border-t border-warn-bd px-3 py-2 text-[13px] leading-[18px] text-desc" data-flag-details>
                <p>{fill(a.flags.where, { field: f.slide !== undefined ? `${fill(t.slideStrip.slideN, { n: f.slide + 1 })}, ${a.fieldNames[f.field]}` : a.fieldNames[f.field] })}</p>
                <p className="text-title">
                  <mark>{f.text}</mark>
                </p>
                {f.regulated && canConfirm ? (
                  <div className="space-y-2">
                    <p className={alertClass("warn")}>{a.flags.regulatedWarning}</p>
                    <label className="flex items-start gap-2.5 text-[14px] leading-5 text-ink">
                      <input type="checkbox" checked={ack} onChange={(e) => setAcks({ ...acks, [`${post.id}:${f.id}`]: e.target.checked })} />
                      <span>{a.flags.regulatedTick}</span>
                    </label>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
