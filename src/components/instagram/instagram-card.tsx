"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import type { InstagramImageView, InstagramState } from "@/lib/instagram/import";
import {
  addInstagramPhotosAction,
  importInstagramAction,
  loadInstagramImagesAction,
  refreshInstagramAction,
  removeInstagramPostsAction,
  type InstagramSnapshot,
} from "./actions";

/** The line under the buttons, from what we last learned about the account. Null when there is nothing to say yet. */
export function instagramStatusLine(state: Pick<InstagramState, "handle" | "status" | "importedPosts">): string | null {
  const t = s.instagram.status;
  const handle = state.handle ?? "";
  switch (state.status) {
    case "imported":
      if (state.importedPosts === 0) return fill(t.importedNone, { handle });
      return state.importedPosts === 1 ? fill(t.importedOne, { handle }) : fill(t.imported, { n: state.importedPosts, handle });
    case "not_business":
      return t.notBusiness;
    case "not_found":
      return fill(t.notFound, { handle });
    case "unavailable":
      return t.unavailable;
    case "failed":
      return t.failed;
    case "found":
      return handle ? fill(t.found, { handle }) : null;
    default:
      return null;
  }
}

/**
 * "Your Instagram" on the brand page: the @name field, bringing in recent posts as past posts, and choosing
 * pictures from those posts as photos. Without Meta settings (`state.available` false) it only saves the name and
 * points to screenshots.
 */
export function InstagramCard({ brandId, initial }: { brandId: string; initial: InstagramState }) {
  const t = s.instagram;
  const router = useRouter();
  const [state, setState] = useState<InstagramState>(initial);
  const [handleInput, setHandleInput] = useState(initial.handle ? `@${initial.handle}` : "");
  const [images, setImages] = useState<InstagramImageView[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"import" | "refresh" | "remove" | "images" | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function apply(snap: InstagramSnapshot) {
    setState(snap.state);
    if (snap.state.handle) setHandleInput(`@${snap.state.handle}`);
    setImages(snap.images.length > 0 ? snap.images : null);
    setPicked(new Set());
  }

  function run(kind: "import" | "refresh" | "remove", call: () => ReturnType<typeof importInstagramAction>) {
    setError(null);
    setNote(null);
    setBusy(kind);
    startTransition(async () => {
      const r = await call();
      setBusy(null);
      if (!r.ok) return setError(r.message);
      apply(r);
      router.refresh(); // the past posts list below shows the new posts
    });
  }

  function showImages() {
    setError(null);
    setNote(null);
    setBusy("images");
    startTransition(async () => {
      const r = await loadInstagramImagesAction(brandId);
      setBusy(null);
      if (!r.ok) return setError(r.message);
      setImages(r.images);
    });
  }

  function addPicked() {
    const ids = [...picked];
    if (ids.length === 0) return;
    setError(null);
    setNote(null);
    setBusy("add");
    startTransition(async () => {
      const r = await addInstagramPhotosAction(brandId, ids);
      setBusy(null);
      if (!r.ok) return setError(r.message);
      setPicked(new Set());
      if (r.images.length > 0) setImages(r.images);
      const done = r.photos.length;
      const parts = [done === 1 ? t.photos.doneOne : fill(t.photos.done, { n: done })];
      if (r.failed > 0) parts.push(r.limitReached ? t.photos.limit : fill(t.photos.someFailed, { n: r.failed }));
      setNote(parts.join(" "));
      router.refresh(); // the photo library above shows the new photos
    });
  }

  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const line = instagramStatusLine(state);
  const typed = handleInput.trim() !== "";
  const idle = busy === null;

  return (
    <div className="space-y-3" data-testid="instagram-card">
      <div>
        <h3 className="text-lg font-semibold">{t.title}</h3>
        <p className={hintClass}>{t.hint}</p>
      </div>

      <div>
        <label htmlFor="ig-handle" className={labelClass}>
          {t.fieldLabel}
        </label>
        <input
          id="ig-handle"
          className={inputClass}
          aria-describedby="ig-own"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={300}
          placeholder={t.placeholder}
          value={handleInput}
          onChange={(e) => setHandleInput(e.target.value)}
        />
        <p id="ig-own" className="mt-1 text-sm text-stone-500">
          {t.ownAccount}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={!idle || !typed}
          onClick={() => run("import", () => importInstagramAction(brandId, handleInput))}
        >
          {busy === "import" ? t.bringing : state.available ? t.bring : t.save}
        </button>
        {state.available && state.handle && (
          <button type="button" className={secondaryButton} disabled={!idle} onClick={() => run("refresh", () => refreshInstagramAction(brandId))}>
            {busy === "refresh" ? t.refreshing : t.refresh}
          </button>
        )}
        {state.importedPosts > 0 && (
          <button type="button" className={secondaryButton} disabled={!idle} onClick={() => run("remove", () => removeInstagramPostsAction(brandId))}>
            {busy === "remove" ? t.removing : t.remove}
          </button>
        )}
      </div>

      {line && (
        <p role="status" className="text-sm text-stone-700">
          {line}
        </p>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}

      {state.available && state.handle && state.status === "imported" && (
        <div className="space-y-3 rounded-xl border border-stone-200 p-3">
          <div>
            <h4 className="font-semibold">{t.photos.title}</h4>
            <p className={hintClass}>{t.photos.hint}</p>
          </div>
          {images === null ? (
            <button type="button" className={secondaryButton} disabled={!idle} onClick={showImages}>
              {busy === "images" ? t.photos.loading : t.photos.show}
            </button>
          ) : images.length === 0 ? (
            <p className="text-stone-600">{t.photos.none}</p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((im) => (
                  <li key={im.mediaId}>
                    <label className={`relative block overflow-hidden rounded-lg border ${picked.has(im.mediaId) ? "border-[#E4572E] ring-2 ring-[#E4572E]/40" : "border-stone-200"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={im.previewUrl}
                        alt={fill(t.photos.pick, { description: im.caption ?? t.photos.noDescription })}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="aspect-square w-full bg-stone-100 object-cover"
                      />
                      <input
                        type="checkbox"
                        className="absolute left-2 top-2 h-6 w-6"
                        checked={picked.has(im.mediaId) || im.added}
                        disabled={im.added || !idle}
                        onChange={() => toggle(im.mediaId)}
                      />
                    </label>
                    {im.added && <p className="mt-1 text-xs text-stone-500">{t.photos.alreadyAdded}</p>}
                  </li>
                ))}
              </ul>
              <button type="button" className={primaryButton} disabled={!idle || picked.size === 0} onClick={addPicked}>
                {busy === "add" ? fill(t.photos.adding, { n: picked.size }) : t.photos.add}
              </button>
            </>
          )}
          {note && (
            <p role="status" className="text-sm text-stone-700">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
