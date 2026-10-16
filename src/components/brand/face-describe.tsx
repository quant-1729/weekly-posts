"use client";

import { useId, useState } from "react";
import { createFaceAction } from "@/app/(app)/brand/face-actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton } from "@/components/ui";
import type { FaceKind, FaceStyle } from "@/lib/faces/types";
import { s } from "@/lib/i18n/strings";

const t = s.faces.card.describe;
const DRAWN_STYLES: FaceStyle[] = ["flat", "3d_cartoon", "line_art"];

type Field = "name" | "description" | "style" | "neverSay";
const FIELD_OF: Record<string, Field> = { bad_name: "name", blocked_name: "name", real_person: "description", bad_description: "description", bad_style: "style", bad_settings: "neverSay" };

/**
 * Step 2 of the Face card: name, a short description and a style (a drawn character or a realistic AI person; your own
 * face needs only a name), and phrases it must never say. The service checks it on the server and the reasons for a
 * refusal (a real or famous person, a blocked name) are shown next to the field. Saving makes a draft face and costs nothing.
 */
export function FaceDescribe({ kind, onDone }: { kind: Exclude<FaceKind, "mascot">; onDone: () => void | Promise<void> }) {
  const id = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState<FaceStyle>("flat");
  const [neverSay, setNeverSay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: Field | null; message: string } | null>(null);
  const described = kind === "illustrated" || kind === "photoreal";

  async function save() {
    setBusy(true);
    setError(null);
    const r = await createFaceAction({
      kind,
      name,
      ...(described ? { description } : {}),
      ...(kind === "illustrated" ? { style } : {}),
      neverSay: neverSay.split("\n").map((l) => l.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!r.ok) {
      setError({ field: FIELD_OF[r.code] ?? null, message: r.message });
      return;
    }
    await onDone();
  }

  const fieldError = (f: Field) =>
    error?.field === f ? (
      <p id={`${id}-${f}-err`} role="alert" className={errorClass}>
        {error.message}
      </p>
    ) : null;
  const describedBy = (f: Field) => (error?.field === f ? `${id}-${f}-err` : undefined);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 className="text-card-title text-title">{t.title}</h3>
      <div>
        <label htmlFor={`${id}-name`} className={labelClass}>
          {t.nameLabel}
        </label>
        <p className={hintClass}>{t.nameHint}</p>
        <input id={`${id}-name`} className={inputClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-invalid={error?.field === "name"} aria-describedby={describedBy("name")} />
        {fieldError("name")}
      </div>
      {described && (
        <div>
          <label htmlFor={`${id}-description`} className={labelClass}>
            {t.descriptionLabel}
          </label>
          <p className={hintClass}>{t.descriptionHint}</p>
          <textarea
            id={`${id}-description`}
            className={`${inputClass} min-h-24`}
            value={description}
            maxLength={600}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={error?.field === "description"}
            aria-describedby={describedBy("description")}
          />
          {fieldError("description")}
        </div>
      )}
      {kind === "illustrated" && (
        <div>
          <label htmlFor={`${id}-style`} className={labelClass}>
            {t.styleLabel}
          </label>
          <select id={`${id}-style`} className={inputClass} value={style} onChange={(e) => setStyle(e.target.value as FaceStyle)}>
            {DRAWN_STYLES.map((st) => (
              <option key={st} value={st}>
                {t.styles[st as "flat" | "3d_cartoon" | "line_art"]}
              </option>
            ))}
          </select>
          {fieldError("style")}
        </div>
      )}
      <div>
        <label htmlFor={`${id}-never`} className={labelClass}>
          {t.neverSayLabel}
        </label>
        <p className={hintClass}>{t.neverSayHint}</p>
        <textarea id={`${id}-never`} className={`${inputClass} min-h-16`} value={neverSay} onChange={(e) => setNeverSay(e.target.value)} aria-describedby={describedBy("neverSay")} />
        {fieldError("neverSay")}
      </div>
      {error && error.field === null && (
        <p role="alert" className={errorClass}>
          {error.message}
        </p>
      )}
      <button type="submit" className={primaryButton} disabled={busy}>
        {busy ? t.saving : t.save}
      </button>
    </form>
  );
}
