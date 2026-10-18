"use client";

import { useState } from "react";
import { confirmAllFlagsAction } from "@/app/(app)/create/[briefId]/actions";
import { alertClass, errorClass, secondaryButton } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Flag } from "@/lib/guardrail";
import { fill, s } from "@/lib/i18n/strings";

const t = s.create.design;
const ff = t.flagsAllFine;

type ConfirmAll = (briefId: string) => Promise<{ ok: true; confirmed: number; remaining: string[] } | { ok: false; message: string }>;

/** A word to avoid cannot be confirmed (the words must change), so "These are all fine" leaves it. */
const confirmable = (f: Flag) => f.kind !== "avoid" && f.kind !== "regulated_reminder";

/**
 * The "Please check" box of the design step, with "These are all fine": one confirm dialog, then every open flag of the
 * brief's posts is confirmed through the same server path as "It's true" in Review, and the box goes away without a reload.
 * `confirmAll`, `defaultOpen` and `defaultLeft` are for tests.
 */
export function DesignFlags({
  briefId,
  flags,
  confirmAll = confirmAllFlagsAction,
  defaultOpen = false,
  defaultLeft = null,
}: {
  briefId: string;
  flags: { flag: Flag; channels: string[] }[];
  confirmAll?: ConfirmAll;
  defaultOpen?: boolean;
  /** The ids still open after a confirm (the state after "Confirm"). */
  defaultLeft?: string[] | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<Set<string> | null>(defaultLeft ? new Set(defaultLeft) : null); // null until confirmed: then the ids still open
  const [confirmedAny, setConfirmedAny] = useState(defaultLeft !== null);

  const shown = left ? flags.filter(({ flag }) => left.has(flag.id)) : flags;
  const canConfirm = shown.some(({ flag }) => confirmable(flag));
  const regulated = shown.some(({ flag }) => confirmable(flag) && flag.regulated);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await confirmAll(briefId);
      if (!r.ok) {
        setError(r.message);
        setOpen(false);
        return;
      }
      setLeft(new Set(r.remaining));
      setConfirmedAny(true);
      setOpen(false);
    } catch {
      setError(s.create.design.errors.generic);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t.flagsTitle} data-design-flags>
      {shown.length > 0 ? (
        <div className={`space-y-2 ${alertClass("warn")}`} data-flags-box>
          <h2 className="text-ui text-warn-tx">{t.flagsTitle}</h2>
          <p className="text-[13px] leading-[18px] text-desc">{t.flagsIntro}</p>
          <ul className="space-y-1">
            {shown.map(({ flag }) => (
              <li key={flag.id} className="text-[13px] leading-[18px]">
                <span className="text-desc">{s.approvals.flags.kinds[flag.kind]} · {fill(s.approvals.flags.where, { field: flag.slide !== undefined ? `${fill(s.create.review.slideStrip.slideN, { n: flag.slide + 1 })}, ${s.approvals.fieldNames[flag.field]}` : s.approvals.fieldNames[flag.field] })}: </span>
                <mark>{flag.text}</mark>
              </li>
            ))}
          </ul>
          {canConfirm ? (
            <div>
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => setOpen(true)} data-flags-all-fine>
                {ff.button}
              </button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className={errorClass}>
              {error}
            </p>
          ) : null}
        </div>
      ) : confirmedAny ? (
        <p role="status" className={`flex items-center gap-2 ${alertClass("ok")}`} data-flags-confirmed>
          {ff.done}
        </p>
      ) : (
        <p className={`flex items-center gap-2 ${alertClass("ok")}`}>
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ok-tx" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12.5l3 3 5-6" />
          </svg>
          {t.flagsNone}
        </p>
      )}
      <ConfirmDialog
        open={open}
        title={ff.title}
        body={regulated ? `${ff.body} ${ff.regulated}` : ff.body}
        confirmLabel={busy ? ff.working : ff.confirm}
        cancelLabel={ff.cancel}
        busy={busy}
        onConfirm={() => void run()}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
