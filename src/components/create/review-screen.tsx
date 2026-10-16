"use client";

import Link from "next/link";
import { useState } from "react";
import {
  approveAllAction,
  approvePostAction,
  confirmFlagAction,
  logShareAction,
  removeFlagAction,
  saveCaptionAction,
  undoAllAction,
  undoApprovalAction,
  type ReviewActionResult,
} from "@/app/(app)/create/[briefId]/actions";
import { alertClass, badge, cardClass, errorClass, hintClass, linkButton, outlineButton, primaryButton, quietButton, secondaryButton, strongButton, type BadgeTone } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ReviewData, ReviewPost } from "@/lib/create";
import { fill, s } from "@/lib/i18n/strings";
import { ReviewCaptions } from "./review-captions";
import { ReviewChecks } from "./review-checks";
import { SharePanel } from "./share-panel";
import { SlideStrip } from "./slide-strip";
import { StepFooter } from "./step-footer";

const t = s.create.review;
const a = s.approvals;

const STATUS_TONE: Record<string, BadgeTone> = {
  approved: "ok",
  posted: "info",
  skipped: "neutral",
};

type Message = { kind: "ok" | "error"; text: string };

/**
 * The review step: the caption and hashtags of each channel (editable here), then every channel's post with all its sizes
 * and the "Please check" items (confirm or remove, as in the weekly screen). A post is approved only when nothing is open and
 * its pictures have no problem; after that the owner downloads, copies or shares it. "Undo all" puts the posts back to their
 * first generated design and words.
 */
