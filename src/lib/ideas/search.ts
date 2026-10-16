// Grounded web search (R-2): each "web" query is one Gemini call with Google Search grounding. The answer is
// read in code, not trusted:
//  - sources come from the grounding metadata (link, title, site), never from the model's text;
//  - a source needs a date inside the run's window. Grounding gives none, so the model is asked for the date per
//    source index; an undated or out-of-window source is dropped, and a finding with no source left is dropped;
//  - the model's notes are our own one-line summaries; nothing is copied from a post or a comment.
//
// The redirect links Google returns (vertexaisearch.cloud.google.com/...) are kept as given: there is no safe
// fetch helper for resolving them here, and they open the source for the owner. The site shown comes from
// the grounding "domain" or, failing that, the title when it is a domain.

import { IDEAS_SEARCH_SYSTEM, buildIdeasSearchUser, type IdeasBrandContext } from "@/lib/ai/prompts/ideas";
import type { GroundedResult } from "@/lib/ai/client";
import { redactPaymentIds } from "@/lib/payments/redact";
import type { AiDeps } from "./deps";
import { hostOf, isWebUrl, oneLine, tokens, type GatheredFinding } from "./findings";
import { searchAnswerSchema, type SearchAnswer } from "./schemas";
import type { PlannedQuery, TrendKind, TrendSource } from "./types";
import { inWindow, type ResearchWindow } from "./window";

export const MAX_SOURCES_PER_FINDING = 4;
const TOPIC_MAX = 80;
const NOTE_MAX = 300;
const TITLE_MAX = 200;

/**
 * Added to the search prompt in code: the prompt asks for source indexes but not for the date of each source,
 * and the date is what decides whether a source may be used.
 */
/** The per-source date request now lives in the search prompt (buildIdeasSearchUser); kept for tests that look for it. */
export const SOURCE_DATES_REQUEST = '"source_dates"';

export interface SearchDrops {
  /** Sources dropped because the model gave no usable date. */
  undated: number;
  /** Sources dropped because their date is outside the window. */
  outOfWindow: number;
  /** Findings dropped because no usable source was left (or none could be linked). */
  findings: number;
}

export interface ParsedSearch {
  findings: GatheredFinding[];
  drops: SearchDrops;
}

/** The first JSON object in a model answer (it may be wrapped in a code fence or sentences). Null when there is none. */
export function extractJsonObject(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, " ");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

const DOMAIN_LIKE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

/** The site name of a grounding chunk: its domain, else the title when that is a domain, else the link's host (unless that is Google's redirect). */
export function siteOf(chunk: { uri: string; title: string; domain: string }): string {
  const domain = chunk.domain.trim().toLowerCase().replace(/^www\./, "");
  if (domain && DOMAIN_LIKE.test(domain)) return domain;
  const title = chunk.title.trim().toLowerCase().replace(/^www\./, "");
  if (DOMAIN_LIKE.test(title)) return title;
  const host = hostOf(chunk.uri);
  if (host && !host.endsWith("google.com")) return host;
  return "web";
}

/** The kind a web finding gets from the query that found it. */
export function kindForQuery(q: PlannedQuery, competitorNames: string[]): TrendKind {
  const text = `${q.q} ${q.why}`.toLowerCase();
  if (competitorNames.some((n) => n.trim() && text.includes(n.trim().toLowerCase()))) return "competitor";
  if (/\b(festival|holiday|season|seasonal|event|events|upcoming|celebration|diwali|christmas|eid|easter|halloween|new year|black friday)\b/.test(text)) return "seasonal";
  return "trend";
}

/** Chunk indexes whose supported sentence shares enough words with the finding (used when the model gave no usable indexes). */
function indexesFromSupports(g: GroundedResult, topic: string, note: string): number[] {
  const want = tokens(`${topic} ${note}`);
  if (want.length === 0) return [];
  const out: number[] = [];
  for (const sp of g.supports) {
    const have = new Set(tokens(sp.text));
    if (have.size === 0) continue;
    const shared = want.filter((w) => have.has(w)).length;
    if (shared / Math.min(want.length, have.size) >= 0.5 && shared >= 2) {
      for (const i of sp.chunkIndices) if (!out.includes(i)) out.push(i);
    }
  }
  return out;
}

