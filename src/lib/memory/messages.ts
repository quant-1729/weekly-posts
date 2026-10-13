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
  if (o.status === "failed") return o.reason === "ai_failed" ? t.aiFailed : t.failed;
  const pages = fill(o.pagesRead === 1 ? t.pages.one : t.pages.other, { n: o.pagesRead });
  const facts = fill(o.factsSaved === 1 ? t.facts.one : t.facts.other, { n: o.factsSaved });
  const kept = o.factsSkippedOwnerEdited ? ` ${fill(t.keptEdited, { n: o.factsSkippedOwnerEdited })}` : "";
  if (o.factsSaved === 0) return fill(t.noFacts, { pages }) + kept;
  return fill(o.status === "partial" ? t.partial : t.ok, { pages, facts }) + kept;
}

/** "14 Oct 2026" for a "YYYY-MM-DD" date, without any time zone shift. */
export function formatDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
