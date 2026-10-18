"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmAllFlagsAction, confirmFlagAction, removeFlagAction } from "@/app/(app)/create/[briefId]/actions";
import { ReviewChecks } from "@/components/create/review-checks";
import { alertClass, secondaryButton } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ReviewPost } from "@/lib/create";
import type { Flag } from "@/lib/guardrail";
import { s } from "@/lib/i18n/strings";

const ff = s.create.design.flagsAllFine;

export interface DayFlagPost {
  id: string;
  channel: string;
  openFlags: Flag[];
}

type Result = { ok: boolean; message: string };
export interface DayFlagActions {
  confirm: (briefId: string, postId: string, flagId: string, ack: boolean) => Promise<Result>;
  remove: (briefId: string, postId: string, flagId: string) => Promise<Result>;
  confirmAll: (briefId: string) => Promise<{ ok: true; confirmed: number; remaining: string[] } | { ok: false; message: string }>;
}
const real: DayFlagActions = { confirm: confirmFlagAction, remove: removeFlagAction, confirmAll: confirmAllFlagsAction };

/**
 * What needs a look on one day, right on the Automate page: the same per-line "It's true" / "Remove" as Review, and "These
 * are all fine" for the whole day. After each change the page is read again, so the day's badge and the button count follow.
 * `actions` and `defaultOpen` are for tests.
 */
export function DayFlags({ briefId, date, posts, actions = real, defaultOpen = false }: { briefId: string; date: string; posts: DayFlagPost[]; actions?: DayFlagActions; defaultOpen?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(defaultOpen);

  const withFlags = posts.filter((p) => p.openFlags.length > 0);
  const regulated = withFlags.some((p) => p.openFlags.some((f) => f.regulated && f.kind !== "avoid"));
  const canConfirmAll = withFlags.some((p) => p.openFlags.some((f) => f.kind !== "avoid"));
  const working = busy || pending;

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.message ?? s.create.design.errors.generic);
    } catch {
      setError(s.create.design.errors.generic);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
      start(() => router.refresh());
    }
  }

  if (withFlags.length === 0) {
    return (
      <div id={`flags-${date}`} className="text-[12.5px]" data-day-flags>
        <a href={`/create/${briefId}/design`} className="font-medium text-ink underline underline-offset-4">
          Open the design to see what needs a look
        </a>
      </div>
    );
  }

  return (
    <div id={`flags-${date}`} className="space-y-2" data-day-flags>
      {withFlags.map((p) => (
        <ReviewChecks
          key={p.id}
          // ReviewChecks reads only these three fields of a post.
          post={{ id: p.id, channel: p.channel, openFlags: p.openFlags } as unknown as ReviewPost}
          briefId={briefId}
          busy={working}
          acks={acks}
          setAcks={setAcks}
          onConfirm={(flagId, ack) => void run(() => actions.confirm(briefId, p.id, flagId, ack))}
          onRemove={(flagId) => void run(() => actions.remove(briefId, p.id, flagId))}
          onEditCaption={() => router.push(`/create/${briefId}/review`)}
        />
      ))}
      {canConfirmAll ? (
        <button type="button" className={secondaryButton} disabled={working} onClick={() => setConfirmOpen(true)} data-day-all-fine>
          {ff.button}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className={alertClass("err")}>
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title={ff.title}
        body={regulated ? `${ff.body} ${ff.regulated}` : ff.body}
        confirmLabel={working ? ff.working : ff.confirm}
        cancelLabel={ff.cancel}
        busy={working}
        onConfirm={() => void run(() => actions.confirmAll(briefId))}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
