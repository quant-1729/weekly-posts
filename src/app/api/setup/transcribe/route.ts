import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MAX_WAV_BYTES } from "@/lib/audio/wav";
import { describeError } from "@/lib/brand/errors";
import { transcribeSetupAudio } from "@/lib/brand/setup";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";

/**
 * POST multipart: brand_id, audio (WAV, 16 kHz mono). Saves the voice note under
 * inputs/{brand_id}/setup/ and returns its transcript. Never extracts anything:
 * the client must check `usable` before asking for a profile.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, code: "signed_out", message: s.errors.signedOut }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, code: "invalid_audio", message: s.errors.invalidAudio }, { status: 400 });
  }
  const brandId = form.get("brand_id");
  const audio = form.get("audio");
  if (typeof brandId !== "string" || !(audio instanceof File)) {
    return Response.json({ ok: false, code: "invalid_audio", message: s.errors.invalidAudio }, { status: 400 });
  }
  if (audio.size > MAX_WAV_BYTES) {
    return Response.json({ ok: false, code: "audio_too_large", message: s.errors.audioTooLarge }, { status: 413 });
  }

  try {
    const result = await transcribeSetupAudio({
      userId: user.id,
      brandId,
      bytes: new Uint8Array(await audio.arrayBuffer()),
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const err = describeError(e);
    const status = err.code === "not_found" ? 404 : err.code === "cap" ? 429 : err.code === "generic" ? 500 : 400;
    return Response.json({ ok: false, ...err }, { status });
  }
}
