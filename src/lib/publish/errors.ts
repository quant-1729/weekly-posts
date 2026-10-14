// Turning what can go wrong while publishing into the PublishResult reasons the queue understands.
//
//   token_expired   190, 102, 10, 200-299 (permissions) and the OAuth subcodes 458-467: not retryable; the connection is
//                   marked expired and the owner is emailed once (see index.ts)
//   rate_limited    4, 17, 32, 613, 80000-80014, HTTP 429: retryable
//   media_rejected  subcode 2207xxx, 9004/9005, 36000s, 324: not retryable, except the few that say "try again"
//   network         could not reach Meta, a timeout, HTTP 5xx, 1/2 ("unknown error", "service unavailable"): retryable
//   unknown         anything else: not retryable
//
// Messages come from Meta (already scrubbed of tokens by graphRequest) or from us; a token never appears in one.

import { TokenKeyError } from "@/lib/connections/crypto";
import { GraphError, scrub } from "@/lib/connections/graph";
import { ConnectionError } from "@/lib/connections/types";
import type { PublishResult } from "@/lib/queue/types";

export type PublishFailureResult = Extract<PublishResult, { ok: false }>;
type Reason = PublishFailureResult["reason"];

/** A stop we decided on ourselves (not an API error). */
export class PublishStop extends Error {
  constructor(
    readonly reason: Reason,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "PublishStop";
  }
}

const RATE_CODES = new Set([4, 17, 32, 613]);
const TOKEN_CODES = new Set([190, 102, 10]);
const TOKEN_SUBCODES = new Set([458, 459, 460, 463, 464, 467]);
/** Media problems worth trying again: Meta's own "try again later" subcodes. */
const TRANSIENT_MEDIA_SUBCODES = new Set([2207001, 2207003, 2207032, 2207053]);
const MEDIA_CODES = new Set([9004, 9005, 324, 1366046]);

export const fail = (reason: Reason, retryable: boolean, message: string): PublishFailureResult => ({ ok: false, reason, retryable, message });

export function mapGraphError(e: GraphError): PublishFailureResult {
  const { httpStatus: status, code, subcode } = e;
  const message = e.message.slice(0, 300);
  if (status === 0) return fail("network", true, message);
  if (code !== null && (TOKEN_CODES.has(code) || (code >= 200 && code <= 299))) return fail("token_expired", false, message);
  if (subcode !== null && TOKEN_SUBCODES.has(subcode)) return fail("token_expired", false, message);
  if (status === 429 || (code !== null && (RATE_CODES.has(code) || (code >= 80000 && code <= 80014)))) return fail("rate_limited", true, message);
  if (subcode !== null && subcode >= 2207000 && subcode <= 2207999) return fail("media_rejected", TRANSIENT_MEDIA_SUBCODES.has(subcode), message);
  if (code !== null && (MEDIA_CODES.has(code) || (code >= 36000 && code <= 36009))) return fail("media_rejected", false, message);
  if (status >= 500 || code === 1 || code === 2) return fail("network", true, message);
  if (e.type === "OAuthException" && status === 401) return fail("token_expired", false, message);
  return fail("unknown", false, message);
}

/** Any error thrown while publishing, as a result. Never includes a token. */
export function toFailure(e: unknown, secrets: readonly string[] = []): PublishFailureResult {
  if (e instanceof PublishStop) return fail(e.reason, e.retryable, e.message);
  if (e instanceof GraphError) return mapGraphError(e);
  if (e instanceof TokenKeyError) return fail("unknown", false, "The saved permission could not be read (security key problem). Nothing was posted.");
  if (e instanceof ConnectionError) return fail("not_connected", false, "No saved permission for this account. Please reconnect.");
  const name = e instanceof Error ? e.name : "error";
  return fail("unknown", false, scrub(`Publishing failed (${name}).`, secrets));
}
