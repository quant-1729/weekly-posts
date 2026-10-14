"use client";

import { useState } from "react";
import { ShareButtons } from "@/components/share/share-buttons";
import { errorClass, hintClass, inputClass, labelClass } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { formatDayMonth } from "@/lib/links/format";
import { UNMARK_WINDOW_MS } from "@/lib/share/formats";
import { tweenSignal } from "@/lib/tween/events";
import type { PhotoChoice, WeekPostView, WeekView as WeekData } from "@/lib/weekly/view";
import { MascotControls } from "./mascot-controls";
import {
  approvePostAction,
  confirmFlagAction,
  logShareAction,
  markPostedAction,
  removeFlagAction,
  rewritePostAction,
  savePostAction,
  skipPostAction,
  swapPhotoAction,
  undoPostAction,
  unmarkPostedAction,
  type PostActionResult,
} from "./actions";

const t = s.approvals;

const smallButton =
  "min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-base font-medium text-stone-800 disabled:opacity-50";
const strongButton = "min-h-11 rounded-lg bg-[#E4572E] px-4 py-2 text-base font-semibold text-white disabled:opacity-50";

const STATUS_CLASS: Record<string, string> = {
  approved: "bg-green-100 text-green-800",
  skipped: "bg-stone-200 text-stone-700",
  posted: "bg-blue-100 text-blue-800",
};

