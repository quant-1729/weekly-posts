// Pure display helpers. No database, no secrets.

/** "jane.doe@gmail.com" -> "j***@g***.com". Anything that is not an email address becomes "***". */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(no email)";
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${[...local][0]}***@${[...host][0] ?? ""}***${tld}`;
}

/** UTC timestamp for tables: "2026-10-15 14:03". */
export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export function fmtUsd(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0.00";
  return `$${v.toFixed(v !== 0 && Math.abs(v) < 0.1 ? 4 : 2)}`;
}

export function ago(v: string | Date | null | undefined, now = Date.now()): string {
  if (!v) return "";
  const t = (v instanceof Date ? v : new Date(v)).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function countryName(code: string | null | undefined): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const SECRETISH = /(text|caption|note|descr|payment|upi|token|secret|password|email|body|phone|address|message|prompt|url|link|key|iban|account)/i;

/**
 * app_events.detail is meant to hold only short codes, but the dashboard does not trust that: keys that smell like
 * content or secrets are dropped, strings are cut short, nested values are not shown.
 */
export function safeDetail(detail: unknown): string {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(detail as Record<string, unknown>).slice(0, 8)) {
    if (SECRETISH.test(k)) continue;
    if (typeof v === "string") {
      if (v.length > 60) continue;
      parts.push(`${k}=${v}`);
    } else if (typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.join(" ");
}

/** Queue errors are shown trimmed: URLs, long digit runs and token-like strings are removed, 160 characters at most. */
export function cleanError(e: string | null | undefined): string {
  if (!e) return "";
  return e
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b(bearer|token|key|secret)[=: ]+\S+/gi, "$1 [hidden]")
    .replace(/[A-Za-z0-9_\-]{28,}/g, "[hidden]")
    .replace(/\d{9,}/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Only http(s) links are ever rendered as links. */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null;
  } catch {
    return null;
  }
}
