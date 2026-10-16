"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_SECONDS, WAV_SAMPLE_RATE, chunksToWav16k } from "@/lib/audio/wav";
import { s } from "@/lib/i18n/strings";
import { primaryButton, secondaryButton } from "./ui";

/**
 * Records a voice note in the browser as WAV, 16 kHz mono, 16-bit.
 *
 * Gemini does not accept the webm that MediaRecorder produces, so this
 * captures raw PCM with Web Audio and writes the WAV header itself
 * (src/lib/audio/wav.ts). ScriptProcessorNode is deprecated but works in every
 * mobile browser without a separate worklet file.
 *
 * Stops by itself at 2 minutes. Shows a timer, a preview, and "Record again".
 */

type Phase = "idle" | "recording" | "recorded";

type AudioContextCtor = typeof AudioContext;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const MIN_SECONDS = 1;

export function VoiceRecorder({
  onUse,
  useLabel,
  busy = false,
}: {
  /** Called with the finished WAV when the owner taps the use button. */
  onUse: (wav: Blob, seconds: number) => void;
  useLabel: string;
  /** True while the parent is uploading the recording. */
  busy?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ blob: Blob; url: string; seconds: number } | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const samplesRef = useRef(0);
  const rateRef = useRef(WAV_SAMPLE_RATE);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const releaseAudio = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (nodeRef.current) nodeRef.current.onaudioprocess = null;
    nodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close().catch(() => {});
    nodeRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
  }, []);

  const stop = useCallback(
    (hitLimit: boolean) => {
      const rate = rateRef.current;
      const chunks = chunksRef.current;
      releaseAudio();
      chunksRef.current = [];
      const seconds = samplesRef.current / rate;
      if (seconds < MIN_SECONDS) {
        setNote(s.voice.tooShort);
        setPhase("idle");
        setElapsed(0);
        return;
      }
      const wav = chunksToWav16k(chunks, rate);
      const blob = new Blob([wav as BlobPart], { type: "audio/wav" });
      setRecorded({ blob, url: URL.createObjectURL(blob), seconds });
      setElapsed(seconds);
      setNote(hitLimit ? s.voice.limitReached : null);
      setPhase("recorded");
    },
    [releaseAudio],
  );

  async function start() {
    setNote(null);
    const Ctx: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !Ctx) {
      setNote(s.voice.micUnavailable);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setNote(s.voice.micDenied);
      return;
    }
    const ctx = new Ctx();
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    chunksRef.current = [];
    samplesRef.current = 0;
    rateRef.current = ctx.sampleRate;
    node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      chunksRef.current.push(new Float32Array(data)); // copy: the browser reuses the buffer
      samplesRef.current += data.length;
    };
    source.connect(node);
    node.connect(ctx.destination); // silent: nothing is written to the output buffer
    streamRef.current = stream;
    ctxRef.current = ctx;
    sourceRef.current = source;
    nodeRef.current = node;

    setRecorded(null);
    setElapsed(0);
    setPhase("recording");
    tickRef.current = setInterval(() => {
      const seconds = samplesRef.current / rateRef.current;
      setElapsed(seconds);
      if (seconds >= MAX_RECORDING_SECONDS) stop(true);
    }, 250);
  }

  function recordAgain() {
    if (recorded) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setElapsed(0);
    setNote(null);
    setPhase("idle");
  }

  // Release the microphone and preview URL if the screen goes away.
  useEffect(() => releaseAudio, [releaseAudio]);
  useEffect(() => {
    const url = recorded?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [recorded?.url]);

  return (
    <div className="space-y-3">
      {phase === "idle" && (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-coral bg-coral-50 px-4 py-6 text-coral-dark disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          <span className="text-card-title text-title">{s.voice.tapToRecord}</span>
          <span className="text-sm text-stone-600">{s.voice.maxLabel}</span>
        </button>
      )}

      {phase === "recording" && (
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-center">
          <p className="flex items-center justify-center gap-2 text-red-700" role="status">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
            {s.voice.recording}
          </p>
          <p className="text-3xl font-medium tabular-nums" aria-live="off">
            {formatTime(elapsed)} <span className="text-base font-normal text-stone-500">/ {formatTime(MAX_RECORDING_SECONDS)}</span>
          </p>
          <button type="button" onClick={() => stop(false)} className={primaryButton}>
            {s.voice.stop}
          </button>
        </div>
      )}

      {phase === "recorded" && recorded && (
        <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <p className="text-center font-medium">
            {s.voice.ready} ({formatTime(recorded.seconds)})
          </p>
          <audio controls src={recorded.url} className="w-full" />
          <button type="button" onClick={() => onUse(recorded.blob, recorded.seconds)} disabled={busy} className={primaryButton}>
            {busy ? s.voice.uploading : useLabel}
          </button>
          <button type="button" onClick={recordAgain} disabled={busy} className={secondaryButton}>
            {s.voice.recordAgain}
          </button>
        </div>
      )}

      {note && (
        <p role="alert" className="text-sm text-red-700">
          {note}
        </p>
      )}
    </div>
  );
}
