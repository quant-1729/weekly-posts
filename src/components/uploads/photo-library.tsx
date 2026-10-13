"use client";

import { useRef, useState, useTransition } from "react";
import { errorClass, hintClass, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { MAX_PHOTOS, PHOTO_ACCEPT } from "@/lib/uploads/limits";
import type { PhotoView } from "@/lib/uploads/photos";
import { removePhotoAction, setHasPeopleAction } from "./actions";
import { postImage } from "./upload-client";

/** The owner's photo library: add (several at once), delete, and say whether people are in a photo. */
export function PhotoLibrary({ brandId, initialPhotos }: { brandId: string; initialPhotos: PhotoView[] }) {
  const t = s.uploads.photos;
  const [photos, setPhotos] = useState<PhotoView[]>(initialPhotos);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  async function onPick(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (input.current) input.current.value = "";
    if (list.length === 0) return;
    setError(null);
    let count = photos.length;
    for (let i = 0; i < list.length; i++) {
      if (count >= MAX_PHOTOS) {
        setError(s.uploads.errors.photoLimit);
        break;
      }
      setProgress({ done: i, total: list.length });
      const reply = await postImage<{ photo: PhotoView }>("/api/uploads/photos", brandId, list[i]);
      if (!reply.ok) {
        setError(reply.message);
        continue; // keep going: one bad file should not stop the rest
      }
      count += 1;
      setPhotos((cur) => [reply.photo, ...cur]);
    }
    setProgress(null);
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await removePhotoAction(brandId, id);
      if (r.ok) setPhotos((cur) => cur.filter((p) => p.id !== id));
      else setError(r.message);
    });
  }

  function toggleHasPeople(id: string, value: boolean) {
    setError(null);
    setPhotos((cur) => cur.map((p) => (p.id === id ? { ...p, hasPeople: value } : p)));
    startTransition(async () => {
      const r = await setHasPeopleAction(brandId, id, value);
      if (!r.ok) {
        setPhotos((cur) => cur.map((p) => (p.id === id ? { ...p, hasPeople: !value } : p)));
        setError(t.saveFailed);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">{t.title}</h3>
        <p className={hintClass}>{t.hint}</p>
      </div>

      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        className="sr-only"
        aria-label={t.add}
        onChange={(e) => void onPick(e.target.files)}
      />
      <button
        type="button"
        className={secondaryButton}
        disabled={progress !== null || photos.length >= MAX_PHOTOS}
        onClick={() => input.current?.click()}
      >
        {progress ? fill(t.adding, { n: Math.min(progress.done + 1, progress.total), total: progress.total }) : t.add}
      </button>
      <p className="text-sm text-stone-500">{fill(t.count, { n: photos.length, max: MAX_PHOTOS })}</p>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}

      {photos.length === 0 ? (
        <p className="text-stone-600">{t.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {photos.map((p) => (
            <li key={p.id} className="space-y-1 rounded-xl border border-stone-200 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={fill(t.alt, { description: p.description ?? t.noDescription })}
                className="aspect-square w-full rounded-lg bg-stone-100 object-cover"
              />
              <p className="text-xs text-stone-600">{p.description ?? t.noDescription}</p>
              {p.usable === false && <p className="text-xs text-amber-800">{t.lowQuality}</p>}
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={p.hasPeople === true}
                  onChange={(e) => toggleHasPeople(p.id, e.target.checked)}
                />
                {t.hasPeople}
              </label>
              {p.hasPeople === true && <p className="text-xs text-amber-800">{t.peopleNote}</p>}
              <button type="button" className="min-h-10 text-sm text-red-700 underline" onClick={() => remove(p.id)}>
                {t.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
