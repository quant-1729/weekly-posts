"use client";

import { useState, useTransition } from "react";
import { addCompetitorAction, deleteCompetitorAction, saveResearchSettingsAction, updateCompetitorAction } from "@/app/(app)/brand/competitors-actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { MAX_COMPETITORS, type Competitor } from "@/lib/ideas/types";

const t = s.ideas.competitors;
const r = s.ideas.research;

type Field = "name" | "website" | "instagram" | "youtube";
interface Draft {
  name: string;
  website: string;
  instagram: string;
  youtube: string;
}
const EMPTY: Draft = { name: "", website: "", instagram: "", youtube: "" };

/**
 * The "Competitors" card on the Brand page (R-1): up to five competitors (name, website, Instagram, YouTube), plus
 * the owner's optional one-line research focus and the weekly research switch. Businesses only.
 */
export function CompetitorsCard({ brandId, items, focus, researchOn }: { brandId: string; items: Competitor[]; focus: string; researchOn: boolean }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [focusText, setFocusText] = useState(focus);
  const [on, setOn] = useState(researchOn);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, startSettings] = useTransition();

  const full = items.length >= MAX_COMPETITORS && editing === null;

  function set(field: Field, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function reset() {
    setDraft(EMPTY);
    setEditing(null);
    setErrors({});
    setError(null);
  }

  function edit(c: Competitor) {
    setEditing(c.id);
    setDraft({ name: c.name, website: c.website ?? "", instagram: c.instagramHandle ? `@${c.instagramHandle}` : "", youtube: c.youtubeHandle ?? "" });
    setErrors({});
    setError(null);
  }

  function submit() {
    setError(null);
    if (draft.name.trim() === "") {
      setErrors({ name: t.errors.name });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = editing ? await updateCompetitorAction(brandId, editing, draft) : await addCompetitorAction(brandId, draft);
      if (!res.ok) {
        if (res.field) setErrors({ [res.field]: res.message });
        else setError(res.message);
        return;
      }
      reset();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteCompetitorAction(brandId, id);
      if (!res.ok) setError(res.message);
      else if (editing === id) reset();
    });
  }

  function saveSettings() {
    setSaved(false);
    setSettingsError(null);
    startSettings(async () => {
      const res = await saveResearchSettingsAction(brandId, focusText, on);
      if (res.ok) setSaved(true);
      else setSettingsError(res.message);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-[14px] leading-5 text-desc">{fill(t.intro, { max: MAX_COMPETITORS })}</p>

        {items.length === 0 ? (
          <p className="text-[14px] leading-5 text-desc">{t.empty}</p>
        ) : (
          <>
            <p className="text-sm text-stone-500">{fill(t.count, { n: items.length, max: MAX_COMPETITORS })}</p>
            <ul className="space-y-2">
              {items.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 rounded-xl border border-stone-300 p-3">
                  <span className="min-w-0">
                    <span className="block font-medium">{c.name}</span>
                    {c.website && <span className="block break-all text-sm text-stone-600">{c.website}</span>}
                    {c.instagramHandle && <span className="block text-sm text-stone-600">{`Instagram @${c.instagramHandle}`}</span>}
                    {c.youtubeHandle && <span className="block text-sm text-stone-600">YouTube {c.youtubeHandle}</span>}
                  </span>
                  <span className="flex shrink-0 gap-3">
                    <button type="button" className="min-h-10 text-sm underline" disabled={pending} onClick={() => edit(c)}>
                      {t.edit}
                    </button>
                    <button type="button" className="min-h-10 text-sm text-red-700 underline" disabled={pending} onClick={() => remove(c.id)}>
                      {pending ? t.removing : t.remove}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {full ? (
          <p className="text-[14px] leading-5 text-desc">{fill(t.full, { max: MAX_COMPETITORS })}</p>
        ) : (
          <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-3">
            <div>
              <label htmlFor="comp-name" className={labelClass}>
                {t.nameLabel}
              </label>
              <input id="comp-name" className={inputClass} value={draft.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
              {errors.name && (
                <p role="alert" className={errorClass}>
                  {errors.name}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="comp-site" className={labelClass}>
                {t.websiteLabel}
              </label>
              <p className={hintClass}>{t.websiteHint}</p>
              <input id="comp-site" className={inputClass} value={draft.website} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={300} onChange={(e) => set("website", e.target.value)} />
              {errors.website && (
                <p role="alert" className={errorClass}>
                  {errors.website}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="comp-ig" className={labelClass}>
                {t.instagramLabel}
              </label>
              <p className={hintClass}>{t.instagramHint}</p>
              <input id="comp-ig" className={inputClass} value={draft.instagram} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={300} onChange={(e) => set("instagram", e.target.value)} />
              {errors.instagram && (
                <p role="alert" className={errorClass}>
                  {errors.instagram}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="comp-yt" className={labelClass}>
                {t.youtubeLabel}
              </label>
              <p className={hintClass}>{t.youtubeHint}</p>
              <input id="comp-yt" className={inputClass} value={draft.youtube} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={300} onChange={(e) => set("youtube", e.target.value)} />
              {errors.youtube && (
                <p role="alert" className={errorClass}>
                  {errors.youtube}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={items.length > 0 ? secondaryButton : primaryButton} disabled={pending} onClick={submit}>
                {editing ? (pending ? t.saving : t.save) : pending ? t.adding : t.add}
              </button>
              {editing && (
                <button type="button" className={secondaryButton} disabled={pending} onClick={reset}>
                  {t.cancel}
                </button>
              )}
            </div>
            {error && (
              <p role="alert" className={errorClass}>
                {error}
              </p>
            )}
          </div>
        )}
        {full && error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}
      </div>

      <div className="space-y-3 border-t border-stone-200 pt-4">
        <h3 className="font-medium">{r.title}</h3>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span>
            <span className="block font-medium">{r.onLabel}</span>
            <span className="block text-sm text-stone-600">{r.onHint}</span>
          </span>
        </label>
        <div>
          <label htmlFor="research-focus" className={labelClass}>
            {r.focusLabel}
          </label>
          <p className={hintClass}>{r.focusHint}</p>
          <input id="research-focus" className={inputClass} value={focusText} maxLength={200} placeholder={r.focusPlaceholder} onChange={(e) => setFocusText(e.target.value)} />
        </div>
        <button type="button" className={secondaryButton} disabled={savingSettings} onClick={saveSettings}>
          {savingSettings ? r.saving : r.save}
        </button>
        {saved && (
          <p role="status" className="text-sm text-green-800">
            {r.saved}
          </p>
        )}
        {settingsError && (
          <p role="alert" className={errorClass}>
            {settingsError}
          </p>
        )}
      </div>
    </div>
  );
}
