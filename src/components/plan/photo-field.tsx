"use client";

import { useRef, useState } from "react";
import { errorClass, secondaryButton } from "@/components/ui";
import { postImage } from "@/components/uploads/upload-client";
import { s } from "@/lib/i18n/strings";
import { MAX_PHOTOS, PHOTO_ACCEPT } from "@/lib/uploads/limits";
import type { PhotoView } from "@/lib/uploads/photos";

const t = s.create.photo;

export interface PlanPhoto {
  id: string;
  src: string;
  description: string;
  usable?: boolean | null;
  hasPeople?: boolean | null;
}

const tile = (on: boolean) => `relative block cursor-pointer overflow-hidden rounded-xl focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral ${on ? "outline-2 outline-offset-2 outline-coral" : "ring-1 ring-line-light"}`;

/**
 * The photo for the week: one of the brand's library photos, a new upload, or none. Same behaviour and look as the
 * Create flow's photo picker; the pick is saved as the plan's photoId and the design studio starts from it.
 */
export function PlanPhotoField({ brandId, photos: initial, photoId, onChange }: { brandId: string; photos: PlanPhoto[]; photoId: string | null; onChange: (photoId: string | null) => void }) {
  const [photos, setPhotos] = useState<PlanPhoto[]>(initial);
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
    const p = reply.photo;
    setPhotos((cur) => [{ id: p.id, src: p.url, description: p.description ?? "", usable: p.usable, hasPeople: p.hasPeople }, ...cur.filter((x) => x.id !== p.id)]);
    onChange(p.id);
  }

  const upload = (
    <button type="button" className={photos.length === 0 ? `${secondaryButton} w-full border-2 border-dashed border-line-input !bg-white py-3 hover:!bg-hover` : secondaryButton} disabled={busy || photos.length >= MAX_PHOTOS} onClick={() => input.current?.click()} data-plan-upload>
      {busy ? t.uploading : t.upload}
    </button>
  );

  return (
    <div className="mt-3 space-y-3" data-plan-photos>
      <input ref={input} type="file" accept={PHOTO_ACCEPT} className="sr-only" aria-label={t.upload} onChange={(e) => void onPick(e.target.files)} />
      {photos.length === 0 ? (
        <>
          <p className="text-[13px] leading-[18px] text-desc">{t.empty} Upload one now, or carry on without a photo.</p>
          {upload}
        </>
      ) : null}
      <fieldset className="min-w-0">
        <legend className="sr-only">Photo for the week</legend>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
          <li className="min-w-0" data-photo-none>
            <label className={`${tile(photoId === null)} flex aspect-square items-center justify-center bg-cream p-2 text-center`}>
              <input type="radio" name="plan-photo" className="sr-only" checked={photoId === null} onChange={() => onChange(null)} />
              <span className="text-[12.5px] font-medium text-title">No photo</span>
              {photoId === null ? <Check /> : null}
            </label>
          </li>
          {photos.map((p) => (
            <li key={p.id} data-photo-id={p.id} className="min-w-0">
              <label className={tile(photoId === p.id)} title={p.description || undefined}>
                <input type="radio" name="plan-photo" className="sr-only" checked={photoId === p.id} onChange={() => onChange(p.id)} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.description || t.alt} className="aspect-square w-full bg-well object-cover" />
                {photoId === p.id ? <Check /> : null}
              </label>
              {p.usable === false ? <span className="mt-1 block text-note text-warn-tx">{t.notUsable}</span> : null}
              {p.hasPeople === true ? <span className="mt-1 block text-note text-warn-tx">{t.people}</span> : null}
            </li>
          ))}
        </ul>
      </fieldset>
      {photos.length > 0 ? upload : null}
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Check() {
  return (
    <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-coral text-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}
