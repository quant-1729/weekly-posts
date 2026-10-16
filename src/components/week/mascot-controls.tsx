"use client";

import { useState } from "react";
import { hintClass, inputClass, labelClass, strongButton } from "@/components/ui";
import { postPoseOrDefault, TWEEN_POST_POSES, type TweenPostPose } from "@/lib/mascot/poses";
import { IMAGE_TEXT_LIMITS } from "@/lib/ai/prompts/shared";
import { fill, s } from "@/lib/i18n/strings";
import type { WeekPostView } from "@/lib/weekly/view";
import type { PostActionResult } from "./actions";
import { savePostMascotAction } from "./mascot-actions";

const t = s.mascot.post;
const BUBBLE_MAX_CHARS = IMAGE_TEXT_LIMITS.bubble;


/**
 * "Your mascot on this post" for the dashboard editor (V-25, D9): show or hide the mascot, its pose (one of the
 * 7 post poses) and its speech bubble. Shown only when the post has a mascot or the brand has one to add. Mount it inside
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
  const [pose, setPose] = useState<TweenPostPose>(postPoseOrDefault(post.pose));
  if (!post.mascotId && !post.canShowMascot) return null;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run("mascot", () => savePostMascotAction(weekStart, post.id, show, bubble, pose));
      }}
    >
      <fieldset className="space-y-3">
        <legend className="text-card-title text-title">{t.title}</legend>
        <p className={hintClass}>{t.help}</p>
        <label className="flex min-h-6 items-center gap-3 text-[14px]">
          <input type="radio" name={`mascot-${post.id}`} checked={show} onChange={() => setShow(true)} />
          <span>{t.show}</span>
        </label>
        <label className="flex min-h-6 items-center gap-3 text-[14px]">
          <input type="radio" name={`mascot-${post.id}`} checked={!show} onChange={() => setShow(false)} />
          <span>{t.hide}</span>
        </label>
        {show ? (
          <div className="space-y-3">
            <div>
              <label className={labelClass} htmlFor={`pose-${post.id}`}>
                {t.poseLabel}
              </label>
              <select id={`pose-${post.id}`} className={inputClass} value={pose} onChange={(e) => setPose(e.target.value as TweenPostPose)}>
                {TWEEN_POST_POSES.map((p) => (
                  <option key={p} value={p}>
                    {s.mascot.poseNames[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor={`bubble-${post.id}`}>
                {fill(t.bubbleLabel, { max: BUBBLE_MAX_CHARS })}
              </label>
              <input id={`bubble-${post.id}`} className={inputClass} maxLength={BUBBLE_MAX_CHARS} value={bubble} onChange={(e) => setBubble(e.target.value)} />
            </div>
          </div>
        ) : null}
        <button type="submit" className={strongButton} disabled={busy !== null}>
          {busy === "mascot" ? s.approvals.dash.working : t.save}
        </button>
      </fieldset>
    </form>
  );
}
