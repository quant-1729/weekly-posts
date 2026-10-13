"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { errorClass, hintClass, inputClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { MAX_PAST_POSTS, PAST_POST_MAX_CHARS, PHOTO_ACCEPT } from "@/lib/uploads/limits";
import type { PastPostView } from "@/lib/uploads/past-posts";
import { addPastPostTextAction, removePastPostAction, updatePastPostTextAction } from "./actions";
import { postImage } from "./upload-client";

/** Past posts the owner shares so new posts sound like them: pasted text or a screenshot we read. */
export function PastPosts({ brandId, initialPosts }: { brandId: string; initialPosts: PastPostView[] }) {
  const t = s.uploads.pastPosts;
  const router = useRouter();
  const [posts, setPosts] = useState<PastPostView[]>(initialPosts);
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const full = posts.length >= MAX_PAST_POSTS;

  function saveText() {
    setError(null);
    startTransition(async () => {
      const r = await addPastPostTextAction(brandId, draft);
      if (!r.ok) return setError(r.message);
      setPosts((cur) => [...cur, r.post]);
      setDraft("");
      setPasting(false);
      router.refresh();
    });
  }

  async function onScreenshot(files: FileList | null) {
    const file = files?.[0];
    if (input.current) input.current.value = "";
    if (!file) return;
    setError(null);
    setReading(true);
    const reply = await postImage<{ post: PastPostView }>("/api/uploads/past-posts", brandId, file);
    setReading(false);
    if (!reply.ok) return setError(reply.message);
    setPosts((cur) => [...cur, reply.post]);
    // Let the owner check what we read before relying on it.
    setEditingId(reply.post.id);
    setEditText(reply.post.text);
    router.refresh();
  }

  function saveEdit(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await updatePastPostTextAction(brandId, id, editText);
      if (!r.ok) return setError(r.message);
      setPosts((cur) => cur.map((p) => (p.id === id ? r.post : p)));
      setEditingId(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await removePastPostAction(brandId, id);
      if (!r.ok) return setError(r.message);
      setPosts((cur) => cur.filter((p) => p.id !== id));
      if (editingId === id) setEditingId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">{t.title}</h3>
        <p className={hintClass}>{t.hint}</p>
      </div>

      <div className="flex gap-2">
        <button type="button" className={secondaryButton} disabled={full || pasting} onClick={() => setPasting(true)}>
          {t.pasteText}
        </button>
        <input
          ref={input}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          aria-label={t.uploadScreenshot}
          onChange={(e) => void onScreenshot(e.target.files)}
        />
        <button type="button" className={secondaryButton} disabled={full || reading} onClick={() => input.current?.click()}>
          {reading ? t.reading : t.uploadScreenshot}
        </button>
      </div>
      <p className="text-sm text-stone-500">{fill(t.count, { n: posts.length, max: MAX_PAST_POSTS })}</p>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}

      {pasting && (
        <div className="space-y-2 rounded-xl border border-stone-200 p-3">
          <label className="block font-medium" htmlFor="past-post-text">
            {t.textLabel}
          </label>
          <textarea
            id="past-post-text"
            className={inputClass}
            rows={5}
            maxLength={PAST_POST_MAX_CHARS}
            placeholder={t.textPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className={primaryButton} disabled={pending} onClick={saveText}>
              {pending ? t.saving : t.save}
            </button>
            <button type="button" className={secondaryButton} onClick={() => setPasting(false)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {posts.length === 0 ? (
        <p className="text-stone-600">{t.empty}</p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <li key={p.id} className="space-y-2 rounded-xl border border-stone-200 p-3">
              {p.imageUrl && <p className="text-xs text-stone-500">{t.screenshotBadge}</p>}
              {editingId === p.id ? (
                <div className="space-y-2">
                  {p.imageUrl && <p className="text-sm text-stone-600">{t.editHint}</p>}
                  <textarea
                    className={inputClass}
                    rows={5}
                    maxLength={PAST_POST_MAX_CHARS}
                    value={editText}
                    aria-label={t.edit}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button type="button" className={primaryButton} disabled={pending} onClick={() => saveEdit(p.id)}>
                      {pending ? t.saving : t.save}
                    </button>
                    <button type="button" className={secondaryButton} onClick={() => setEditingId(null)}>
                      {t.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-line text-sm">{p.text}</p>
              )}
              <div className="flex gap-4">
                {editingId !== p.id && (
                  <button
                    type="button"
                    className="min-h-10 text-sm underline"
                    onClick={() => {
                      setEditingId(p.id);
                      setEditText(p.text);
                    }}
                  >
                    {t.edit}
                  </button>
                )}
                <button type="button" className="min-h-10 text-sm text-red-700 underline" disabled={pending} onClick={() => remove(p.id)}>
                  {t.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
