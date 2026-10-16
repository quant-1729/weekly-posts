"use client";

import { useState } from "react";
import { s } from "@/lib/i18n/strings";
import { VoiceRecorder } from "./voice-recorder";

/**
 * A voice recorder that uploads the WAV to /api/setup/transcribe and hands back
 * the transcript. If the transcript is unusable (empty, no speech, mostly
 * unclear) it says so and lets the owner record again; it never passes such a
 * transcript on.
 */
export function VoiceAnswer({
  brandId,
  onTranscript,
  useLabel,
}: {
  brandId: string;
  onTranscript: (text: string) => void;
  useLabel: string;
}) {
  const [attempt, setAttempt] = useState(0); // new key = fresh recorder
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ title?: string; body: string } | null>(null);

  async function upload(blob: Blob) {
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("brand_id", brandId);
      form.set("audio", blob, "voice.wav");
      const res = await fetch("/api/setup/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; transcript: string; usable: boolean }
        | { ok: false; message?: string }
        | null;
      if (!data) {
        setMessage({ body: s.errors.signedOut });
      } else if (!data.ok) {
        setMessage({ body: data.message ?? s.errors.generic });
      } else if (!data.usable) {
        setMessage({ title: s.setup.unusableTitle, body: s.setup.unusableBody });
        setAttempt((n) => n + 1);
      } else {
        onTranscript(data.transcript);
      }
    } catch {
      setMessage({ body: s.errors.generic });
    } finally {
      setUploading(false);
    }
  }

  if (uploading) {
    return (
      <p role="status" className="rounded-xl bg-stone-50 p-6 text-center text-stone-700">
        {s.setup.transcribing}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {message && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          {message.title && <p className="font-medium">{message.title}</p>}
          <p className="text-sm">{message.body}</p>
        </div>
      )}
      <VoiceRecorder key={attempt} onUse={(blob) => void upload(blob)} useLabel={useLabel} />
    </div>
  );
}
