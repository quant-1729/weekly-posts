import { getDb } from "@/lib/db";

/**
 * The activity log the admin dashboard reads (public.app_events). Short codes and small facts only.
 *
 * `logEvent` is fire-and-forget: it never throws into the request (the promise it returns never rejects, so
 * callers write `void logEvent(...)`), and what it stores is checked first:
 *   - `kind` is a dotted code such as auth.sign_in;
 *   - `detail` keeps at most 8 small fields: keys are short snake_case names, values are numbers, booleans,
 *     null or short plain strings; a key that sounds like content or a secret (text, caption, description,
 *     body, message, token, secret, password, key, email, phone, payment, upi, address, url, note, name,
 *     prompt, ip) is dropped, and so is a string that looks like an email address, a link or a token.
 * Never pass post text, captions, owner descriptions, payment IDs, tokens or email bodies; the filter is a net,
 * not permission.
 */

const KIND_RE = /^[a-z][a-z0-9_.]{1,59}$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;
const BANNED_KEY_RE =
  /text|caption|desc|body|message|token|secret|passw|key|mail|phone|payment|upi|iban|address|url|link|note|name|prompt|content|title|hashtag|^ip|_ip$|cookie|auth/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELDS = 8;
const MAX_STRING = 60;

export type EventDetail = Record<string, string | number | boolean | null | undefined>;

export interface EventInput {
  kind: string;
  userId?: string | null;
  brandId?: string | null;
  sessionId?: string | null;
  ok?: boolean;
  detail?: EventDetail;
}

function safeString(v: string): boolean {
  if (v.length > MAX_STRING) return false;
  if (UUID_RE.test(v)) return true;
  if (/@/.test(v) || /https?:|www\./i.test(v)) return false;
  if (/[A-Za-z0-9_\-+/=]{24,}/.test(v)) return false; // a long token-like run
  return true;
}

/** The detail that may be stored: see the rules above. Exported for tests. */
export function cleanDetail(detail: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return out;
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_FIELDS) break;
    if (!KEY_RE.test(k) || BANNED_KEY_RE.test(k)) continue;
    if (v === null || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = v;
    } else if (typeof v === "string") {
      if (safeString(v)) out[k] = v;
    }
  }
  return out;
}

const uuidOrNull = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : null);

export function logEvent(event: EventInput): Promise<void> {
  try {
    if (typeof event?.kind !== "string" || !KIND_RE.test(event.kind)) return Promise.resolve();
    const detail = JSON.stringify(cleanDetail(event.detail));
    const params = [
      event.kind,
      uuidOrNull(event.userId),
      uuidOrNull(event.brandId),
      uuidOrNull(event.sessionId),
      event.ok !== false,
      detail,
    ];
    return getDb()
      .withService((tx) =>
        tx.query(
          `insert into public.app_events (kind, user_id, brand_id, session_id, ok, detail)
           values ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6::jsonb)`,
          params,
        ),
      )
      .then(
        () => undefined,
        (e: unknown) => {
          // Logging must never break the request, and the error text could carry values: print the class only.
          console.warn("[events] could not record", event.kind, (e as Error)?.name ?? "error");
        },
      );
  } catch {
    return Promise.resolve();
  }
}
