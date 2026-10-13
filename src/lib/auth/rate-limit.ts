/**
 * In-memory sliding-window limiter, for the mock sign-in only (real Supabase
 * Auth rate-limits itself). Kept on globalThis so Next dev hot reload keeps it.
 */

export interface Bucket {
  key: string;
  limit: number;
  windowMs: number;
}

const g = globalThis as unknown as { __postmitraRateHits?: Map<string, number[]> };
function hits(): Map<string, number[]> {
  return (g.__postmitraRateHits ??= new Map());
}

/** Tests only. */
export function resetRateLimits(): void {
  hits().clear();
}

/**
 * Records one hit against every bucket and returns true, or returns false and
 * records nothing if any bucket is already full (so a refused request does not
 * use up allowance).
 */
export function takeAll(buckets: Bucket[], nowMs: number = Date.now()): boolean {
  const map = hits();
  const live = buckets.map((b) => {
    const recent = (map.get(b.key) ?? []).filter((t) => t > nowMs - b.windowMs);
    return { b, recent };
  });
  if (live.some(({ b, recent }) => recent.length >= b.limit)) return false;
  for (const { b, recent } of live) map.set(b.key, [...recent, nowMs]);
  return true;
}
