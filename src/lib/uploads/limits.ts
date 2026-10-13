/** Upload limits shared by the server code and the UI. No server dependencies, so client components can import this. */

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024; // after the client downscale; Vercel's body limit is 4.5 MB
export const PHOTO_MAX_PX = 2400;
export const PHOTO_JPEG_QUALITY = 85;
export const MODEL_PHOTO_PX = 768;
export const SCREENSHOT_MODEL_PX = 1600;
export const MAX_PHOTOS = 30;
export const MAX_PAST_POSTS = 10;
export const PAST_POST_MIN_CHARS = 10;
export const PAST_POST_MAX_CHARS = 3000;
export const VOICE_DEBOUNCE_MS = 10_000;

/** File types the photo picker offers. HEIC is not accepted. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/** URL the browser uses to show a stored upload (served by /api/files after a membership check). */
export function uploadUrl(storagePath: string | null | undefined): string | null {
  return storagePath ? `/api/files/${storagePath}` : null;
}

/** How many example phrases and words to avoid the voice fields hold (the server enforces the same limits). */
export const MAX_EXAMPLE_PHRASES = 10;
export const MAX_AVOID_WORDS = 50;
