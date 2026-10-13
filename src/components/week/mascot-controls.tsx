"use client";

import { useState } from "react";
import { hintClass, inputClass, labelClass } from "@/components/ui";
import { IMAGE_TEXT_LIMITS } from "@/lib/ai/prompts/shared";
import { fill, s } from "@/lib/i18n/strings";
import type { WeekPostView } from "@/lib/weekly/view";
import type { PostActionResult } from "./actions";
import { savePostMascotAction } from "./mascot-actions";

const t = s.mascot.post;
const BUBBLE_MAX_CHARS = IMAGE_TEXT_LIMITS.bubble;

const strongButton = "min-h-11 rounded-lg bg-[#E4572E] px-4 py-2 text-base font-semibold text-white disabled:opacity-50";

/**
 * "Your mascot on this post" for the dashboard editor (V-25): show or hide the mascot, and its
 * speech bubble. Shown only when the post has a mascot or the brand has one to add. Mount it inside
 * the post editor with the editor's own `run`, so the message and the refreshed week work as there:
 *
 *   <MascotControls post={post} weekStart={weekStart} busy={busy} run={run} />
 */
export function MascotControls({
  post,
  weekStart,
  busy,
  run,
}: {
  post: WeekPostView;
  weekStart: string;
  busy: string | null;
  run: (name: string, fn: () => Promise<PostActionResult>) => Promise<PostActionResult>;
}) {
  const [show, setShow] = useState(!!post.mascotId);
  const [bubble, setBubble] = useState(post.bubble ?? "");
  if (!post.mascotId && !post.canShowMascot) return null;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run("mascot", () => savePostMascotAction(weekStart, post.id, show, bubble));
      }}
    >
      <fieldset className="space-y-3">
        <legend className="font-semibold">{t.title}</legend>
        <p className={hintClass}>{t.help}</p>
        <label className="flex items-center gap-3">
          <input type="radio" className="size-5" name={`mascot-${post.id}`} checked={show} onChange={() => setShow(true)} />
          <span>{t.show}</span>
        </label>
        <label className="flex items-center gap-3">
          <input type="radio" className="size-5" name={`mascot-${post.id}`} checked={!show} onChange={() => setShow(false)} />
          <span>{t.hide}</span>
        </label>
        {show ? (
          <div>
            <label className={labelClass} htmlFor={`bubble-${post.id}`}>
              {fill(t.bubbleLabel, { max: BUBBLE_MAX_CHARS })}
            </label>
            <input id={`bubble-${post.id}`} className={inputClass} maxLength={BUBBLE_MAX_CHARS} value={bubble} onChange={(e) => setBubble(e.target.value)} />
          </div>
        ) : null}
        <button type="submit" className={strongButton} disabled={busy !== null}>
          {busy === "mascot" ? s.approvals.dash.working : t.save}
        </button>
      </fieldset>
    </form>
  );
}
