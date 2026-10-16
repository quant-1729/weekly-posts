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
          <input type="radio" name="photo" className="mt-0.5 shrink-0" checked={photoId === null} onChange={() => onChange(null)} />
          <span className="min-w-0">
            <span className="block text-ui text-title">{t.none}</span>
            <span className="mt-0.5 block text-note text-desc">{t.noneHint}</span>
          </span>
        </label>
        {photos.length === 0 ? (
          <p className="text-[13px] leading-[18px] text-desc">{t.empty}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => (
              <li key={p.id} data-photo-id={p.id} className="min-w-0">
                <label className={`relative block cursor-pointer rounded-xl focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral ${photoId === p.id ? "outline-2 outline-offset-2 outline-coral" : ""}`}>
                  <input type="radio" name="photo" className="sr-only" checked={photoId === p.id} onChange={() => onChange(p.id)} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.description ?? t.alt} className="aspect-square w-full rounded-xl bg-well object-cover" />
                  {photoId === p.id && (
                    <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-coral text-white" aria-hidden="true">
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                  )}
                  {p.usable === false && <span className="mt-1 block text-note text-warn-tx">{t.notUsable}</span>}
                  {p.hasPeople === true && <span className="mt-1 block text-note text-warn-tx">{t.people}</span>}
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
