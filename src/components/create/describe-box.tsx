"use client";

import { useState, useTransition } from "react";
import { describePostAction } from "@/app/(app)/create/actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { VoiceRecorder } from "@/components/voice-recorder";
import type { BriefFromTextResult } from "@/lib/briefs/from-text";
import { s } from "@/lib/i18n/strings";
import { EditorCard } from "./card";
import { transcribeVoice } from "./transcribe";

const t = s.create.describe;

/**
 * "Describe your post" (B-7): a text box and a microphone. Words go to the server, which asks the
 * model and checks the answer; the editor then fills the fields it could ground and the owner
 * checks each one. A recording is transcribed first, then goes through the same call.
 */
export function DescribeBox({
  brandId,
  onResult,
  questions,
}: {
  brandId: string;
  onResult: (r: BriefFromTextResult) => void;
  /** The model's open questions from the last run (one line each). */
  questions: string[];
}) {
  const [text, setText] = useState("");
  const [mic, setMic] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(words: string) {
    const trimmed = words.trim();
    if (!trimmed) {
      setMessage({ error: true, text: t.empty });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const r = await describePostAction(brandId, trimmed);
      if (!r.ok) {
        setMessage({ error: true, text: r.message });
        return;
      }
      onResult(r.result);
      setMessage({ error: false, text: r.result.filled.length > 1 ? t.done : t.nothingNew });
    });
  }

  async function onVoice(wav: Blob) {
    setListening(true);
    setMessage(null);
    const r = await transcribeVoice(brandId, wav);
    setListening(false);
    if (!r.ok) {
      setMessage({ error: true, text: r.message });
      return;
    }
    setText(r.transcript);
    setMic(false);
    run(r.transcript);
  }

  const busy = pending || listening;
  return (
    <EditorCard id="describe" title={t.title} hint={t.hint}>
      <div>
        <label htmlFor="describe-text" className={labelClass}>
          {t.label}
        </label>
        <textarea
          id="describe-text"
          className={`${inputClass} min-h-28`}
          rows={4}
          maxLength={2000}
          value={text}
          placeholder={t.placeholder}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className={primaryButton} disabled={busy} onClick={() => run(text)}>
          {pending ? t.working : t.button}
        </button>
        <button type="button" className={secondaryButton} disabled={busy} aria-expanded={mic} onClick={() => setMic((v) => !v)}>
          {mic ? t.micClose : t.mic}
        </button>
      </div>
      <p data-voice-hint className={hintClass}>
        {t.voiceHint}
      </p>
      {mic && (listening ? <p role="status" className="rounded-xl bg-stone-50 p-4 text-center text-stone-700">{t.transcribing}</p> : <VoiceRecorder onUse={(wav) => void onVoice(wav)} useLabel={t.useVoice} busy={busy} />)}
      {message && (
        <p role={message.error ? "alert" : "status"} className={message.error ? errorClass : hintClass}>
          {message.text}
        </p>
      )}
      {questions.length > 0 && (
        <div data-describe-questions className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="font-medium text-amber-950">{t.questionsTitle}</p>
          <ul className="list-disc space-y-1 pl-5 text-amber-950">
            {questions.map((q) => (
              <li key={q} className="break-words">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </EditorCard>
  );
}
