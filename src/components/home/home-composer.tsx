"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { stashDescription } from "@/components/create/handoff";
import { ListeningOverlay, MicIcon, RecordingBar, SendIcon, micButtonClass } from "@/components/create/mic-ui";
import { transcribeVoice } from "@/components/create/transcribe";
import { errorClass } from "@/components/ui";
import { useWavCapture } from "@/components/use-wav-capture";
import { s } from "@/lib/i18n/strings";

const t = s.home;
const MAX_CHARS = 2000;

/**
 * The one box on Home: describe the post you want, by typing or with the microphone (the same recording and
 * transcription as the Details step). Sending hands the words to "Create a post" through sessionStorage (not the URL);
 * the Details step fills its description from them once. The send button stays off until there is text.
 */
export function HomeComposer({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  });
  const refocus = useRef(false);

  async function transcribe(wav: Blob) {
    setListening(true);
    setError(null);
    const r = await transcribeVoice(brandId, wav);
    setListening(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    const cur = textRef.current.trimEnd();
    setText((cur ? `${cur} ${r.transcript.trim()}` : r.transcript.trim()).slice(0, MAX_CHARS));
    refocus.current = true;
  }

  const capture = useWavCapture((wav) => void transcribe(wav));
  const micBusy = capture.recording || listening;

  useEffect(() => {
    if (!listening && !capture.recording && refocus.current && area.current) {
      refocus.current = false;
      area.current.focus();
      const end = area.current.value.length;
      area.current.setSelectionRange(end, end);
    }
  });

  const ready = text.trim().length > 0 && !micBusy;

  function send() {
    if (!ready) return;
    stashDescription(text.trim());
    router.push("/create");
  }

  const errorLine = capture.error ?? error;
  return (
    <div>
      <form
        className="relative mt-2.5 rounded-3xl border border-line-input bg-white shadow-composer transition hover:border-line-input-hover focus-within:border-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="home-describe" className="sr-only">
          {t.composerLabel}
        </label>
        <textarea
          id="home-describe"
          ref={area}
          rows={3}
          maxLength={MAX_CHARS}
          value={text}
          placeholder={t.placeholder}
          inert={micBusy || undefined}
          data-own-ring
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="block min-h-30 w-full resize-none rounded-3xl bg-transparent px-5 pb-16 pt-5 text-base leading-6 text-ink outline-none placeholder:text-helper"
        />
        {!micBusy && (
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <button type="button" data-mic aria-label={s.create.describe.micAria} title={s.create.describe.micAria} className={micButtonClass} onClick={() => void capture.start()}>
              <MicIcon />
            </button>
            <button
              type="submit"
              data-send
              aria-label={t.send}
              title={t.send}
              disabled={!ready}
              className="inline-grid h-9 w-9 place-items-center rounded-full bg-ink text-white transition hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-faint max-md:h-11 max-md:w-11"
            >
              <SendIcon />
            </button>
          </div>
        )}
        {capture.recording && <RecordingBar className="absolute inset-x-3 bottom-3" levels={capture.levels} elapsed={capture.elapsed} onCancel={capture.cancel} onDone={capture.finish} />}
        {listening && <ListeningOverlay className="absolute inset-x-3 bottom-3 h-12" />}
      </form>
      {errorLine && (
        <p role="alert" data-mic-error className={errorClass}>
          {errorLine}
        </p>
      )}
      <p className="mt-3 text-[13px] leading-[18px] text-desc">
        {t.forExample}{" "}
        {t.examples.map((ex, i) => (
          <span key={ex.label}>
            {i > 0 && <span aria-hidden="true"> · </span>}
            <button
              type="button"
              data-example={i}
              className="inline text-left underline underline-offset-[3px] hover:text-title max-md:min-h-11"
              onClick={() => {
                setText(ex.text);
                area.current?.focus();
              }}
            >
              {ex.label}
            </button>
          </span>
        ))}
      </p>
    </div>
  );
}
