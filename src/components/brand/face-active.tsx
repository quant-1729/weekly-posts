"use client";

import { useState } from "react";
import { retireFaceAction, setFaceInPostsAction, updateFaceSettingsAction } from "@/app/(app)/brand/face-actions";
import { alertClass, chipClass, dangerButton, errorClass, hintClass, labelClass, outlineButton, secondaryButton } from "@/components/ui";
import { POST_TYPES, type PostType } from "@/lib/briefs/types";
import type { CardFace } from "@/lib/faces/card-types";
import type { FacePlacement } from "@/lib/faces/types";
import { FACE_POSES } from "@/lib/faces/types";
import { s } from "@/lib/i18n/strings";
import { poseLabel } from "./face-ui";

const t = s.faces.card.active;
const SIZES = ["small", "medium", "large"] as const;

/**
 * The face in use (step 5): its name and kind, the seven poses, whether it is on in posts, which kinds of post it
 * appears on, how big it is, and Retire. A realistic AI person is never shown on a review post, so that kind of post
 * stays unticked for it.
 */
export function FaceActive({ face, inPosts, onChange, onChoose }: { face: CardFace; inPosts: boolean; onChange: () => Promise<void>; onChoose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const photoreal = face.kind === "photoreal";
  const blocked = (type: PostType) => photoreal && type === "testimonial";
  const shown = POST_TYPES.filter((type) => !blocked(type) && (face.postTypes === null || face.postTypes.includes(type)));

  async function run(label: string, fn: () => Promise<{ ok: true } | { ok: false; message: string }>, ok?: string) {
    setBusy(label);
    setMessage(null);
    const r = await fn();
    setMessage(r.ok ? (ok ? { ok: true, text: ok } : null) : { ok: false, text: r.message });
    await onChange();
    setBusy(null);
  }

  function toggleType(type: PostType, on: boolean) {
    const next = new Set(shown);
    if (on) next.add(type);
    else next.delete(type);
    const eligible = POST_TYPES.filter((x) => !blocked(x));
    // Everything ticked means "every kind of post" (the face layer still keeps a realistic AI person off review posts).
    const all = eligible.every((x) => next.has(x));
    void run("types", () => updateFaceSettingsAction(face.id, { postTypes: all ? [] : POST_TYPES.filter((x) => next.has(x)) }), t.saved);
  }

  function setSize(size: NonNullable<FacePlacement["size"]>) {
    void run("size", () => updateFaceSettingsAction(face.id, { placement: { ...face.placement, size } }), t.saved);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-card-title text-title">{face.name}</h3>
        <p className="text-[14px] leading-5 text-desc">
          {t.kind}: {s.faces.kinds[face.kind].label}
        </p>
      </div>

      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-7" aria-label={t.title}>
        {FACE_POSES.map((pose) => {
          const p = face.poses.find((x) => x.pose === pose);
          return (
            <li key={pose} className="min-w-0">
              {p ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt={poseLabel(pose)} className="aspect-[3/4] w-full rounded-lg bg-cream object-contain" />
              ) : null}
            </li>
          );
        })}
      </ul>

      {photoreal && (
        <p className={alertClass("info")} data-ai-note>
          {s.faces.card.aiNote}
        </p>
      )}

      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-6" checked={inPosts} disabled={busy !== null} onChange={(e) => void run("inPosts", () => setFaceInPostsAction(e.target.checked), t.saved)} />
        <span className="font-medium">{t.inPosts}</span>
      </label>

      <fieldset className="min-w-0">
        <legend className={labelClass}>{s.faces.settings.postTypes}</legend>
        <p className={hintClass}>{t.postTypesHint}</p>
        <div className="flex flex-wrap gap-2">
          {POST_TYPES.map((type) => {
            const on = shown.includes(type);
            return (
              <label key={type} className={`${chipClass(on)} ${blocked(type) ? "opacity-50" : "cursor-pointer"}`}>
                <input type="checkbox" className="sr-only" checked={on} disabled={busy !== null || blocked(type)} onChange={(e) => toggleType(type, e.target.checked)} />
                {s.create.type.options[type].label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="face-size" className={labelClass}>
          {s.faces.placement.size}
        </label>
        <p className={hintClass}>{t.sizeHint}</p>
        <select id="face-size" className="block w-full max-w-xs rounded-2xl border border-line-input bg-white px-3.5 py-2.5 text-[14px] max-md:min-h-11" value={face.placement.size ?? "medium"} disabled={busy !== null} onChange={(e) => setSize(e.target.value as (typeof SIZES)[number])}>
          {SIZES.map((size) => (
            <option key={size} value={size}>
              {s.faces.placement.sizes[size]}
            </option>
          ))}
        </select>
      </div>

      {busy !== null && (
        <p role="status" className={hintClass}>
          {t.saving}
        </p>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-[13px] leading-[18px] text-ok-tx" : errorClass}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} disabled={busy !== null} onClick={onChoose}>
          {t.change}
        </button>
        {!confirmRetire ? (
          <button type="button" className={outlineButton} disabled={busy !== null} onClick={() => setConfirmRetire(true)}>
            {t.retire}
          </button>
        ) : (
          <button type="button" className={dangerButton} disabled={busy !== null} onClick={() => void run("retire", () => retireFaceAction(face.id))}>
            {busy === "retire" ? t.retiring : t.retire}
          </button>
        )}
      </div>
      {confirmRetire && <p className={hintClass}>{t.retireHelp}</p>}
    </div>
  );
}