function dayLabel(day: string | null): string {
  if (!day) return "";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

type Message = { kind: "ok" | "error"; text: string; lines: string[] };

/** One post of the week: picture, words, status, the "please check" list and the approve / skip / edit buttons. */
export function PostCard({ post, photos, weekStart, onView }: { post: WeekPostView; photos: PhotoChoice[]; weekStart: string; onView: (v: WeekData) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [editing, setEditing] = useState(false);
  const [acks, setAcks] = useState<Record<string, boolean>>({});

  const open = post.flags.filter((f) => f.status === "open" && f.kind !== "regulated_reminder");
  const posted = post.status === "posted";
  // "Not posted yet" works for a day after marking (the server checks it again).
  const [now] = useState(() => Date.now());
  const canUnmark = posted && post.postedAt !== null && now - new Date(post.postedAt).getTime() <= UNMARK_WINDOW_MS;

  async function run(name: string, fn: () => Promise<PostActionResult>): Promise<PostActionResult> {
    setBusy(name);
    setMessage(null);
    const r = await fn();
    if (r.view) onView(r.view);
    if (r.ok && name === "approve") {
      // Tween reacts to the owner's approval; the whole week done gets the bigger celebration.
      const ps = r.view?.posts ?? [];
      const allDone = ps.some((p) => p.status === "approved") && ps.every((p) => ["approved", "posted", "skipped"].includes(p.status));
      tweenSignal(allDone ? "all_approved" : "approved");
    }
    setMessage(r.ok ? { kind: "ok", text: r.message, lines: r.lines } : { kind: "error", text: r.errors?.length ? "" : r.message, lines: r.errors ?? [] });
    setBusy(null);
    return r;
  }

  return (
    <li className={`space-y-3 rounded-xl border border-stone-200 bg-white p-3 md:p-4 ${editing && !posted ? "lg:col-span-2" : ""}`} data-post-id={post.id}>
      {/* Phones: a small picture beside the words. Tablets: a bigger picture beside them. Desktop grid: the picture on top, large enough to judge. */}
      <div className="flex gap-3 md:gap-4 lg:flex-col">
        {post.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.imageUrl} alt={s.week.imageAlt} className="size-24 shrink-0 rounded-lg bg-stone-100 object-cover md:size-56 md:object-contain lg:h-80 lg:w-full" />
        ) : (
          <div className="flex size-24 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-500 md:size-56 lg:h-80 lg:w-full">{s.week.noImage}</div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-stone-800">
            {dayLabel(post.suggestedDay)}
            {post.channel ? <span className="font-normal text-stone-600"> · {s.week.channels[post.channel]}</span> : null}{" "}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[post.status] ?? "bg-amber-100 text-amber-800"}`}>
              {posted && post.postedOn ? fill(s.share.postedOn, { date: formatDayMonth(post.postedOn) }) : (t.status as Record<string, string>)[post.status] ?? t.status.draft}
            </span>
          </p>
          {post.occasion ? <p className="text-xs text-stone-500">{fill(s.week.occasion, { name: post.occasion })}</p> : null}
          <p className="whitespace-pre-line text-sm text-stone-700 md:text-base">{post.caption}</p>
          <p className={`text-xs font-medium ${post.flagCount > 0 ? "text-amber-700" : "text-green-700"}`}>
            {post.flagCount > 0 ? fill(s.week.flagsCount, { n: post.flagCount }) : s.week.flagsNone}
          </p>
        </div>
      </div>

      {post.reminder ? <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{t.flags.reminder}</p> : null}

      {open.length > 0 && !posted ? (
        <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3" aria-label={t.flags.title}>
          <div>
            <h3 className="font-semibold text-amber-900">{t.flags.title}</h3>
            <p className="text-sm text-stone-600">{t.flags.intro}</p>
          </div>
          {open.map((f) => {
            const canConfirm = f.kind !== "avoid";
            const ack = acks[f.id] === true;
            return (
              <div key={f.id} className="space-y-2 border-t border-amber-200 pt-3">
                <p className="text-sm text-stone-600">
                  {t.flags.kinds[f.kind]} · {fill(t.flags.where, { field: t.fieldNames[f.field] })}
                </p>
                <p className="text-base font-semibold">
                  <mark className="rounded bg-amber-200 px-1">{f.text}</mark>
                </p>
                {f.regulated && canConfirm ? (
                  <div className="space-y-2">
                    <p className="rounded bg-amber-100 p-2 text-sm text-amber-900">{t.flags.regulatedWarning}</p>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1 size-5" checked={ack} onChange={(e) => setAcks({ ...acks, [f.id]: e.target.checked })} />
                      <span>{t.flags.regulatedTick}</span>
                    </label>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {canConfirm ? (
                    <button
                      type="button"
                      className={smallButton}
                      disabled={busy !== null || (f.regulated && !ack)}
                      onClick={() => run("flag", () => confirmFlagAction(weekStart, post.id, f.id, ack))}
                    >
                      {t.flags.confirm}
                    </button>
                  ) : null}
                  {f.highlight ? (
                    <button type="button" className={smallButton} disabled={busy !== null} onClick={() => run("flag", () => removeFlagAction(weekStart, post.id, f.id))}>
                      {f.kind === "avoid" ? t.flags.removeWord : t.flags.remove}
                    </button>
                  ) : (
                    <button type="button" className={smallButton} disabled={busy !== null} onClick={() => setEditing(true)}>
                      {t.dash.edit}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {message ? (
        <div role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? errorClass : "text-sm font-medium text-green-800"}>
          {message.text ? <p>{message.text}</p> : null}
          {message.lines.map((l) => (
            <p key={l} className={message.kind === "error" ? "" : "font-normal text-stone-700"}>
              {l}
            </p>
          ))}
        </div>
      ) : null}
      {busy === "rewrite" ? (
        <p role="status" className="text-sm text-stone-600">
          {t.dash.rewriting}
        </p>
      ) : null}

      {post.status === "approved" ? (
        <section className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3" aria-label={s.share.heading}>
          <h3 className="font-semibold">{s.share.heading}</h3>
          <ShareButtons
            postId={post.id}
            channel={post.channel!}
            images={post.images}
            shareText={post.shareText}
            busy={busy !== null}
            onLog={(kind, format, story) => void logShareAction(post.id, kind, format, story)}
            onMarkPosted={() => void run("posted", () => markPostedAction(weekStart, post.id))}
          />
        </section>
      ) : null}

      {posted && canUnmark ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallButton} disabled={busy !== null} onClick={() => run("unposted", () => unmarkPostedAction(weekStart, post.id))}>
            {s.share.unmarkPosted}
          </button>
        </div>
      ) : null}

      {!posted ? (
        <div className="flex flex-wrap gap-2">
          {post.status !== "approved" ? (
            <button
              type="button"
              className={strongButton}
              disabled={busy !== null || open.length > 0}
              title={open.length > 0 ? t.approve.blockedHint : undefined}
              onClick={() => run("approve", () => approvePostAction(weekStart, post.id))}
            >
              {t.dash.approve}
            </button>
          ) : null}
          {post.status !== "skipped" ? (
            <button type="button" className={smallButton} disabled={busy !== null} onClick={() => run("skip", () => skipPostAction(weekStart, post.id))}>
              {t.dash.skip}
            </button>
          ) : null}
          <button type="button" className={smallButton} disabled={busy !== null} aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? t.dash.close : t.dash.edit}
          </button>
          {post.status === "approved" || post.status === "skipped" ? (
            <button type="button" className={smallButton} disabled={busy !== null} onClick={() => run("undo", () => undoPostAction(weekStart, post.id))}>
              {t.dash.undo}
            </button>
          ) : null}
        </div>
      ) : null}
      {open.length > 0 && !posted && post.status !== "approved" ? <p className={hintClass}>{t.approve.blockedHint}</p> : null}

      {editing && !posted ? (
        <PostEditor
          key={[post.fullCaption, post.cta, post.hashtags.join(" "), post.imageText.headline, post.imageText.subline, post.bubble ?? "", post.mascotId ?? ""].join("\u0001")}
          post={post}
          photos={photos}
          weekStart={weekStart}
          busy={busy}
          run={run}
        />
      ) : null}
    </li>
  );
}

function PostEditor({
  post,
  photos,
  weekStart,
  busy,
  run,
}: {
  post: WeekPostView;
  photos: PhotoChoice[];
  weekStart: string;
  busy: string | null;
  run: (name: string, fn: () => Promise<PostActionResult>) => Promise<PostActionResult>;
}) {
  const [caption, setCaption] = useState(post.fullCaption);
  const [cta, setCta] = useState(post.cta);
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [headline, setHeadline] = useState(post.imageText.headline);
  const [subline, setSubline] = useState(post.imageText.subline);
  const [photo, setPhoto] = useState<string>(post.photoId ?? "none");
  const [insist, setInsist] = useState(false);
  const [instruction, setInstruction] = useState("");

  async function changePhoto(force: boolean) {
    const r = await run("photo", () => swapPhotoAction(weekStart, post.id, photo === "none" ? null : photo, force));
    setInsist(!r.ok && r.insistPhoto === true);
  }

  return (
    <div className="space-y-6 border-t border-stone-200 pt-4 lg:grid lg:grid-cols-2 lg:gap-x-10 lg:space-y-0">
      <div className="space-y-6">
      <MascotControls post={post} weekStart={weekStart} busy={busy} run={run} />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run("save", () => savePostAction(weekStart, post.id, { caption, cta, hashtags, headline, subline }));
        }}
      >
        <h3 className="font-semibold">{t.edit.textTitle}</h3>
        <div>
          <label className={labelClass} htmlFor={`cap-${post.id}`}>{t.edit.captionLabel}</label>
          <textarea id={`cap-${post.id}`} className={inputClass} rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cta-${post.id}`}>{t.edit.ctaLabel}</label>
          <input id={`cta-${post.id}`} className={inputClass} value={cta} onChange={(e) => setCta(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`tags-${post.id}`}>{t.edit.hashtagsLabel}</label>
          <input id={`tags-${post.id}`} className={inputClass} value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`head-${post.id}`}>{t.edit.headlineLabel}</label>
          <input id={`head-${post.id}`} className={inputClass} value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`sub-${post.id}`}>{t.edit.sublineLabel}</label>
          <input id={`sub-${post.id}`} className={inputClass} value={subline} onChange={(e) => setSubline(e.target.value)} />
        </div>
        <button type="submit" className={strongButton} disabled={busy !== null}>
          {busy === "save" ? t.dash.working : t.edit.save}
        </button>
      </form>
      </div>

      <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="font-semibold">{t.edit.photoTitle}</legend>
        <p className={hintClass}>{t.edit.photoHelp}</p>
        {photos.length === 0 ? <p className="text-sm text-stone-600">{t.edit.photoEmpty}</p> : null}
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <label key={p.id} className={`block cursor-pointer rounded-lg border p-1 text-center text-xs ${photo === p.id ? "border-[#E4572E] ring-2 ring-[#E4572E]/30" : "border-stone-200"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.description} className="aspect-square w-full rounded object-cover" />
              <input type="radio" name={`photo-${post.id}`} className="mt-1 size-5" checked={photo === p.id} onChange={() => { setPhoto(p.id); setInsist(false); }} />
              {!p.usable ? <span className="block text-amber-700">{t.edit.photoLowQuality}</span> : null}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2">
          <input type="radio" name={`photo-${post.id}`} className="size-5" checked={photo === "none"} onChange={() => { setPhoto("none"); setInsist(false); }} />
          <span>{t.edit.photoNone}</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallButton} disabled={busy !== null} onClick={() => void changePhoto(false)}>
            {busy === "photo" ? t.dash.working : t.edit.photoUse}
          </button>
          {insist ? (
            <button type="button" className={smallButton} disabled={busy !== null} onClick={() => void changePhoto(true)}>
              {t.edit.photoInsist}
            </button>
          ) : null}
        </div>
      </fieldset>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run("rewrite", () => rewritePostAction(weekStart, post.id, instruction));
        }}
      >
        <h3 className="font-semibold">{t.edit.rewriteTitle}</h3>
        <p className={hintClass}>{t.edit.rewriteHelp}</p>
        <div className="flex flex-wrap gap-2">
          {t.edit.chips.map((chip) => (
            <button key={chip} type="button" className="min-h-11 rounded-full border border-stone-300 bg-stone-50 px-4 py-2 text-base" disabled={busy !== null} onClick={() => void run("rewrite", () => rewritePostAction(weekStart, post.id, chip))}>
              {chip}
            </button>
          ))}
        </div>
        <div>
          <label className={labelClass} htmlFor={`ins-${post.id}`}>{t.edit.rewriteLabel}</label>
          <input id={`ins-${post.id}`} className={inputClass} maxLength={200} placeholder={t.edit.rewritePlaceholder} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        </div>
        <button type="submit" className={strongButton} disabled={busy !== null || instruction.trim().length < 3}>
          {busy === "rewrite" ? t.dash.working : t.edit.rewriteButton}
        </button>
      </form>
      </div>
    </div>
  );
}
