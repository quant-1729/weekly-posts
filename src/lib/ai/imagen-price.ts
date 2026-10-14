// Imagen is billed per generated image, not per token. One place for the price, so the weekly cost
// estimates (src/lib/usage/caps.ts) and the cost logging (src/lib/ai/imagen.ts) agree.

export const DEFAULT_IMAGEN_MODEL = 'imagen-4.0-generate-001';

/**
 * USD per generated image. VERIFY against the current Vertex AI price list before relying on it
 * (https://cloud.google.com/vertex-ai/generative-ai/pricing): at the time of writing Imagen 4 is
 * about $0.04 (standard), $0.06 (ultra) and $0.02 (fast) per image.
 */
export const IMAGEN_USD_PER_IMAGE: Record<string, number> = {
  'imagen-4.0-generate-001': 0.04,
  'imagen-4.0-ultra-generate-001': 0.06,
  'imagen-4.0-fast-generate-001': 0.02,
  // Gemini image model used when Imagen is not in the project's model list (IMAGEN_MODEL=gemini-2.5-flash-image): about 1,290 output tokens at $30 per million.
  'gemini-2.5-flash-image': 0.039,
};
/** Deliberately high for a model not in the table. */
export const IMAGEN_FALLBACK_USD = 0.06;

export function imagenUsd(model: string, images = 1): number {
  return (IMAGEN_USD_PER_IMAGE[model] ?? IMAGEN_FALLBACK_USD) * images;
}

/** Estimate for one new background in the weekly cap check: one Imagen image plus the Gemini text check. */
export const ESTIMATED_BACKGROUND_USD = 0.05;
