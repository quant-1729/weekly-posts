// \p{M} (marks) is needed for scripts such as Devanagari, where vowel signs are marks.
const LOCAL = /^[\p{L}\p{M}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{M}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u;
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?$/u;

/**
 * Trims and lowercases an email address and checks its shape. Returns null if
 * it is not a plausible address. No whitespace, quotes, angle brackets or
 * commas are accepted, so the value is safe to put in a header or a "to" field.
 * A plus tag (a+b@x.com) is kept: it is a different mailbox name to us.
 */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;

  const at = email.lastIndexOf("@");
  if (at < 1 || email.indexOf("@") !== at) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL.test(local)) return null;

  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((l) => l.length === 0 || l.length > 63 || !LABEL.test(l))) {
    return null;
  }
  return email;
}
