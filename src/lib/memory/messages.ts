import { fill, s } from "@/lib/i18n/strings";

/** Plain words for the result of "Read my website again". No server dependencies; safe in the browser. */
export function rereadMessage(o: {
  status: string;
  websiteUrl: string | null;
  pagesRead: number;
  factsSaved: number;
  reason: string | null;
  /** Facts left out because the owner's own version stays. */
  factsSkippedOwnerEdited?: number;
  /** The read was for a new address. */
  addressChanged?: boolean;
}): string {
  const t = s.brandV2.facts.reread;
  if (o.websiteUrl === null) return t.removed;
  if ((o.status === "blocked" || o.status === "failed") && o.addressChanged) return t.failedNewAddress;
  if (o.status === "blocked") return t.blocked;
  if (o.status === "failed") {
    if (o.reason === "ai_failed") return t.aiFailed;
    return o.reason === "no_text" ? t.failedNoText : t.failed; // no_text: the address loaded fine, so do not ask to check it
  }
  if (o.reason === "js_only_meta") return t.jsOnly + (o.factsSkippedOwnerEdited ? ` ${fill(t.keptEdited, { n: o.factsSkippedOwnerEdited })}` : "");
  const pages = fill(o.pagesRead === 1 ? t.pages.one : t.pages.other, { n: o.pagesRead });
  const facts = fill(o.factsSaved === 1 ? t.facts.one : t.facts.other, { n: o.factsSaved });
  const kept = o.factsSkippedOwnerEdited ? ` ${fill(t.keptEdited, { n: o.factsSkippedOwnerEdited })}` : "";
  if (o.factsSaved === 0) return fill(t.noFacts, { pages }) + kept;
  return fill(o.status === "partial" ? t.partial : t.ok, { pages, facts }) + kept;
}

/**
 * A line about the last saved read, for the Brand page after a reload (the click result has its own message).
 * Only the cases that need an explanation; null otherwise.
 */
export function savedReadNote(status: string, reason: string | null): string | null {
  const t = s.brandV2.facts.reread;
  if (status === "partial" && reason === "js_only_meta") return t.jsOnly;
  if (status === "failed" && reason === "no_text") return t.failedNoText;
  return null;
}

/** "14 Oct 2026" for a "YYYY-MM-DD" date, without any time zone shift. */
export function formatDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
