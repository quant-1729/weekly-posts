// Mints the short-lived Firebase custom token that lets a signed-in owner's browser read their current brand's live status
// documents (docs/14-firebase-plan.md §4). Claims are exactly { b: brandId, until }: no email or personal data.

import { realtimeMode } from './config';
import { createLiveCustomToken } from './firestore';

/** How long a token's claim stays valid (the Firestore rules compare `until` with the request time). */
export const LIVE_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface LiveTokenRequest {
  userId: string;
  brandId: string;
  /** Epoch ms. */
  now: number;
}
export interface LiveToken {
  token: string;
  /** Epoch ms when the claim ends. */
  until: number;
}
export type LiveTokenMinter = (req: LiveTokenRequest & { claims: { b: string; until: number } }) => Promise<string>;

let injected: LiveTokenMinter | null = null;
export function setLiveTokenMinterForTests(fn: LiveTokenMinter | null): void {
  injected = fn;
}
/** True while a test minter is set: the route then treats live status as on (otherwise vitest is always mock, so off). */
export function hasLiveTokenMinterForTests(): boolean {
  return injected !== null;
}

export async function mintLiveToken({ userId, brandId, now }: LiveTokenRequest): Promise<LiveToken> {
  const until = now + LIVE_TOKEN_TTL_MS;
  const claims = { b: brandId, until };
  if (injected) return { token: await injected({ userId, brandId, now, claims }), until };
  if (realtimeMode() !== 'firestore') throw new Error('live status is not on');
  return { token: await createLiveCustomToken(userId, claims), until };
}
