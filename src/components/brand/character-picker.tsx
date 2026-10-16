"use client";

import { useEffect, useId, useRef, useState } from "react";
import { characterPosesAction, chooseMascotCharacterAction } from "@/app/(app)/brand/face-actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton } from "@/components/ui";
import { CHARACTER_LABELS, type CharacterId } from "@/lib/characters/types";
import type { CharacterPreview } from "@/lib/faces/character-preview";
import { fill, s } from "@/lib/i18n/strings";

const t = s.faces.card.character;

export interface PosePreview {
  action: string;
  svg: string;
}

/** What the server draws for the picker: the gallery, the saved choice and the poses of that choice. */
export interface CharacterGallery {
  items: CharacterPreview[];
  /** The saved character ('tween' until the owner picks another). */
  selected: CharacterId;
  /** The owner's own name for it, or "" when it has none. */
  name: string;
  poses: PosePreview[];
}

function cardClass(selected: boolean): string {
  return `flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-2xl border p-2 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral ${
    selected ? "border-coral bg-coral-tint ring-1 ring-coral" : "border-line-input bg-white hover:border-line-input-hover"
  }`;
}

/**
 * The character gallery of the mascot kind on the Brand Face card: a card for each character (a small drawing in the
 * brand's colours, its object name under it), an optional name of the owner's own, and four poses of the selected
 * character so the owner sees how it acts. Saving makes it the brand's mascot in posts, the same as the mascot switch.
 */
export function CharacterPicker({ gallery, inPosts = true, onSaved }: { gallery: CharacterGallery; inPosts?: boolean; onSaved?: () => void | Promise<void> }) {
  const id = useId();
  const [selected, setSelected] = useState<CharacterId>(gallery.selected);
  const [name, setName] = useState(gallery.name);
  const [poses, setPoses] = useState<PosePreview[]>(gallery.poses);
  const [on, setOn] = useState(inPosts);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const seen = useRef(new Map<CharacterId, PosePreview[]>([[gallery.selected, gallery.poses]]));
  const [saved, setSaved] = useState({ character: gallery.selected, name: gallery.name.trim() });

  async function showPoses(next: CharacterId) {
    const known = seen.current.get(next);
    if (known) {
      setPoses(known);
      return;
    }
    const r = await characterPosesAction(next);
    if (r.ok) seen.current.set(next, r.poses);
    setPoses(r.ok ? r.poses : []);
  }

  async function pick(next: CharacterId) {
    setSelected(next);
    setMessage(null);
    await showPoses(next);
  }

  // The server drew no poses for this character (the saved choice changed since the page loaded): ask for them.
  useEffect(() => {
    if (gallery.poses.length === 0) void showPoses(gallery.selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    const r = await chooseMascotCharacterAction(selected, name);
    setBusy(false);
    if (!r.ok) {
      setMessage({ ok: false, text: r.message });
      return;
    }
    setOn(true);
    setSaved({ character: selected, name: name.trim() });
    setMessage({ ok: true, text: fill(t.saved, { name: name.trim() || CHARACTER_LABELS[selected] }) });
    await onSaved?.();
  }

  const unchanged = saved.character === selected && saved.name === name.trim();
  return (
    <div className="space-y-4" data-character-picker>
      <div>
        <h3 className="text-card-title text-title">{t.title}</h3>
        <p className={hintClass}>{t.hint}</p>
      </div>

      <fieldset className="min-w-0">
        <legend className="sr-only">{t.galleryLabel}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {gallery.items.map((c) => (
            <label key={c.id} data-character={c.id} data-selected={selected === c.id ? "true" : undefined} data-preview={c.fallback ? "fallback" : "rig"} className={cardClass(selected === c.id)}>
              <input type="radio" name={`${id}-character`} className="sr-only" checked={selected === c.id} onChange={() => void pick(c.id)} />
              <span aria-hidden="true" className="block w-16 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: c.svg }} />
              <span className="block text-ui text-title">{c.label}</span>
              {selected === c.id && <span className="sr-only">{t.selected}</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${id}-name`} className={labelClass}>
          {t.nameLabel}
        </label>
        <p className={hintClass}>{fill(t.nameHint, { label: CHARACTER_LABELS[selected] })}</p>
        <input id={`${id}-name`} className={inputClass} value={name} maxLength={40} placeholder={CHARACTER_LABELS[selected]} onChange={(e) => setName(e.target.value)} />
      </div>

      {poses.length > 0 && (
        <div data-character-poses>
          <h4 className="mb-1.5 text-ui text-title">{t.posesTitle}</h4>
          <ul className="grid grid-cols-4 gap-2">
            {poses.map((p) => (
              <li key={p.action} className="flex min-w-0 flex-col items-center gap-1 rounded-xl border border-line-light bg-white p-1.5">
                <span aria-hidden="true" className="block w-12 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: p.svg }} />
                <span className="text-note text-desc">{(t.poses as Record<string, string>)[p.action] ?? p.action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <button type="button" className={primaryButton} disabled={busy || (unchanged && on)} onClick={() => void save()}>
          {busy ? t.saving : t.save}
        </button>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-[13px] leading-[18px] text-ok-tx" : errorClass}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
