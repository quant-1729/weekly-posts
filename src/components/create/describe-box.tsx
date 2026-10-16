"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { describePostAction } from "@/app/(app)/create/actions";
import { alertClass, errorClass, inputClass, labelClass, primaryButton } from "@/components/ui";
import { useWavCapture } from "@/components/use-wav-capture";
import type { BriefFromTextResult } from "@/lib/briefs/from-text";
import { s } from "@/lib/i18n/strings";
import { EditorCard } from "./card";
import { ListeningOverlay, MicIcon, RecordingBar, micButtonClass } from "./mic-ui";
import { transcribeVoice } from "./transcribe";

const t = s.create.describe;
const MAX_CHARS = 2000;

/**
 * "Create a post" (B-7): a text box with a microphone inside it, like a chat box. Words go to the
 * server, which asks the model and checks the answer; the editor then fills the fields it could
 * ground and the owner checks each one. The microphone only types: a recording is transcribed and
 * the words are put in the box. "Fill in the details" is always the owner's own click.
 */
export function DescribeBox({
  brandId,
  value,
  onChange,
  error,
  onResult,
  questions,
}: {
  brandId: string;
  /** The description, held by the editor so it is saved with the brief. */
  value: string;
  onChange: (value: string) => void;
  /** A problem with the text (for example "write a few words first"), shown under the box. */
  error?: string | null;
  onResult: (r: BriefFromTextResult) => void;
  /** The model's open questions from the last run (one line each). */
  questions: string[];
}) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });
  const refocus = useRef(false);

  /** Puts the transcript in the box (after a space when there is text already) and focuses it. */
  async function transcribe(wav: Blob) {
    setListening(true);
    setMessage(null);
    const r = await transcribeVoice(brandId, wav);
    setListening(false);
    if (!r.ok) {
      setMessage({ error: true, text: r.message });
      return;
    }
    const cur = valueRef.current.trimEnd();
    onChange((cur ? `${cur} ${r.transcript.trim()}` : r.transcript.trim()).slice(0, MAX_CHARS));
    refocus.current = true;
  }

  const capture = useWavCapture((wav) => void transcribe(wav));

  // Focus after the box is usable again (it is inert while recording or listening).
  useEffect(() => {
    if (!listening && !capture.recording && refocus.current && area.current) {
      refocus.current = false;
      area.current.focus();
      const end = area.current.value.length;
      area.current.setSelectionRange(end, end);
    }
  });

  function run() {
    const trimmed = value.trim();
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

  const micBusy = capture.recording || listening;
  const errorLine = capture.error ?? (message?.error ? message.text : null);
  return (
    <EditorCard id="describe" title={t.title} hideTitle>
      <p className={`${labelClass} !mb-0`}>{t.hint}</p>
      <div className="relative">
        <textarea
          id="describe-text"
          ref={area}
          aria-label={t.textLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "describe-error" : undefined}
          className={`${inputClass} min-h-28 resize-y pb-14 leading-[22px]`}
          rows={4}
          maxLength={MAX_CHARS}
          value={value}
          placeholder={t.placeholder}
          inert={micBusy || undefined}
          onChange={(e) => onChange(e.target.value)}
        />

        {!micBusy && (
          <button type="button" data-mic aria-label={t.micAria} title={t.micAria} className={`${micButtonClass} absolute bottom-2.5 right-2.5`} onClick={() => void capture.start()}>
            <MicIcon />
          </button>
        )}

        {capture.recording && <RecordingBar levels={capture.levels} elapsed={capture.elapsed} onCancel={capture.cancel} onDone={capture.finish} />}

        {listening && <ListeningOverlay />}
      </div>

      {error && (
        <p id="describe-error" role="alert" data-describe-error className={errorClass}>
          {error}
        </p>
      )}
      {errorLine && (
        <p role="alert" data-mic-error className={errorClass}>
          {errorLine}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primaryButton} disabled={pending || micBusy} onClick={run}>
          {pending ? t.working : t.button}
        </button>
        {message && !message.error && (
          <p role="status" className="text-[13px] font-medium leading-[18px] text-ok-tx">
            {message.text}
          </p>
        )}
      </div>
      {questions.length > 0 && (
        <div data-describe-questions className={`space-y-1 ${alertClass("warn")}`}>
          <p className="font-medium text-warn-tx">{t.questionsTitle}</p>
          <ul className="list-disc space-y-1 pl-5">
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
