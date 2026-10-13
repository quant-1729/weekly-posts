// Which picture goes with which channel when the owner shares (Req 17). Pure: safe in the browser.

import type { V2Channel } from '@/lib/ai/prompts/v2-weekly';

export type ShareFormat = 'square' | 'vertical' | 'landscape';
export const SHARE_FORMATS: readonly ShareFormat[] = ['square', 'vertical', 'landscape'];

/** The vertical picture is for stories and WhatsApp status. */
export const STORY_FORMAT: ShareFormat = 'vertical';

/** Square for Instagram and Facebook feeds, landscape for LinkedIn and Google Business Profile. */
export function defaultShareFormat(channel: V2Channel): ShareFormat {
  return channel === 'linkedin' || channel === 'gbp' ? 'landscape' : 'square';
}

export const isShareFormat = (v: unknown): v is ShareFormat => typeof v === 'string' && (SHARE_FORMATS as readonly string[]).includes(v);

/** A short file name for a downloaded or shared picture, e.g. "instagram-square.png". */
export function shareFilename(channel: string, format: ShareFormat, ext: 'png' | 'jpg' = 'png'): string {
  return `${channel.replace(/[^a-z0-9]+/gi, '') || 'post'}-${format}.${ext}`;
}

/** "Not posted yet" works for this long after a post was marked posted. */
export const UNMARK_WINDOW_MS = 24 * 3600 * 1000;
