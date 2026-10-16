import { vi } from "vitest";
import type { CallStats, GroundedResult } from "@/lib/ai/client";
import { IDEAS_CARDS_SYSTEM, IDEAS_PLAN_SYSTEM, IDEAS_SEARCH_SYSTEM } from "@/lib/ai/prompts/ideas";
import type { ConnectionView } from "@/lib/connections/types";
import type { MockDb } from "@/lib/db/mock";
import { COMPETITOR_SITE_SYSTEM } from "@/lib/ideas/competitor-site";
import type { ResearchDeps } from "@/lib/ideas/deps";
import { researchWindow, type ResearchWindow } from "@/lib/ideas/window";
import type { LoadResult } from "@/lib/website/load";
import { makeOwner, type Owner } from "../helpers/details";

export { openDb, closeDb } from "../helpers/details";

/** Thursday 15 Oct 2026, 10:00 UTC (11:00 in London). */
export const NOW = new Date("2026-10-15T10:00:00Z");
export const TZ = "Europe/London";
export const WINDOW: ResearchWindow = researchWindow(NOW, TZ);

export interface Shop extends Owner {
  name: string;
}

export async function makeShop(db: MockDb, o: { name?: string; country?: string; city?: string; category?: string } = {}): Promise<Shop> {
  const name = o.name ?? "Corner Bakery";
  const owner = await makeOwner(db, { name, country: o.country ?? "GB", timezone: TZ, city: o.city ?? "Leeds" });
  await db.withAdmin((tx) => tx.query("update public.brand_memory set category = $2, audience = 'Families nearby' where brand_id = $1", [owner.brandId, o.category ?? "bakery and cakes"]));
  return { ...owner, name };
}

export const rows = <T,>(db: MockDb, sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<T>(sql, params));

export const dnsOk = async () => [{ address: "93.184.216.34" }];

// ---------------------------------------------------------------------------------------------
// Scripted AI
// ---------------------------------------------------------------------------------------------

const stat = (usd: number): CallStats => ({ model: "test", ms: 1, inputTokens: 100, outputTokens: 50, usd });

export interface Script {
  /** Queries the planner returns. */
  plan?: { q: string; source: "web" | "youtube"; why: string }[];
  /** Grounded answer by query text (a function gets the query). */
  grounded?: (query: string) => Omit<GroundedResult, "stats"> | Error;
  /** Competitor-site summary. */
  site?: { findings: { topic: string; note: string }[]; page_date: string };
  /** Cards from the findings given to the cards call. */
  cards?: (findings: { id: string; topic: string }[]) => unknown[];
  /** Dollars each call reports. */
  usd?: { plan?: number; grounded?: number; site?: number; cards?: number };
}

export interface Recorder {
  prompts: string[];
  planCalls: number;
  groundedCalls: number;
  siteCalls: number;
  cardsCalls: number;
}

export const dated = (i: number, date = "2026-10-10") => ({ index: i, date });

/** A grounded answer with one finding that has one source dated `date`. */
export function groundedAnswer(topic: string, note: string, date: string | "" = "2026-10-10", uri = "https://news.example.com/a"): Omit<GroundedResult, "stats"> {
  return {
    text: JSON.stringify({ findings: [{ topic, note, source_indexes: [0] }], source_dates: [{ index: 0, date }] }),
    chunks: [{ uri, title: "news.example.com", domain: "news.example.com" }],
    supports: [],
  };
}

export function scriptedAi(script: Script): { ai: ResearchDeps["ai"]; rec: Recorder } {
  const rec: Recorder = { prompts: [], planCalls: 0, groundedCalls: 0, siteCalls: 0, cardsCalls: 0 };
  const usd = { plan: 0.002, grounded: 0.039, site: 0.005, cards: 0.01, ...(script.usd ?? {}) };
  const json = vi.fn(async (args: { system: string; user: string; zodSchema: { parse: (v: unknown) => unknown } }) => {
    rec.prompts.push(args.system, args.user);
    if (args.system === IDEAS_PLAN_SYSTEM) {
      rec.planCalls++;
      return { data: args.zodSchema.parse({ queries: script.plan ?? [] }), stats: stat(usd.plan) };
    }
    if (args.system === COMPETITOR_SITE_SYSTEM) {
      rec.siteCalls++;
      return { data: args.zodSchema.parse(script.site ?? { findings: [], page_date: "" }), stats: stat(usd.site) };
    }
    if (args.system === IDEAS_CARDS_SYSTEM) {
      rec.cardsCalls++;
      const findings = JSON.parse(args.user.split("FINDINGS:\n")[1].split("\n\n")[0]) as { id: string; topic: string }[];
      return { data: args.zodSchema.parse({ cards: script.cards ? script.cards(findings) : [] }), stats: stat(usd.cards) };
    }
    throw new Error("unexpected prompt");
  });
  const grounded = vi.fn(async (args: { system: string; user: string }) => {
    rec.prompts.push(args.system, args.user);
    if (args.system !== IDEAS_SEARCH_SYSTEM) throw new Error("unexpected grounded prompt");
    rec.groundedCalls++;
    const query = /SEARCH: (.*)/.exec(args.user)?.[1] ?? "";
    const out = script.grounded ? script.grounded(query) : groundedAnswer(query, `Note about ${query}.`);
    if (out instanceof Error) throw out;
    return { ...out, stats: stat(usd.grounded) };
  });
  return { ai: { json, grounded } as unknown as ResearchDeps["ai"], rec };
}

/** A card that cites the findings by id, with one clean idea. */
export const simpleCard = (ids: string[], title = "Autumn bakes", description = "A post about our autumn bakes, inviting people to come in and try them") => ({
  finding_ids: ids,
  title,
  summary: "People are looking for autumn bakes.",
  why_it_matters: "It fits what you sell.",
  kind: "trend",
  confidence: "medium",
  ideas: [{ post_type: "announcement", angle: "Autumn bakes", format: "single", description }],
});

export function okSite(url = "https://rival.example.com/"): LoadResult {
  return {
    status: "ok",
    reason: null,
    homeUrl: url,
    pages: [{ url, title: "Rival Bakes", metaDescription: "", text: "We are baking pumpkin loaves this season. Posted 12 October." }],
    skipped: [],
    logoCandidates: [],
    themeColor: null,
    robotsFetched: [],
    readerPages: [],
    socialSources: [],
  };
}

export const noConnection: ResearchDeps["getConnection"] = async () => null;
export const noToken: ResearchDeps["readToken"] = async () => {
  throw new Error("no token expected");
};

export const facebookConnection = (brandId: string): ConnectionView => ({
  id: "11111111-1111-1111-1111-111111111111",
  brandId,
  provider: "facebook",
  accountId: "100200300",
  accountName: "Page",
  status: "active",
  expiresAt: null,
  lastError: null,
  connectedAt: NOW.toISOString(),
  expiresSoon: false,
});

/** Dependencies for a run with everything else switched off: no site loads, no network, no connection. */
export function baseDeps(ai: ResearchDeps["ai"], over: Partial<ResearchDeps> = {}): Partial<ResearchDeps> {
  return {
    ai,
    loadSite: async () => {
      throw new Error("no site expected");
    },
    fetch: async () => {
      throw new Error("no network expected");
    },
    getConnection: noConnection,
    readToken: noToken,
    env: {},
    ...over,
  };
}
