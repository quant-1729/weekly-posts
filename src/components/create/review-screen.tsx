"use client";

import Link from "next/link";
import { useState } from "react";
import {
  approveAllAction,
  approvePostAction,
  confirmFlagAction,
  logShareAction,
  removeFlagAction,
  undoApprovalAction,
  type ReviewActionResult,
} from "@/app/(app)/create/[briefId]/actions";
import { errorClass, hintClass, primaryButton, secondaryButton } from "@/components/ui";
import type { ReviewData, ReviewPost } from "@/lib/create";
import { fill, s } from "@/lib/i18n/strings";
import { SharePanel } from "./share-panel";

const t = s.create.review;
const a = s.approvals;

const smallButton = "min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-base font-medium text-stone-800 disabled:opacity-50";
const strongButton = "min-h-11 rounded-lg bg-[#E4572E] px-4 py-2 text-base font-semibold text-white disabled:opacity-50";

const STATUS_CLASS: Record<string, string> = {
  approved: "bg-green-100 text-green-800",
  posted: "bg-blue-100 text-blue-800",
  skipped: "bg-stone-200 text-stone-700",
};

type Message = { kind: "ok" | "error"; text: string };

/**
 * The review step: every channel's post with all its sizes, its caption and the "Please check" flags (confirm
 * or remove, as in the weekly screen). A post is approved only when nothing is open and its pictures have no
 * problem; after that the owner downloads, copies or shares it.
 */
