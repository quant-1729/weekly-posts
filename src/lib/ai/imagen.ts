// Imagen on Vertex AI (C-18): abstract background textures only. Never products, people or text
// (CLAUDE.md). The prompt comes from src/lib/ai/prompts/v3.ts (buildImagenBackgroundPrompt); the
// result is checked for text before use by src/lib/style/backgrounds.ts.
//
// Imagen is billed per image (src/lib/ai/imagen-price.ts). Tests never call this: they pass a fake
// generator to generateBackground, and aiMode() is "fixture" under vitest.
//
// IMAGEN_MODEL picks the model. An id starting with "imagen" uses models.generateImages. Any other id (for example
// gemini-2.5-flash-image) is a Gemini image model and uses models.generateContent with image output, because
// Google is retiring generateImages and Imagen is not in every project's model list. Both are billed per image.

import { GoogleGenAI, Modality, PersonGeneration, SafetyFilterLevel } from '@google/genai';
import { AiError, aiMode, serviceAccountCredentials } from './client';
import { DEFAULT_IMAGEN_MODEL, imagenUsd } from './imagen-price';

export { DEFAULT_IMAGEN_MODEL } from './imagen-price';

/** Aspect ratios Imagen accepts. The design engine crops the result to each format. */
export type ImagenAspect = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export function imagenModel(): string {
  return process.env.IMAGEN_MODEL || DEFAULT_IMAGEN_MODEL;
}

/**
 * Imagen is served from regional endpoints (not "global"), so it has its own location setting.
 * Default us-central1, where Imagen 4 is available.
 */
export function imagenLocation(): string {
  return process.env.IMAGEN_LOCATION || 'us-central1';
}

/** True when a live Imagen call could be made: live AI mode on Vertex with a project. */
export function imagenAvailable(): boolean {
  return aiMode() === 'live' && process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' && !!process.env.GOOGLE_CLOUD_PROJECT;
}

let client: GoogleGenAI | null = null;
function vertex(): GoogleGenAI {
  if (client) return client;
  const credentials = serviceAccountCredentials();
  client = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: imagenLocation(),
    ...(credentials ? { googleAuthOptions: { credentials } } : {}),
  });
  return client;
}

export interface ImagenRequest {
  prompt: string;
  negativePrompt: string;
  aspectRatio: ImagenAspect;
  /** Used by Gemini image models (which always add the SynthID watermark); ignored by Imagen, where the watermark stays on. */
  seed: number;
  timeoutMs?: number;
}

export interface ImagenImage {
  bytes: Buffer;
  mimeType: string;
  model: string;
  /** What this image cost (per-image price). */
  usd: number;
}

/** A function with this shape generates one image. The real one is generateImagenImage; tests pass fakes. */
export type ImagenFn = (req: ImagenRequest) => Promise<ImagenImage>;

/**
 * One Imagen image. Throws AiError('call_failed') on any failure (permission, quota, filtered by
 * the safety system, no image returned). Not retried here: callers decide, because each try is billed.
 */
export const generateImagenImage: ImagenFn = async (req) => {
  const model = imagenModel();
  const start = Date.now();
  const image = model.startsWith('imagen') ? await viaGenerateImages(model, req) : await viaGenerateContent(model, req);
  const usd = imagenUsd(model, 1);
  console.info(`[ai] ${model} image ${Date.now() - start}ms ~${usd.toFixed(4)}`);
  return { ...image, model, usd };
};

async function viaGenerateImages(model: string, req: ImagenRequest): Promise<Pick<ImagenImage, 'bytes' | 'mimeType'>> {
  let res;
  try {
    res = await vertex().models.generateImages({
      model,
      prompt: req.prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: req.aspectRatio,
        negativePrompt: req.negativePrompt,
        // Keep Google's invisible SynthID watermark on (AI images stay identifiable). Imagen only accepts a
        // seed without it, so no seed here: a retry still differs because generation is random.
        addWatermark: true,
        personGeneration: PersonGeneration.DONT_ALLOW,
        safetyFilterLevel: SafetyFilterLevel.BLOCK_MEDIUM_AND_ABOVE,
        outputMimeType: 'image/png',
        includeRaiReason: true,
        enhancePrompt: false, // keep our prompt exactly (no rewriting that could add objects or text)
        abortSignal: AbortSignal.timeout(req.timeoutMs ?? 60_000),
      },
    });
  } catch (e) {
    throw new AiError('call_failed', e instanceof Error ? e.message : String(e));
  }
  const first = res.generatedImages?.[0];
  const b64 = first?.image?.imageBytes;
  if (!b64) {
    throw new AiError('call_failed', `Imagen returned no image${first?.raiFilteredReason ? ` (filtered: ${first.raiFilteredReason})` : ''}`);
  }
  return { bytes: Buffer.from(b64, 'base64'), mimeType: first.image?.mimeType || 'image/png' };
}

/** Gemini image models have no negative-prompt field, so the negative terms go into the prompt. */
async function viaGenerateContent(model: string, req: ImagenRequest): Promise<Pick<ImagenImage, 'bytes' | 'mimeType'>> {
  let res;
  try {
    res = await vertex().models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: `${req.prompt} Do not include: ${req.negativePrompt}.` }] }],
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio: req.aspectRatio, personGeneration: 'ALLOW_NONE' },
        seed: req.seed,
        abortSignal: AbortSignal.timeout(req.timeoutMs ?? 90_000),
      },
    });
  } catch (e) {
    throw new AiError('call_failed', e instanceof Error ? e.message : String(e));
  }
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) {
    throw new AiError('call_failed', `${model} returned no image${res.candidates?.[0]?.finishReason ? ` (finish reason: ${res.candidates[0].finishReason})` : ''}`);
  }
  return { bytes: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType || 'image/png' };
}
