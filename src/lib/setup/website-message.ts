import { fill, s } from "@/lib/i18n/strings";
import type { WebsiteReadSummary } from "./website";

function plural(forms: { one: string; other: string }, n: number): string {
  return fill(n === 1 ? forms.one : forms.other, { n });
}

/** The line the Done screen shows about the website read. No server dependencies except types; safe in the browser. */
export function websiteStatusMessage(summary: WebsiteReadSummary | null, gaveUp: boolean): { text: string; tone: "info" | "warn" } {
  const d = s.setupV2.done;
  if (!summary || summary.state === "reading") return { text: gaveUp ? d.websiteStillReading : d.websiteReading, tone: "info" };
  if (summary.state === "blocked" || summary.state === "failed") return { text: d.websiteFailed, tone: "warn" };
  if (summary.state === "partial" && summary.reason === "js_only_meta") return { text: d.websiteJsOnly, tone: "warn" };
  if (summary.facts === 0) return { text: d.websiteNoFacts, tone: "info" };
  return { text: fill(d.websiteDone, { pages: plural(d.pages, summary.pages), facts: plural(d.facts, summary.facts) }), tone: "info" };
}
