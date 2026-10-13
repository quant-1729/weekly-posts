/**
 * Indian mobile numbers only. Accepts "98765 43210", "+91 98765 43210",
 * "91-98765-43210", "098765 43210" and returns "+919876543210", or null if the
 * input is not a valid Indian mobile number (10 digits starting 6-9).
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  // Allow only digits, spaces, dashes, parentheses and a single leading +.
  if (!/^\+?[\d\s\-()]+$/.test(s)) return null;
  const hadPlus = s.startsWith("+");
  s = s.replace(/\D/g, "");

  if (hadPlus) {
    if (!s.startsWith("91")) return null;
    s = s.slice(2);
  } else if (s.length === 12 && s.startsWith("91")) {
    s = s.slice(2);
  } else if (s.length === 11 && s.startsWith("0")) {
    s = s.slice(1);
  }

  return /^[6-9]\d{9}$/.test(s) ? `+91${s}` : null;
}