export function ReviewScreen({ data }: { data: ReviewData }) {
  const [view, setView] = useState(data);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [channel, setChannel] = useState(data.posts[0]?.channel ?? "");
  const [editing, setEditing] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);

  async function run(name: string, fn: () => Promise<ReviewActionResult>) {
    setBusy(name);
    setMessage(null);
    const r = await fn();
    if (r.view) setView(r.view);
    setMessage({ kind: r.ok ? "ok" : "error", text: r.message });
    setBusy(null);
    return r.ok;
  }

  async function saveCaption(forChannel: string, caption: string, hashtags: string): Promise<string | null> {
    setBusy("caption");
    setMessage(null);
    const r = await saveCaptionAction(view.briefId, forChannel, caption, hashtags);
    if (r.view) setView(r.view);
    setBusy(null);
    if (!r.ok) return r.message;
    setEditing(false);
    setMessage({ kind: "ok", text: r.message });
    return null;
  }

  async function undoAll() {
    const ok = await run("undoAll", () => undoAllAction(view.briefId));
    if (ok) {
      setEditing(false);
      setAcks({});
    }
    setUndoOpen(false);
  }

  const approvable = view.posts.filter((p) => p.status === "draft" && p.canApprove);
  const anyApproved = view.posts.some((p) => p.status === "approved" || p.status === "posted");
  const anyPosted = view.posts.some((p) => p.status === "posted");

  return (
    <div className="space-y-4" data-review>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 basis-64 text-[14px] leading-5 text-desc">{t.intro}</p>
        {!anyPosted ? (
          <button type="button" className={quietButton} disabled={busy !== null} onClick={() => setUndoOpen(true)} aria-haspopup="dialog" data-undo-all>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 14L4 9l5-5" />
              <path d="M4 9h10a6 6 0 010 12h-3" />
            </svg>
            {t.undoAll.button}
          </button>
        ) : null}
      </div>

      {view.posts.length > 1 && approvable.length > 0 ? (
        <button type="button" className={strongButton} disabled={busy !== null} onClick={() => void run("all", () => approveAllAction(view.briefId))}>
          {busy === "all" ? t.approving : t.approveAll}
        </button>
      ) : null}

      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? errorClass : "text-[13px] font-medium leading-[18px] text-ok-tx"}>
          {message.text}
        </p>
      ) : null}

      <ReviewCaptions posts={view.posts} channel={channel} editing={editing} busy={busy !== null} onChannel={setChannel} onEditing={setEditing} onSave={saveCaption} />

      <ul className="space-y-4">
        {view.posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            briefId={view.briefId}
            busy={busy}
            run={run}
            acks={acks}
            setAcks={setAcks}
            onEditCaption={(c) => {
              setChannel(c);
              setEditing(true);
            }}
          />
        ))}
      </ul>

      <StepFooter status={view.allApproved ? <span className="font-medium text-ok-tx">{t.allApproved}</span> : null}>
        <Link href={`/create/${view.briefId}/design`} className={outlineButton}>
          {t.backToDesign}
        </Link>
        <Link href={`/create/${view.briefId}/schedule`} className={anyApproved ? primaryButton : secondaryButton} data-next-schedule>
          {t.nextSchedule}
        </Link>
      </StepFooter>

      <ConfirmDialog
        open={undoOpen}
        title={t.undoAll.title}
        body={t.undoAll.body}
        confirmLabel={busy === "undoAll" ? t.undoAll.working : t.undoAll.confirm}
        cancelLabel={t.undoAll.cancel}
        busy={busy === "undoAll"}
        onConfirm={() => void undoAll()}
        onClose={() => setUndoOpen(false)}
      />
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
  onEditCaption,
}: {
  post: ReviewPost;
  briefId: string;
  busy: string | null;
  run: (name: string, fn: () => Promise<ReviewActionResult>) => Promise<boolean>;
  acks: Record<string, boolean>;
  setAcks: (v: Record<string, boolean>) => void;
  onEditCaption: (channel: string) => void;
}) {
  const approved = post.status === "approved" || post.status === "posted";
  const open = post.openFlags;

  return (
    <li className={`min-w-0 space-y-4 ${cardClass} md:p-6`} data-post-id={post.id} data-channel={post.channel} data-status={post.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-card-title text-title">{fill(t.postFor, { channel: post.label })}</h2>
        <span className={badge(STATUS_TONE[post.status] ?? "warn")}>{(t.status as Record<string, string>)[post.status] ?? t.status.draft}</span>
      </div>

      <div className="flex flex-wrap gap-3" data-pictures>
        {(post.carouselAsked ? [] : post.images).map((img) => (
          <figure key={img.format} className="max-w-full space-y-1" data-format={img.format}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={`${fill(t.postFor, { channel: post.label })}, ${t.share.sizeNames[img.format]}`} className="max-h-72 rounded-xl bg-well object-contain ring-1 ring-black/5" />
            <figcaption className="text-note text-desc">{t.share.sizeNames[img.format]}</figcaption>
          </figure>
        ))}
        {post.images.length === 0 && !post.carouselAsked ? <p className={hintClass}>{s.share.noImage}</p> : null}
      </div>
      {post.slides.length > 0 ? (
        <div data-carousel>
          {post.carouselAsked ? null : <p className="text-ui text-title">{fill(t.carousel, { n: post.slides.length })}</p>}
          <SlideStrip urls={post.slides} flagged={[...new Set(open.flatMap((f) => (f.slide === undefined ? [] : [f.slide])))]} />
        </div>
      ) : null}

      <p className={`text-note font-medium ${open.length > 0 ? "text-warn-tx" : "text-ok-tx"}`}>{open.length > 0 ? fill(t.flagsOpen, { n: open.length }) : t.flagsNone}</p>
      {post.reminder ? <p className={alertClass("grey")}>{a.flags.reminder}</p> : null}

      {post.blockers.length > 0 ? (
        <section className={`space-y-1 ${alertClass("err")}`} aria-label={t.problemTitle} data-blockers>
          <h3 className="text-ui text-err-tx">{t.problemTitle}</h3>
          {post.blockers.map((b) => (
            <p key={`${b.format}-${b.code}`} className="text-[13px] leading-[18px]">
              {fill(t.problems[b.code], { format: t.share.sizeNames[b.format], detail: b.detail })}
            </p>
          ))}
          <Link href={`/create/${briefId}/design`} className={linkButton}>
            {t.backToDesign}
          </Link>
        </section>
      ) : null}

      {!approved ? (
        <ReviewChecks
          post={post}
          briefId={briefId}
          busy={busy !== null}
          acks={acks}
          setAcks={setAcks}
          onConfirm={(flagId, ack) => void run("flag", () => confirmFlagAction(briefId, post.id, flagId, ack))}
          onRemove={(flagId) => void run("flag", () => removeFlagAction(briefId, post.id, flagId))}
          onEditCaption={onEditCaption}
        />
      ) : null}

      {!approved ? (
        <div className="space-y-1">
          <button type="button" data-approve className={primaryButton} disabled={busy !== null || !post.canApprove} onClick={() => void run("approve", () => approvePostAction(briefId, post.id))}>
            {busy === "approve" ? t.approving : t.approve}
          </button>
          {open.length > 0 ? <p className={hintClass}>{t.blockedHint}</p> : null}
        </div>
      ) : (
        <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-well p-3" aria-label={t.share.title} data-share>
          <h3 className="text-card-title text-title">{t.share.title}</h3>
          <SharePanel
            postId={post.id}
            channel={post.channel}
            images={post.images}
            slides={post.carouselAsked ? post.slides : []}
            shareText={post.shareText}
            onLog={(kind, format) => void logShareAction(post.id, kind, format)}
          />
          {post.status === "approved" ? (
            <button type="button" className={quietButton} disabled={busy !== null} onClick={() => void run("undo", () => undoApprovalAction(briefId, post.id))}>
              {t.undo}
            </button>
          ) : null}
        </section>
      )}
    </li>
  );
}
