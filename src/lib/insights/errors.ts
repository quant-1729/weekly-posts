// Sorts a Meta error into what the insights loop does about it.

import { GraphError, scrub } from "@/lib/connections/graph";
import { InsightsError } from "./types";

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

/**
 * - `permission`: the app or token lacks the insights permission (10, 200-299, 3)
 * - `token`: the token does not work (190, 102, HTTP 401)
 * - `transient`: Meta is busy or unreachable (no answer, 5xx, 429, rate-limit codes)
 * - `metric`: anything else (a deprecated or unsupported metric, a deleted post): skip that metric, keep the rest
 */
export function classify(e: GraphError): "permission" | "token" | "transient" | "metric" {
  if (e.code === 190 || e.code === 102 || e.httpStatus === 401) return "token";
  if (e.code === 10 || e.code === 3 || (e.code !== null && e.code >= 200 && e.code <= 299)) return "permission";
  if (e.httpStatus === 0 || e.httpStatus >= 500 || e.httpStatus === 429 || (e.code !== null && TRANSIENT_CODES.has(e.code))) return "transient";
  return "metric";
}

/** Turns a Meta error that stops the whole fetch into an InsightsError (message scrubbed of the token); null for a metric problem. */
export function stopFor(e: GraphError, token: string): InsightsError | null {
  const kind = classify(e);
  if (kind === "metric") return null;
  return new InsightsError(kind, scrub(e.message, [token]).slice(0, 300));
}

/** A value Meta sent as a count: a non-negative whole number, or null. */
export function count(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}
