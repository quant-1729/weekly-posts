// Gemini image generation on Vertex AI for Brand Face (F-5): a text prompt plus up to 3 reference images in, PNG bytes out.
// Tests never call this: every step takes the image function as a dependency (`FaceImageFn`) and the fixture-mode default
// refuses to make a network call. Cost is per image (FACE_IMAGE_USD); the step records the usage event.

import { GoogleGenAI, Modality } from '@google/genai';
import { AiError, aiMode, serviceAccountCredentials } from '@/lib/ai/client';
import { redactPaymentIds } from '@/lib/payments/redact';
import { FACE_IMAGE_MODEL, FACE_IMAGE_USD } from '../types';

export const MAX_FACE_REFERENCES = 3;

/** FACE_IMAGE_MODEL in the environment overrides the default model. */
export function faceImageModel(): string {
  return process.env.FACE_IMAGE_MODEL?.trim() || FACE_IMAGE_MODEL;
}

/** Image models are served from a location of their own; "global" unless FACE_IMAGE_LOCATION says otherwise. */
export function faceImageLocation(): string {
  return process.env.FACE_IMAGE_LOCATION?.trim() || 'global';
}

export type FaceAspect = '1:1' | '3:4' | '4:3';

export interface FaceImageRequest {
  prompt: string;
  /** Up to MAX_FACE_REFERENCES PNG images (the master, the sheet, an optional pose guide). */
  references?: Buffer[];
  aspectRatio?: FaceAspect;
  /** Differs per option so the four options are not four copies. */
  seed?: number;
  timeoutMs?: number;
}

export interface FaceImageResult {
  /** PNG bytes exactly as the model returned them. */
  bytes: Buffer;
  mimeType: string;
  model: string;
  /** The model version the response reports, when it does. */
  modelVersion?: string;
  /** What this image cost. */
  usd: number;
  /** The PNG carries C2PA content credentials (a JUMBF "caBX" chunk). */
  c2pa: boolean;
  /** Google marks Gemini image output with an invisible SynthID watermark; there is no response flag, so this is the documented default. */
  synthid: boolean;
}

/** One image. The real one is generateFaceImage; tests pass fakes. */
export type FaceImageFn = (req: FaceImageRequest) => Promise<FaceImageResult>;

let client: GoogleGenAI | null = null;
function vertex(): GoogleGenAI {
  if (client) return client;
  const credentials = serviceAccountCredentials();
  client = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: faceImageLocation(),
    ...(credentials ? { googleAuthOptions: { credentials } } : {}),
  });
  return client;
}

/** Whether PNG bytes carry a C2PA manifest: a "caBX" chunk comes before IDAT. */
export function pngHasC2pa(png: Buffer): boolean {
  if (png.length < 16 || png.readUInt32BE(0) !== 0x89504e47) return false;
  let at = 8;
  while (at + 8 <= png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (type === 'caBX') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + len;
  }
  return false;
}

/**
 * The real call. Adults only (personGeneration ALLOW_ADULT; a child is never made). The prompt goes through
 * redactPaymentIds as the last line of defence. Throws AiError('call_failed') on any failure or when no image comes back.
 * Not retried here: every try is billed, so the step decides.
 */
export const generateFaceImage: FaceImageFn = async (req) => {
  if (aiMode() === 'fixture') throw new AiError('no_fixture', 'AI is in fixture mode: no face image is made');
  const refs = req.references ?? [];
  if (refs.length > MAX_FACE_REFERENCES) throw new AiError('call_failed', `At most ${MAX_FACE_REFERENCES} reference images`);
  const model = faceImageModel();
  const start = Date.now();
  let res;
  try {
    res = await vertex().models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            ...refs.map((r) => ({ inlineData: { mimeType: 'image/png', data: r.toString('base64') } })),
            { text: redactPaymentIds(req.prompt) },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio: req.aspectRatio ?? '3:4', personGeneration: 'ALLOW_ADULT', outputMimeType: 'image/png' },
        ...(req.seed === undefined ? {} : { seed: req.seed }),
        abortSignal: AbortSignal.timeout(req.timeoutMs ?? 90_000),
      },
    });
  } catch (e) {
    throw new AiError('call_failed', e instanceof Error ? e.message : String(e));
  }
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) {
    const why = res.candidates?.[0]?.finishReason;
    throw new AiError('call_failed', `${model} returned no image${why ? ` (finish reason: ${why})` : ''}`);
  }
  const bytes = Buffer.from(part.inlineData.data, 'base64');
  console.info(`[ai] ${model} face image ${Date.now() - start}ms ~${FACE_IMAGE_USD.toFixed(4)}`);
  return {
    bytes,
    mimeType: part.inlineData.mimeType || 'image/png',
    model,
    ...(res.modelVersion ? { modelVersion: res.modelVersion } : {}),
    usd: FACE_IMAGE_USD,
    c2pa: pngHasC2pa(bytes),
    synthid: true,
  };
};
