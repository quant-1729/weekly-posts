import { randomUUID } from "node:crypto";
import { generateJson, generateText } from "@/lib/ai/client";
import { buildSetupExtractPrompt } from "@/lib/ai/prompts/setup";
import { TRANSCRIBE_INSTRUCTION, isTranscriptUsable } from "@/lib/ai/prompts/transcribe";
import { setupExtractJsonSchema, setupExtractSchema, type SetupExtract } from "@/lib/ai/schemas";
import { MAX_WAV_BYTES, WAV_CHANNELS, WAV_SAMPLE_RATE, readWavInfo } from "@/lib/audio/wav";
import { getStorage, type Storage } from "@/lib/storage";
import { assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage, type UsageMeta } from "@/lib/usage";
import { requireBrandMember } from "./current";
import { answersToTranscript, hasAnyAnswer, type SetupAnswers } from "./extract";
import { SETUP_EXTRACT_FIXTURE, SETUP_TRANSCRIPT_FIXTURE } from "./fixtures";

/** Voice transcription and profile extraction for brand setup (R2). */

export type SetupErrorCode = "invalid_audio" | "audio_too_large" | "unusable_transcript" | "no_answers";

export class SetupError extends Error {
  constructor(public readonly code: SetupErrorCode) {
    super(code);
    this.name = "SetupError";
  }
}

export interface TranscribeResult {
  transcript: string;
  /** False when the transcript is empty, "[no speech]" or mostly [unclear]. Never extract from it. */
  usable: boolean;
  /** Where the audio was saved: inputs/{brand_id}/setup/{uuid}.wav */
  audioPath: string;
}

/**
 * Saves a setup voice note (WAV, 16 kHz mono) at inputs/{brand_id}/setup/{uuid}.wav
 * and transcribes it. Counts one `transcribe` usage event against the daily cap.
 * Throws SetupError, BrandAccessError or DailyCapError.
 */
export async function transcribeSetupAudio(args: {
  userId: string;
  brandId: string;
  bytes: Uint8Array;
  storage?: Storage;
  now?: Date;
}): Promise<TranscribeResult> {
  const { userId, brandId, bytes } = args;
  await requireBrandMember(userId, brandId);

  if (bytes.byteLength > MAX_WAV_BYTES) throw new SetupError("audio_too_large");
  const info = readWavInfo(bytes);
  if (!info || info.sampleRate !== WAV_SAMPLE_RATE || info.channels !== WAV_CHANNELS || info.bits !== 16) {
    throw new SetupError("invalid_audio");
  }
  if (info.seconds < 0.5) throw new SetupError("invalid_audio");

  await assertUnderDailyCap(brandId, args.now);

  const audioPath = `${brandId}/setup/${randomUUID()}.wav`;
  await (args.storage ?? getStorage()).put("inputs", audioPath, bytes, "audio/wav");

  let text: string;
  let usd = 0;
  let meta: UsageMeta = { ok: false };
  try {
    const res = await generateText({
      instruction: TRANSCRIBE_INSTRUCTION,
      media: [{ mimeType: "audio/wav", data: bytes }],
      logContext: { brandId },
      fixture: SETUP_TRANSCRIPT_FIXTURE,
    });
    text = res.text;
    usd = res.stats?.usd ?? 0;
    meta = { model: res.stats?.model };
  } finally {
    // The call was attempted, so it counts against the cap even if it failed.
    await recordUsage(brandId, userId, "transcribe", usd, meta);
  }
  const transcript = text.trim();
  return { transcript, usable: isTranscriptUsable(transcript), audioPath: `inputs/${audioPath}` };
}

export interface ExtractResult {
  extract: SetupExtract;
  /** Text to keep in brand_memory.setup_transcript: the voice transcript, or the questions with answers. */
  setupTranscript: string;
}

/**
 * Turns the owner's answers or one voice transcript into profile fields. An
 * unusable transcript or no answers is rejected before any AI call. Counts one
 * `setup` usage event against the daily cap.
 */
export async function extractSetupProfile(args: {
  userId: string;
  brandId: string;
  answers?: SetupAnswers;
  transcript?: string;
  now?: Date;
}): Promise<ExtractResult> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);

  let prompt: { system: string; user: string };
  let setupTranscript: string;
  if (args.transcript !== undefined) {
    if (!isTranscriptUsable(args.transcript)) throw new SetupError("unusable_transcript");
    prompt = buildSetupExtractPrompt({ transcript: args.transcript });
    setupTranscript = args.transcript.trim();
  } else {
    const answers = args.answers ?? {};
    if (!hasAnyAnswer(answers)) throw new SetupError("no_answers");
    prompt = buildSetupExtractPrompt({ answers });
    setupTranscript = answersToTranscript(answers);
  }

  await assertUnderDailyCap(brandId, args.now);
  let usd = 0;
  let meta: UsageMeta = { ok: false };
  try {
    const { data, stats } = await generateJson({
      system: prompt.system,
      user: prompt.user,
      zodSchema: setupExtractSchema,
      jsonSchema: setupExtractJsonSchema,
      temperature: 0.2,
      logContext: { brandId },
      fixture: SETUP_EXTRACT_FIXTURE,
    });
    usd = stats?.usd ?? 0;
    meta = { model: stats?.model };
    return { extract: data, setupTranscript };
  } catch (e) {
    usd = failedCallUsd(e); // an answer that did not validate still cost money (H-2)
    meta = { ok: false, model: failedCallModel(e) };
    throw e;
  } finally {
    await recordUsage(brandId, userId, "setup", usd, meta);
  }
}
