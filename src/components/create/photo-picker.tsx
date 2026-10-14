"use client";

import { useRef, useState } from "react";
import { errorClass, secondaryButton } from "@/components/ui";
import { postImage } from "@/components/uploads/upload-client";
import { s } from "@/lib/i18n/strings";
import { MAX_PHOTOS, PHOTO_ACCEPT } from "@/lib/uploads/limits";
import type { PhotoView } from "@/lib/uploads/photos";
import { EditorCard, pickClass } from "./card";

const t = s.create.photo;

/**
 * Photo (B-5): one of the owner's photos, a new upload, or "No photo (design only)". The AI never
 * draws the product, so a photo always comes from the owner.
 */
export function PhotoPicker({
  brandId,
  photos: initial,
  photoId,
  onChange,
}: {
  brandId: string;
  photos: PhotoView[];
  photoId: string | null;
  onChange: (photoId: string | null) => void;
}) {
  const [photos, setPhotos] = useState<PhotoView[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (input.current) input.current.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    const reply = await postImage<{ photo: PhotoView }>("/api/uploads/photos", brandId, file);
    setBusy(false);
    if (!reply.ok) {
      setError(reply.message);
      return;
    }
    setPhotos((cur) => [reply.photo, ...cur]);
    onChange(reply.photo.id);
  }

  return (
    <EditorCard id="photo" title={t.title} hint={t.hint}>
      <fieldset className="min-w-0 space-y-3">
        <legend className="sr-only">{t.title}</legend>
        <label className={pickClass(photoId === null)}>
          <input type="radio" name="photo" className="mt-1 h-5 w-5 shrink-0" checked={photoId === null} onChange={() => onChange(null)} />
          <span className="min-w-0">
            <span className="block font-medium">{t.none}</span>
            <span className="block text-sm text-stone-600">{t.noneHint}</span>
          </span>
        </label>
        {photos.length === 0 ? (
          <p className="text-stone-600">{t.empty}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => (
              <li key={p.id} data-photo-id={p.id} className="min-w-0">
                <label className={`block cursor-pointer rounded-xl border p-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#E4572E] ${photoId === p.id ? "border-[#E4572E] ring-2 ring-[#E4572E]/40" : "border-stone-300"}`}>
                  <input type="radio" name="photo" className="sr-only" checked={photoId === p.id} onChange={() => onChange(p.id)} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.description ?? t.alt} className="aspect-square w-full rounded-lg bg-stone-100 object-cover" />
                  {p.usable === false && <span className="mt-1 block text-xs text-amber-800">{t.notUsable}</span>}
                  {p.hasPeople === true && <span className="mt-1 block text-xs text-amber-800">{t.people}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <input ref={input} type="file" accept={PHOTO_ACCEPT} className="sr-only" aria-label={t.upload} onChange={(e) => void onPick(e.target.files)} />
      <button type="button" className={secondaryButton} disabled={busy || photos.length >= MAX_PHOTOS} onClick={() => input.current?.click()}>
        {busy ? t.uploading : t.upload}
      </button>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </EditorCard>
  );
}
