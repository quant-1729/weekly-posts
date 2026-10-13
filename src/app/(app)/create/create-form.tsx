"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { chipClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { VoiceRecorder } from "@/components/voice-recorder";
import { downscalePhoto } from "@/lib/image/downscale";
import { s } from "@/lib/i18n/strings";
import type { Stage } from "@/lib/posts/generate";
import type { StreamEvent } from "@/lib/posts/stream";

/**
 * The create screen (R4): one input (photo, typed text or voice note), one
 * "Make my posts" button. Photos are downscaled here (2048 px, JPEG 0.85) before
 * upload. Progress comes from the server's stage events, then we open /review/{id}.
 */

type Mode = "photo" | "text" | "voice";
type DoneEvent = Extract<StreamEvent, { event: "done" }>;

const STAGES: { id: Stage; label: string }[] = [
  { id: "understanding", label: s.create.stageUnderstanding },
  { id: "writing", label: s.create.stageWriting },
  { id: "designing", label: s.create.stageDesigning },
];

interface Problem {
  title?: string;
  message: string;
}

/** An earlier post's input, from History's "Use again" (?from={postId}). */
export interface ReuseInput {
  postId: string;
  text: string;
  /** Same-origin URL of the earlier post's photo, for photo posts. */
  photoUrl: string | null;
}

