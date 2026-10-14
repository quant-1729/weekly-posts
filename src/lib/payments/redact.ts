// Payment IDs never reach the AI (CLAUDE.md rule, change C-10/C-12). Pure helpers: no database.
//
// Phase 2 MUST call redactPaymentIds() on every owner free-text field before it goes into a
// prompt: the brief note ("Describe your post", typed or spoken transcript, B-7), the USP titles
// and details, custom CTA text, imported captions, fact values, anything an owner typed. Prefer
// passing `known` (the brand's pending and active addresses) as well as the pattern.

export const REDACTED_PAYMENT_ID = "[payment ID removed]";

// A UPI-looking address: name@handle. The handle must not continue into a domain (".com"), so
// an e-mail address (jo@example.com) is not touched. Same character classes as the UPI check in
// the database; the surrounding lookbehind/lookahead stop it matching inside longer words.
const UPI_LIKE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9]{1,63}(?![A-Za-z0-9-]|\.[A-Za-z0-9])/g;
// A whole UPI payment URI (it carries the address in pa=...).
const UPI_URI = /\bupi:\/\/[^\s<>"']*/gi;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every payment address found in a text, as written, in order. Includes those inside upi:// links. */
export function findPaymentIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(UPI_URI)) {
    const pa = /[?&]pa=([^&\s]+)/i.exec(m[0]);
    if (pa) out.push(decodeURIComponentSafe(pa[1]));
  }
  const withoutUris = text.replace(UPI_URI, " ");
  for (const m of withoutUris.matchAll(UPI_LIKE)) out.push(m[0]);
  return out;
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function containsPaymentId(text: string, known: readonly string[] = []): boolean {
  if (findPaymentIds(text).length > 0) return true;
  const lower = text.toLowerCase();
  return known.some((k) => k.trim() !== "" && lower.includes(k.trim().toLowerCase()));
}

/**
 * Replaces UPI-like addresses and upi:// payment links with a placeholder. `known` addresses
 * (any scheme) are removed too, case-insensitively, even when they do not look like UPI.
 */
export function redactPaymentIds(text: string, opts: { known?: readonly string[] } = {}): string {
  let out = text.replace(UPI_URI, REDACTED_PAYMENT_ID).replace(UPI_LIKE, REDACTED_PAYMENT_ID);
  for (const k of opts.known ?? []) {
    const t = k.trim();
    if (t) out = out.replace(new RegExp(escapeRe(t), "gi"), REDACTED_PAYMENT_ID);
  }
  return out;
}

/** Applies redactPaymentIds to strings in a nested value (objects, arrays), for prompt inputs. */
export function redactDeep<T>(value: T, opts: { known?: readonly string[] } = {}): T {
  if (typeof value === "string") return redactPaymentIds(value, opts) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, opts)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v, opts)])) as T;
  }
  return value;
}

/** True if the text has a payment-looking address that is not one of `allowed` (exact, case-insensitive). */
export function foreignPaymentIds(text: string, allowed: readonly string[]): string[] {
  const ok = new Set(allowed.map((a) => a.trim().toLowerCase()));
  return findPaymentIds(text).filter((id) => !ok.has(id.toLowerCase()));
}
