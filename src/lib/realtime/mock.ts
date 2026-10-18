// In-memory live status (mock mode and tests): a recorder of what would have been written, plus a hook so a test can make
// the write slow or throw. No network.

import type { LiveKind } from './types';

/** What one write carries, after sanitising. `path` is `brands/{brandId}/live/{docId}`. */
export interface LiveWrite {
  path: string;
  brandId: string;
  docId: string;
  kind: LiveKind;
  /** The allow-listed fields only. */
  data: Record<string, string | number>;
  v: number;
  seq: number;
  /** Epoch ms when the document stops mattering (the TTL field). */
  expireAtMs: number;
  /** Epoch ms of the write. */
  writtenAtMs: number;
}

const MAX_KEPT = 500;
let writes: LiveWrite[] = [];
let sink: ((w: LiveWrite) => void | Promise<void>) | null = null;

/** Records the write in memory (the newest 500 are kept), then runs the test sink if there is one. */
export async function recordLiveWrite(w: LiveWrite): Promise<void> {
  writes.push(w);
  if (writes.length > MAX_KEPT) writes = writes.slice(-MAX_KEPT);
  if (sink) await sink(w);
}

export function liveWritesForTests(): LiveWrite[] {
  return [...writes];
}
export function setLiveSinkForTests(fn: ((w: LiveWrite) => void | Promise<void>) | null): void {
  sink = fn;
}
export function clearLiveWritesForTests(): void {
  writes = [];
}
