// After the call that publishes times out or fails at the network level, the post may still have gone live. Retrying
// blindly would post twice, so we first look at the account's latest posts: one with the same caption that appeared
// after this attempt began (2 minutes of clock skew allowed) counts as published.

import { GraphError } from "@/lib/connections/graph";

export const CLOCK_SKEW_MS = 2 * 60 * 1000;

/** Failed in a way that does not tell us whether Meta did the work: no answer, or a server error. */
export const unknownOutcome = (e: unknown): e is GraphError => e instanceof GraphError && (e.httpStatus === 0 || e.httpStatus >= 500);

/** Meta writes times like 2026-10-14T10:00:00+0000. */
export function parseMetaTime(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(t) ? t : null;
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function sameCaption(a: string | null | undefined, b: string | null | undefined): boolean {
  return norm(a) === norm(b);
}

export function startedRecently(createdMs: number | null, startedAtMs: number): boolean {
  return createdMs !== null && createdMs >= startedAtMs - CLOCK_SKEW_MS;
}
