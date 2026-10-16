// What is recorded about a generated image in brand_faces.provenance (model, version, prompt hash, time, C2PA/SynthID).
// The image bytes themselves are stored exactly as the model returned them; only the cut-out pose is processed.

import { createHash } from 'node:crypto';
import { FACE_PROMPT_VERSION } from '@/lib/ai/prompts/faces';
import type { FaceImageResult } from './image-client';

export interface FaceProvenanceEntry {
  model: string;
  modelVersion?: string;
  /** sha256 of the exact prompt text sent (after redaction), so the look can be reproduced. */
  promptHash: string;
  promptVersion: string;
  createdAt: string;
  /** The image the model returned carried C2PA content credentials. Cut-out poses do not keep them (the file is re-encoded). */
  c2pa: boolean;
  /** Gemini image output carries an invisible SynthID watermark. */
  synthid: boolean;
  aiGenerated: true;
}

export const promptHash = (prompt: string): string => createHash('sha256').update(prompt, 'utf8').digest('hex');

export function provenanceEntry(img: FaceImageResult, prompt: string, now: Date): FaceProvenanceEntry {
  return {
    model: img.model,
    ...(img.modelVersion ? { modelVersion: img.modelVersion } : {}),
    promptHash: promptHash(prompt),
    promptVersion: FACE_PROMPT_VERSION,
    createdAt: now.toISOString(),
    c2pa: img.c2pa,
    synthid: img.synthid,
    aiGenerated: true,
  };
}