export function ReviewScreen({ data }: { data: ReviewData }) {
  const [view, setView] = useState(data);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [acks, setAcks] = useState<Record<string, boolean>>({});

  async function run(name: string, fn: () => Promise<ReviewActionResult>) {
    setBusy(name);
    setMessage(null);
    const r = await fn();
    if (r.view) setView(r.view);
    setMessage({ kind: r.ok ? "ok" : "error", text: r.message });
    setBusy(null);
  }

  const approvable = view.posts.filter((p) => p.status === "draft" && p.canApprove);
  const anyApproved = view.posts.some((p) => p.status === "approved" || p.status === "posted");

  return (
    <div className="space-y-5" data-review>
      <p className="text-stone-700">{t.intro}</p>

      {view.posts.length > 1 && approvable.length > 0 ? (
        <button type="button" className={strongButton} disabled={busy !== null} onClick={() => run("all", () => approveAllAction(view.briefId))}>
          {busy === "all" ? t.approving : t.approveAll}
        </button>
      ) : null}

      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? errorClass : "text-sm font-medium text-green-800"}>
          {message.text}
        </p>
      ) : null}

      <ul className="space-y-5">
        {view.posts.map((p) => (
          <PostCard key={p.id} post={p} briefId={view.briefId} busy={busy} run={run} acks={acks} setAcks={setAcks} />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/create/${view.briefId}/design`} className={`${secondaryButton} inline-block text-center`}>
          {t.backToDesign}
        </Link>
        <Link href={`/create/${view.briefId}/schedule`} className={`${anyApproved ? primaryButton : secondaryButton} inline-block text-center`} data-next-schedule>
          {t.nextSchedule}
        </Link>
        {view.allApproved ? <span className="text-sm font-medium text-green-800">{t.allApproved}</span> : null}
      </div>
    </div>
  );
}

function PostCard({
  post,
  briefId,
  busy,
  run,
  acks,
  setAcks,
}: {
  post: ReviewPost;
  briefId: string;
  busy: string | null;
  run: (name: string, fn: () => Promise<ReviewActionResult>) => Promise<void>;
  acks: Record<string, boolean>;
  setAcks: (v: Record<string, boolean>) => void;
}) {
  const approved = post.status === "approved" || post.status === "posted";
  const open = post.openFlags;

  return (
    <li className="space-y-3 rounded-xl border border-stone-200 bg-white p-3 md:p-4" data-post-id={post.id} data-channel={post.channel} data-status={post.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{fill(t.postFor, { channel: post.label })}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[post.status] ?? "bg-amber-100 text-amber-800"}`}>{(t.status as Record<string, string>)[post.status] ?? t.status.draft}</span>
      </div>

      <div className="flex flex-wrap gap-3" data-pictures>
        {post.images.map((img) => (
          <figure key={img.format} className="max-w-full space-y-1" data-format={img.format}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={`${fill(t.postFor, { channel: post.label })}, ${t.share.sizeNames[img.format]}`} className="max-h-72 rounded-lg bg-stone-100 object-contain" />
            <figcaption className="text-xs text-stone-500">{t.share.sizeNames[img.format]}</figcaption>
          </figure>
        ))}
        {post.images.length === 0 ? <p className={hintClass}>{s.share.noImage}</p> : null}
      </div>
      {post.slides.length > 0 ? (
        <div className="space-y-1" data-carousel>
          <p className="text-sm font-medium">{fill(t.carousel, { n: post.slides.length })}</p>
          <div className="flex flex-wrap gap-2">
            {post.slides.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt={`${i + 1}/${post.slides.length}`} className="h-24 rounded bg-stone-100 object-contain" />
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <p className="text-sm font-semibold text-stone-700">{t.caption}</p>
        <p className="whitespace-pre-line text-stone-800" data-caption>{post.caption}</p>
        {post.hashtags.length > 0 ? <p className="text-sm text-stone-600">{post.hashtags.join(" ")}</p> : null}
      </div>
      <p className={`text-xs font-medium ${open.length > 0 ? "text-amber-700" : "text-green-700"}`}>{open.length > 0 ? fill(t.flagsOpen, { n: open.length }) : t.flagsNone}</p>
      {post.reminder ? <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{a.flags.reminder}</p> : null}

      {post.blockers.length > 0 ? (
        <section className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-3" aria-label={t.problemTitle} data-blockers>
          <h3 className="font-semibold text-red-900">{t.problemTitle}</h3>
          {post.blockers.map((b) => (
            <p key={`${b.format}-${b.code}`} className="text-sm text-red-900">
              {fill(t.problems[b.code], { format: t.share.sizeNames[b.format], detail: b.detail })}
            </p>
          ))}
          <Link href={`/create/${briefId}/design`} className="text-sm font-medium underline">
            {t.backToDesign}
          </Link>
        </section>
      ) : null}

      {open.length > 0 && !approved ? (
        <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3" aria-label={a.flags.title} data-flags>
          <div>
            <h3 className="font-semibold text-amber-900">{a.flags.title}</h3>
            <p className="text-sm text-stone-600">{a.flags.intro}</p>
          </div>
          {open.map((f) => {
            const canConfirm = f.kind !== "avoid";
            const ack = acks[`${post.id}:${f.id}`] === true;
            return (
              <div key={f.id} className="space-y-2 border-t border-amber-200 pt-3" data-flag-id={f.id}>
                <p className="text-sm text-stone-600">
                  {a.flags.kinds[f.kind]} · {fill(a.flags.where, { field: a.fieldNames[f.field] })}
                </p>
                <p className="text-base font-semibold">
                  <mark className="rounded bg-amber-200 px-1">{f.text}</mark>
                </p>
                {f.regulated && canConfirm ? (
                  <div className="space-y-2">
                    <p className="rounded bg-amber-100 p-2 text-sm text-amber-900">{a.flags.regulatedWarning}</p>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1 size-5" checked={ack} onChange={(e) => setAcks({ ...acks, [`${post.id}:${f.id}`]: e.target.checked })} />
                      <span>{a.flags.regulatedTick}</span>
                    </label>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {canConfirm ? (
                    <button type="button" className={smallButton} disabled={busy !== null || (f.regulated && !ack)} onClick={() => run("flag", () => confirmFlagAction(briefId, post.id, f.id, ack))}>
                      {a.flags.confirm}
                    </button>
                  ) : null}
                  {f.highlight ? (
                    <button type="button" className={smallButton} disabled={busy !== null} onClick={() => run("flag", () => removeFlagAction(briefId, post.id, f.id))}>
                      {f.kind === "avoid" ? a.flags.removeWord : a.flags.remove}
                    </button>
                  ) : (
                    <Link href={`/create/${briefId}/design`} className={`${smallButton} inline-flex items-center`}>
                      {a.dash.edit}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {!approved ? (
        <div className="space-y-1">
          <button type="button" data-approve className={strongButton} disabled={busy !== null || !post.canApprove} onClick={() => run("approve", () => approvePostAction(briefId, post.id))}>
            {busy === "approve" ? t.approving : t.approve}
          </button>
          {open.length > 0 ? <p className={hintClass}>{t.blockedHint}</p> : null}
        </div>
      ) : (
        <section className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3" aria-label={t.share.title} data-share>
          <h3 className="font-semibold">{t.share.title}</h3>
          <SharePanel
            postId={post.id}
            channel={post.channel}
            images={post.images}
            shareText={post.shareText}
            onLog={(kind, format) => void logShareAction(post.id, kind, format)}
          />
          {post.status === "approved" ? (
            <button type="button" className={smallButton} disabled={busy !== null} onClick={() => run("undo", () => undoApprovalAction(briefId, post.id))}>
              {t.undo}
            </button>
          ) : null}
        </section>
      )}
    </li>
  );
}