export function CreateForm({ reuse = null }: { reuse?: ReuseInput | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(reuse && !reuse.photoUrl ? "text" : "photo");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [fetchingOldPhoto, setFetchingOldPhoto] = useState(false);
  const [caption, setCaption] = useState(reuse?.photoUrl ? reuse.text : "");
  const [text, setText] = useState(reuse && !reuse.photoUrl ? reuse.text : "");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("understanding");
  const [problem, setProblem] = useState<Problem | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const url = photo?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo?.url]);

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setPreparing(true);
    try {
      const blob = await downscalePhoto(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setPhoto(null);
      setProblem({ message: s.create.errors.invalidPhoto });
    } finally {
      setPreparing(false);
    }
  }

  /** "Use this photo": fetch the earlier post's photo from storage and use it as the photo input. */
  async function loadOldPhoto() {
    if (!reuse?.photoUrl) return;
    setProblem(null);
    setFetchingOldPhoto(true);
    try {
      const res = await fetch(reuse.photoUrl);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setProblem({ message: s.history.reuse.photoFailed });
    } finally {
      setFetchingOldPhoto(false);
    }
  }

  async function submit(form: FormData) {
    setBusy(true);
    setProblem(null);
    setStage("understanding");
    try {
      const res = await fetch("/api/posts/generate", { method: "POST", body: form });
      if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setProblem({ message: data?.message ?? s.errors.generic });
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let outcome: DoneEvent | null = null;
      const handle = (line: string) => {
        if (!line.trim()) return;
        const ev = JSON.parse(line) as StreamEvent;
        if (ev.event === "stage") setStage(ev.stage);
        else outcome = ev;
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handle);
        }
        if (done) break;
      }
      handle(buffer);

      const result = outcome as DoneEvent | null;
      if (result?.ok) {
        router.push(`/review/${result.postId}`);
        return; // keep the progress panel up while the next page loads
      }
      setProblem({
        title: result && !result.ok && result.code === "needs_input" ? s.create.needsInputTitle : undefined,
        message: result && !result.ok ? result.message : s.errors.generic,
      });
    } catch {
      setProblem({ message: s.errors.generic });
    }
    setBusy(false);
  }

  function makeFromPhoto() {
    if (!photo) return setProblem({ message: s.create.needPhoto });
    const form = new FormData();
    form.set("type", "photo");
    form.set("photo", photo.blob, "photo.jpg");
    form.set("caption", caption);
    void submit(form);
  }

  function makeFromText() {
    if (!text.trim()) return setProblem({ message: s.create.needText });
    const form = new FormData();
    form.set("type", "text");
    form.set("text", text);
    void submit(form);
  }

  function makeFromVoice(blob: Blob) {
    const form = new FormData();
    form.set("type", "voice");
    form.set("audio", blob, "voice.wav");
    void submit(form);
  }

  if (busy) {
    const current = STAGES.findIndex((x) => x.id === stage);
    return (
      <div role="status" aria-live="polite" className="space-y-4 rounded-xl bg-stone-50 p-6">
        <p className="text-lg font-semibold">{s.create.working}</p>
        <ol className="space-y-2">
          {STAGES.map((x, i) => (
            <li
              key={x.id}
              className={`flex items-center gap-3 text-base ${
                i < current ? "text-stone-500" : i === current ? "font-semibold text-[#B93A15]" : "text-stone-400"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-3 w-3 rounded-full ${
                  i < current ? "bg-stone-400" : i === current ? "animate-pulse bg-[#E4572E]" : "bg-stone-300"
                }`}
              />
              {x.label}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={s.create.title} className="flex gap-2">
        {(
          [
            ["photo", s.create.tabPhoto],
            ["text", s.create.tabText],
            ["voice", s.create.tabVoice],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => {
              setMode(id);
              setProblem(null);
            }}
            className={`${chipClass(mode === id)} flex-1`}
          >
            {label}
          </button>
        ))}
      </div>

      {problem && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          {problem.title && <p className="font-semibold">{problem.title}</p>}
          <p className="text-sm">{problem.message}</p>
        </div>
      )}

      {mode === "photo" && (
        <div className="space-y-4">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void onPickPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void onPickPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {preparing && (
            <p role="status" className="rounded-xl bg-stone-50 p-6 text-center text-stone-700">
              {s.create.preparingPhoto}
            </p>
          )}
          {!preparing && photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt={s.create.photoAlt} className="max-h-72 w-full rounded-xl bg-stone-100 object-contain" />
          )}
          {!preparing && !photo && reuse?.photoUrl && (
            <div className="space-y-2 rounded-xl bg-stone-50 p-3">
              <p className="text-sm font-medium text-stone-700">{s.history.reuse.photoTitle}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={reuse.photoUrl} alt={s.history.reuse.photoTitle} className="h-28 w-28 rounded-lg bg-stone-100 object-cover" />
              <button type="button" className={secondaryButton} disabled={fetchingOldPhoto} onClick={() => void loadOldPhoto()}>
                {fetchingOldPhoto ? s.history.reuse.loadingPhoto : s.history.reuse.usePhoto}
              </button>
            </div>
          )}
          {!preparing && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={secondaryButton} onClick={() => cameraRef.current?.click()}>
                {photo ? s.create.changePhoto : s.create.takePhoto}
              </button>
              <button type="button" className={secondaryButton} onClick={() => galleryRef.current?.click()}>
                {s.create.choosePhoto}
              </button>
            </div>
          )}
          <div>
            <label htmlFor="caption" className={labelClass}>
              {s.create.captionLabel}
            </label>
            <p className={hintClass}>{s.create.captionHint}</p>
            <textarea
              id="caption"
              rows={3}
              maxLength={1000}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={s.create.captionPlaceholder}
              className={inputClass}
            />
          </div>
          <button type="button" className={primaryButton} disabled={!photo || preparing} onClick={makeFromPhoto}>
            {s.create.makePosts}
          </button>
        </div>
      )}

      {mode === "text" && (
        <div className="space-y-4">
          <div>
            <label htmlFor="post-text" className={labelClass}>
              {s.create.textLabel}
            </label>
            <p className={hintClass}>{s.create.textHint}</p>
            <textarea
              id="post-text"
              rows={6}
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={s.create.textPlaceholder}
              className={inputClass}
            />
          </div>
          <button type="button" className={primaryButton} disabled={!text.trim()} onClick={makeFromText}>
            {s.create.makePosts}
          </button>
        </div>
      )}

      {mode === "voice" && <VoiceRecorder onUse={(blob) => makeFromVoice(blob)} useLabel={s.create.makePosts} />}
    </div>
  );
}
