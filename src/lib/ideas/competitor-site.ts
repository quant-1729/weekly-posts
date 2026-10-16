// Competitor websites (R-3). The existing website reader loads the competitor's home page and up to two more pages
// (robots.txt is respected: a blocked site is simply skipped). One model call summarises what the pages promote, in
// general terms, as findings of kind "competitor".
//
// Dating: a page is a usable source only when it shows a date itself (a post date, "updated on ...") inside the
// window; the source is then dated by the fetch date (today in the brand's time zone). A page that shows no date
// is skipped, like any undated source.
//
// NOTE FOR THE ORCHESTRATOR: this is the only prompt in the Ideas code that is not in src/lib/ai/prompts/ideas.ts
// (that file has no competitor-site prompt). It is kept here so the prompt file stays unchanged; move it there if you
// want all prompts in one place.

import { COMPETITOR_SITE_SYSTEM, buildCompetitorSiteUser } from "@/lib/ai/prompts/ideas";
import { redactPaymentIds } from "@/lib/payments/redact";
import type { ResearchDeps } from "./deps";
export { COMPETITOR_SITE_SYSTEM };
import { hostOf, oneLine, type GatheredFinding } from "./findings";
import { siteSummaryJsonSchema, siteSummarySchema } from "./schemas";
import type { Competitor } from "./types";
import { inWindow, type ResearchWindow } from "./window";

export const SITE_PAGES = 3; // the home page plus at most 2 more
export const SITE_TEXT_PER_PAGE = 2500;

export interface SiteResult {
  findings: GatheredFinding[];
  usd: number;
  /** Why nothing was returned: robots/blocked/failed read, no date on the page, or no website. */
  skipped: "no_website" | "not_readable" | "undated" | null;
}

export async function readCompetitorSite(
  brandId: string,
  competitor: Competitor,
  w: ResearchWindow,
  deps: Pick<ResearchDeps, "ai" | "loadSite">,
): Promise<SiteResult> {
  if (!competitor.website) return { findings: [], usd: 0, skipped: "no_website" };
  const loaded = await deps.loadSite(competitor.website);
  if ((loaded.status !== "ok" && loaded.status !== "partial") || loaded.pages.length === 0) return { findings: [], usd: 0, skipped: "not_readable" };

  const pages = loaded.pages.slice(0, SITE_PAGES).map((p) => ({
    url: p.url,
    title: oneLine(redactPaymentIds(p.title), 120),
    text: redactPaymentIds(p.text).slice(0, SITE_TEXT_PER_PAGE),
  }));
  const { data, stats } = await deps.ai.json({
    system: COMPETITOR_SITE_SYSTEM,
    user: buildCompetitorSiteUser(redactPaymentIds(competitor.name), pages),
    zodSchema: siteSummarySchema,
    jsonSchema: siteSummaryJsonSchema,
    temperature: 0.3,
    fixture: () => ({ findings: [], page_date: "" }),
    logContext: { brandId },
  });
  const usd = stats?.usd ?? 0;
  // What a competitor's site promotes is current as of today's read; a page that shows an OLD date is stale and skipped.
  const shown = data.page_date.trim();
  const pageDate = shown === "" ? w.end : shown;
  if (!inWindow(pageDate, w)) return { findings: [], usd, skipped: "undated" };

  const home = pages[0];
  const site = hostOf(home.url) || hostOf(competitor.website);
  const findings: GatheredFinding[] = [];
  for (const f of data.findings.slice(0, 3)) {
    const topic = oneLine(redactPaymentIds(f.topic), 80);
    const note = oneLine(redactPaymentIds(f.note), 300);
    if (!topic || !note) continue;
    findings.push({
      topic,
      note,
      sources: [{ url: home.url, title: home.title || competitor.name, site, publishedAt: w.end, kind: "competitor_site" }],
      kind: "competitor",
      velocity: null,
    });
  }
  return { findings, usd, skipped: null };
}