/** Reads one grounded answer into findings with dated sources. Pure. */
export function parseGroundedAnswer(g: GroundedResult, w: ResearchWindow, kind: TrendKind): ParsedSearch {
  const drops: SearchDrops = { undated: 0, outOfWindow: 0, findings: 0 };
  const raw = extractJsonObject(g.text);
  const parsed = searchAnswerSchema.safeParse(raw);
  if (!parsed.success) return { findings: [], drops };
  const answer: SearchAnswer = parsed.data;

  const dateByIndex = new Map<number, string>();
  for (const d of answer.source_dates) if (!dateByIndex.has(d.index)) dateByIndex.set(d.index, d.date.trim());

  // A source is usable when it has a web link and a date inside the window. Each index is judged once.
  const usable = new Map<number, TrendSource | null>();
  const judge = (i: number): TrendSource | null => {
    if (usable.has(i)) return usable.get(i)!;
    let result: TrendSource | null = null;
    const chunk = g.chunks[i];
    if (chunk && isWebUrl(chunk.uri)) {
      const date = dateByIndex.get(i);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) drops.undated++;
      else if (!inWindow(date, w)) drops.outOfWindow++;
      else {
        result = {
          url: chunk.uri,
          title: oneLine(redactPaymentIds(chunk.title || siteOf(chunk)), TITLE_MAX) || siteOf(chunk),
          site: siteOf(chunk),
          publishedAt: date,
          kind: "web",
        };
      }
    }
    usable.set(i, result);
    return result;
  };

  const findings: GatheredFinding[] = [];
  for (const f of answer.findings) {
    const topic = oneLine(redactPaymentIds(f.topic), TOPIC_MAX);
    const note = oneLine(redactPaymentIds(f.note), NOTE_MAX);
    if (!topic || !note) {
      drops.findings++;
      continue;
    }
    let indexes = [...new Set(f.source_indexes)].filter((i) => i < g.chunks.length);
    if (indexes.length === 0) indexes = indexesFromSupports(g, topic, note);
    const sources: TrendSource[] = [];
    for (const i of indexes) {
      const s = judge(i);
      if (s && !sources.some((x) => x.url === s.url)) sources.push(s);
      if (sources.length >= MAX_SOURCES_PER_FINDING) break;
    }
    if (sources.length === 0) {
      drops.findings++;
      continue;
    }
    findings.push({ topic, note, sources, kind, velocity: null });
  }
  return { findings, drops };
}

export interface SearchResult extends ParsedSearch {
  usd: number;
  /** False when the call failed or returned nothing readable. */
  answered: boolean;
}

/** Runs one grounded query. Throws when the call itself fails (the run counts that as a source error). */
export async function runGroundedQuery(
  brand: IdeasBrandContext,
  query: PlannedQuery,
  w: ResearchWindow,
  o: { brandId: string; kind: TrendKind },
  ai: AiDeps,
): Promise<SearchResult> {
  const user = buildIdeasSearchUser(brand, query.q, { start: w.start, end: w.end, today: w.end });
  const g = await ai.grounded({
    system: IDEAS_SEARCH_SYSTEM,
    user,
    fixture: () => fixtureGrounded(query, w),
    timeoutMs: 30_000,
    budgetMs: 45_000,
    logContext: { brandId: o.brandId },
  });
  const parsed = parseGroundedAnswer(g, w, o.kind);
  return { ...parsed, usd: g.stats?.usd ?? 0, answered: true };
}

/** Offline answer for AI_MODE=fixture without scripted dependencies. */
export function fixtureGrounded(query: PlannedQuery, w: ResearchWindow): Omit<GroundedResult, "stats"> {
  return {
    text: JSON.stringify({
      findings: [{ topic: query.q.slice(0, 60), note: `People are talking about ${query.q.slice(0, 60)}.`, source_indexes: [0] }],
      source_dates: [{ index: 0, date: w.end }],
    }),
    chunks: [{ uri: "https://example.com/trend", title: "example.com", domain: "example.com" }],
    supports: [],
  };
}
