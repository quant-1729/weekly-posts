"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_SECONDS, WAV_SAMPLE_RATE, chunksToWav16k } from "@/lib/audio/wav";
import { s } from "@/lib/i18n/strings";

/**
 * Microphone capture as a hook, for a recorder that has its own look (the chat-style microphone in
 * "Create a post"). Same approach as `VoiceRecorder`: raw PCM from Web Audio, written as WAV, 16 kHz
 * mono, 16-bit (src/lib/audio/wav.ts), because Gemini does not accept MediaRecorder's webm.
 *
 * `start()` asks for the microphone and begins at once. `finish()` hands the WAV to `onFinish`;
 * `cancel()` throws the recording away. It stops by itself at 2 minutes (and still hands the WAV
 * over). Anything that goes wrong becomes one short line in `error`.
 */

export const WAVE_BARS = 24;
const MIN_SECONDS = 1;
const TICK_MS = 100;

type AudioContextCtor = typeof AudioContext;

export function useWavCapture(onFinish: (wav: Blob, seconds: number) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(WAVE_BARS).fill(0));
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const samplesRef = useRef(0);
  const rateRef = useRef(WAV_SAMPLE_RATE);
  const levelRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false);
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  const release = useCallback(() => {
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

  const finish = useCallback(
    (hitLimit = false) => {
      if (!ctxRef.current) return;
      const rate = rateRef.current;
      const chunks = chunksRef.current;
      release();
      chunksRef.current = [];
      setRecording(false);
      setElapsed(0);
      const seconds = samplesRef.current / rate;
      if (seconds < MIN_SECONDS) {
        setError(s.voice.tooShort);
        return;
      }
      setError(hitLimit ? s.voice.limitReached : null);
      const wav = chunksToWav16k(chunks, rate);
      onFinishRef.current(new Blob([wav as BlobPart], { type: "audio/wav" }), seconds);
    },
    [release],
  );

  const cancel = useCallback(() => {
    release();
    chunksRef.current = [];
    samplesRef.current = 0;
    setRecording(false);
    setElapsed(0);
  }, [release]);

  const start = useCallback(async () => {
    if (startingRef.current || ctxRef.current) return;
    setError(null);
    const Ctx: AudioContextCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !Ctx) {
      setError(s.voice.micUnavailable);
      return;
    }
    startingRef.current = true;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      } catch {
        setError(s.voice.micDenied);
        return;
      }
      const ctx = new Ctx();
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      chunksRef.current = [];
      samplesRef.current = 0;
      levelRef.current = 0;
      rateRef.current = ctx.sampleRate;
      node.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(data)); // copy: the browser reuses the buffer
        samplesRef.current += data.length;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        levelRef.current = Math.sqrt(sum / data.length);
      };
      source.connect(node);
      node.connect(ctx.destination); // silent: nothing is written to the output buffer
      streamRef.current = stream;
      ctxRef.current = ctx;
      sourceRef.current = source;
      nodeRef.current = node;

      setElapsed(0);
      setLevels(new Array(WAVE_BARS).fill(0));
      setRecording(true);
      tickRef.current = setInterval(() => {
        const seconds = samplesRef.current / rateRef.current;
        setElapsed(seconds);
        // Speech sits around 0.02 to 0.3 RMS; a square root makes quiet voices visible.
        const bar = Math.min(1, Math.sqrt(levelRef.current) * 1.6);
        setLevels((cur) => [...cur.slice(1), bar]);
        if (seconds >= MAX_RECORDING_SECONDS) finish(true);
      }, TICK_MS);
    } finally {
      startingRef.current = false;
    }
  }, [finish]);

  // Release the microphone if the screen goes away.
  useEffect(() => release, [release]);

  return { recording, elapsed, levels, error, setError, start, finish: () => finish(false), cancel };
}

/** 0:07 */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
