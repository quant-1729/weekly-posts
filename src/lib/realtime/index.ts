// Live status writer (docs/14-firebase-plan.md §5). `emitLive` is a doorbell for the browser: it is awaited but capped at
// 1.5 s, never throws, and logs "[live] write failed" at most once a minute, so it can never slow or break publishing or
// face generation. Supabase stays the truth; a lost or late write only means the screen updates a moment later.

import { realtimeMode } from './config';
import { recordLiveWrite, type LiveWrite } from './mock';
import { LIVE_TTL_MS, LIVE_VERSION, isLiveBrandId, isLiveDocId, isLiveKind, sanitize, type FaceLive, type LiveKind, type QueueLive } from './types';

export { realtimeMode, webConfig } from './config';
export type { RealtimeMode, WebConfig } from './config';
export { clearLiveWritesForTests, liveWritesForTests, setLiveSinkForTests } from './mock';
export type { LiveWrite } from './mock';
export { LIVE_TOKEN_TTL_MS, hasLiveTokenMinterForTests, mintLiveToken, setLiveTokenMinterForTests } from './token';
export type { LiveToken, LiveTokenMinter, LiveTokenRequest } from './token';
export * from './types';

export const EMIT_CAP_MS = 1500;
const LOG_EVERY_MS = 60_000;

let counter = 0;
let lastLogAt = 0;

/** Test helper: forget the log throttle and the sequence counter. Recorded writes are cleared by clearLiveWritesForTests. */
export function resetLiveForTests(): void {
  counter = 0;
  lastLogAt = 0;
}

function logFailure(reason: unknown): void {
  const now = Date.now();
  if (now - lastLogAt < LOG_EVERY_MS) return;
  lastLogAt = now;
  const text = reason instanceof Error ? reason.message : String(reason);
  console.error('[live] write failed', text.slice(0, 200));
}

async function write(w: LiveWrite): Promise<void> {
  if (realtimeMode() === 'firestore') {
    const { writeLiveDoc } = await import('./firestore');
    await writeLiveDoc(w);
  } else {
    await recordLiveWrite(w);
  }
}

/**
 * Writes `brands/{brandId}/live/{docId}`. Only the allow-listed fields of `kind` are kept; a bad brand id, doc id or kind is
 * refused without a write. Resolves (never rejects) once the write is done, failed, or 1.5 s have passed.
 */
export async function emitLive(brandId: string, docId: string, kind: LiveKind, data: object, ttlMs: number = LIVE_TTL_MS[kind]): Promise<void> {
  try {
    if (realtimeMode() === 'off') return;
    if (!isLiveBrandId(brandId) || !isLiveDocId(docId) || !isLiveKind(kind)) return;
    const now = Date.now();
    counter = (counter + 1) % 1000;
    const w: LiveWrite = {
      path: `brands/${brandId}/live/${docId}`,
      brandId,
      docId,
      kind,
      data: sanitize(kind, data),
      v: LIVE_VERSION,
      seq: now * 1000 + counter,
      expireAtMs: now + ttlMs,
      writtenAtMs: now,
    };
    const work = Promise.resolve().then(() => write(w));
    // If the cap wins, a late failure of `work` must not become an unhandled rejection.
    work.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capped = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), EMIT_CAP_MS);
      timer.unref?.();
    });
    try {
      const outcome = await Promise.race([work.then(() => 'done' as const), capped]);
      if (outcome === 'late') logFailure(new Error(`no answer in ${EMIT_CAP_MS} ms`));
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logFailure(e);
  }
}

/** One queue item's status (doc `q_{itemId}`). */
export function emitQueueItem(brandId: string, item: { id: string } & Omit<QueueLive, 'itemId'>): Promise<void> {
  const { id, ...rest } = item;
  return emitLive(brandId, `q_${id}`, 'queue', { itemId: id, ...rest });
}

/** An owner action changed the queue on some device: other devices refresh. */
export function emitQueueTouch(brandId: string): Promise<void> {
  return emitLive(brandId, 'queue_touch', 'queue_touch', {});
}

/** Brand Face generation progress (doc `face_{faceId}`). */
export function emitFaceProgress(brandId: string, progress: FaceLive): Promise<void> {
  return emitLive(brandId, `face_${progress.faceId}`, 'face', progress);
}
