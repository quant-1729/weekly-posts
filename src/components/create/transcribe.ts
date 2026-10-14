// The one place the Details step turns a recording into text. Today it calls the setup transcription
// route (Gemini); C-34 swaps this function (or the route behind it) for Speech-to-Text.

import { s } from "@/lib/i18n/strings";

export type TranscribeResult = { ok: true; transcript: string } | { ok: false; message: string };

/** Sends a WAV (16 kHz mono) and returns what was said. Never throws; an unusable recording is a failure with words to show. */
export async function transcribeVoice(brandId: string, wav: Blob): Promise<TranscribeResult> {
  try {
    const form = new FormData();
    form.set("brand_id", brandId);
    form.set("audio", wav, "voice.wav");
    const res = await fetch("/api/setup/transcribe", { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as { ok: true; transcript: string; usable: boolean } | { ok: false; message?: string } | null;
    if (!data) return { ok: false, message: s.errors.signedOut };
    if (!data.ok) return { ok: false, message: data.message ?? s.errors.generic };
    if (!data.usable) return { ok: false, message: s.setup.unusableBody };
    return { ok: true, transcript: data.transcript };
  } catch {
    return { ok: false, message: s.errors.generic };
  }
}
