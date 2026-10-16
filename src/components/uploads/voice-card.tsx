"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { errorClass, inputClass, secondaryButton } from "@/components/ui";
import { MAX_EXAMPLE_PHRASES, MAX_AVOID_WORDS } from "@/lib/uploads/limits";
import { s } from "@/lib/i18n/strings";
import type { VoiceView } from "@/lib/uploads/voice";
import { addWordToAvoidAction, dismissAvoidSuggestionAction, refreshVoiceNowAction, updateVoiceAction } from "./actions";

const chip = "inline-flex min-h-9 items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-sm";

/** What we learned about how the owner writes. The owner can read it, fix it, and pick words to avoid. */
export function VoiceCard({ brandId, voice, hasPastPosts }: { brandId: string; voice: VoiceView; hasPastPosts: boolean }) {
  const t = s.uploads.voice;
  const router = useRouter();
  const [description, setDescription] = useState(voice.voiceDescription ?? "");
  const [newPhrase, setNewPhrase] = useState("");
  const [newWord, setNewWord] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A new read changes the saved description under us: take it in (set state during render, not in an effect).
  const [seenDescription, setSeenDescription] = useState(voice.voiceDescription);
  if (seenDescription !== voice.voiceDescription) {
    setSeenDescription(voice.voiceDescription);
    setDescription(voice.voiceDescription ?? "");
  }

  // The read runs in the background after an upload; look again until it is done.
  useEffect(() => {
    if (!voice.refreshing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [voice.refreshing, router]);

  const have = new Set(voice.wordsToAvoid.map((w) => w.toLowerCase()));
  // The suggestions are saved on the brand (avoid_suggestions), so the server's list is the whole story.
  const suggestions = voice.avoidSuggestions.filter((w) => !have.has(w.toLowerCase()));

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.message ?? t.saveFailed);
      after?.();
      router.refresh();
    });
  }

  const saveDescription = () => run(() => updateVoiceAction(brandId, { voiceDescription: description }), () => setNote(t.saved));
  const removePhrase = (p: string) => run(() => updateVoiceAction(brandId, { examplePhrases: voice.examplePhrases.filter((x) => x !== p) }));
  const removeAvoid = (w: string) => run(() => updateVoiceAction(brandId, { wordsToAvoid: voice.wordsToAvoid.filter((x) => x !== w) }));
  const addAvoid = (w: string) => run(() => addWordToAvoidAction(brandId, w));
  const dismissAvoid = (w: string) => run(() => dismissAvoidSuggestionAction(brandId, w));
  const refreshNow = () => run(() => refreshVoiceNowAction(brandId));
  const addPhrase = () => {
    const p = newPhrase.trim();
    if (!p) return;
    run(() => updateVoiceAction(brandId, { examplePhrases: [...voice.examplePhrases, p] }), () => setNewPhrase(""));
  };
  const addWord = () => {
    const w = newWord.trim();
    if (!w) return;
    run(() => addWordToAvoidAction(brandId, w), () => setNewWord(""));
  };
  const b = s.brandV2.voice;

  return (
    <div className="space-y-3">
      <h3 className="text-card-title text-title">{t.title}</h3>

      {voice.refreshing && <p className="text-sm text-stone-600">{t.updating}</p>}
      {!voice.voiceDescription && !voice.refreshing && !hasPastPosts && <p className="text-[14px] leading-5 text-desc">{t.empty}</p>}

      <div>
        <label htmlFor="voice-description" className="mb-1 block font-medium">
          {t.descriptionLabel}
        </label>
        <textarea
          id="voice-description"
          className={inputClass}
          rows={4}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          type="button"
          className="mt-1 min-h-10 text-sm underline"
          disabled={pending || description === (voice.voiceDescription ?? "")}
          onClick={saveDescription}
        >
          {t.save}
        </button>
        {note && <span className="ml-2 text-sm text-emerald-800">{note}</span>}
      </div>

      <div>
        <p className="mb-1 font-medium">{t.phrasesLabel}</p>
        {voice.examplePhrases.length === 0 ? (
          <p className="text-sm text-stone-600">{t.noPhrases}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {voice.examplePhrases.map((p) => (
              <li key={p} className={chip}>
                {p}
                <button type="button" className="px-1 text-stone-500" aria-label={`${t.removeItem}: ${p}`} onClick={() => removePhrase(p)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {voice.examplePhrases.length < MAX_EXAMPLE_PHRASES && (
          <div className="mt-2 flex gap-2">
            <input
              className={inputClass}
              aria-label={b.addPhraseLabel}
              placeholder={b.addPhrasePlaceholder}
              maxLength={200}
              value={newPhrase}
              onChange={(e) => setNewPhrase(e.target.value)}
            />
            <button type="button" className="min-h-12 shrink-0 rounded-lg border border-stone-300 px-3" disabled={pending || !newPhrase.trim()} onClick={addPhrase}>
              {b.add}
            </button>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 font-medium">{t.avoidLabel}</p>
        {voice.wordsToAvoid.length === 0 ? (
          <p className="text-sm text-stone-600">{t.noAvoid}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {voice.wordsToAvoid.map((w) => (
              <li key={w} className={chip}>
                {w}
                <button type="button" className="px-1 text-stone-500" aria-label={`${t.removeItem}: ${w}`} onClick={() => removeAvoid(w)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {voice.wordsToAvoid.length < MAX_AVOID_WORDS && (
          <div className="mt-2 flex gap-2">
            <input
              className={inputClass}
              aria-label={b.addWordLabel}
              placeholder={b.addWordPlaceholder}
              maxLength={60}
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
            />
            <button type="button" className="min-h-12 shrink-0 rounded-lg border border-stone-300 px-3" disabled={pending || !newWord.trim()} onClick={addWord}>
              {b.add}
            </button>
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div>
          <p className="mb-1 font-medium">{t.suggestionsLabel}</p>
          <ul className="space-y-1">
            {suggestions.map((w) => (
              <li key={w} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm">
                <span>{w}</span>
                <span className="flex shrink-0 gap-3">
                  <button type="button" className="min-h-10 text-coral-dark underline" disabled={pending} onClick={() => addAvoid(w)}>
                    {t.addToAvoid}
                  </button>
                  <button type="button" className="min-h-10 text-stone-600 underline" disabled={pending} onClick={() => dismissAvoid(w)}>
                    {b.dismiss}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasPastPosts && (
        <button type="button" className={secondaryButton} disabled={pending || voice.refreshing} onClick={refreshNow}>
          {pending ? t.refreshing : t.refresh}
        </button>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
