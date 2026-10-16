// Merge and score (R-5). Pure and deterministic: the same findings always give the same ids, scores and order.
//
// Merge: findings about the same story (from different searches or sources) become one, by normalised token overlap
// of their topics. Score (0-100): recency 30 + velocity 15 + engagement 25 + brand fit 30.

import { tokens, type GatheredFinding, type ScoredFinding } from "./findings";
import type { TrendKind, TrendSource } from "./types";
import { ageDays, type ResearchWindow } from "./window";
import { RESEARCH_WINDOW_DAYS } from "./types";

/** Two topics are the same story when this share of the shorter one's words is in the other (and at least 2 words are shared). */
export const MERGE_OVERLAP = 0.6;
/** Most findings sent to the cards prompt. */
export const MAX_FINDINGS_FOR_CARDS = 12;

export const SCORE_WEIGHTS = { recency: 30, velocity: 15, engagement: 25, fit: 30 } as const;
/** Engagement counts only when the finding fits the brand at least this much (the relevance floor). */
export const RELEVANCE_FLOOR = 0.2;
/** Engagement at which the engagement part is full (log scale). */
export const ENGAGEMENT_FULL = 100_000;

function topicTokens(f: GatheredFinding): string[] {
  const t = tokens(f.topic);
  return t.length >= 2 ? t : tokens(`${f.topic} ${f.note}`);
}

function similar(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bs = new Set(b);
  const shared = a.filter((x) => bs.has(x)).length;
  if (a.length === 1 && b.length === 1) return shared === 1;
  return shared >= 2 && shared / Math.min(a.length, b.length) >= MERGE_OVERLAP;
}

const KIND_PRIORITY: TrendKind[] = ["seasonal", "trend", "competitor"];

/** Findings about the same story become one: sources joined (by link), the richest finding's wording kept. */
export function mergeFindings(list: GatheredFinding[]): GatheredFinding[] {
  const ordered = [...list].sort((a, b) => b.sources.length - a.sources.length || a.topic.localeCompare(b.topic) || a.note.localeCompare(b.note));
  const clusters: { rep: GatheredFinding; tokens: string[]; members: GatheredFinding[] }[] = [];
  for (const f of ordered) {
    const t = topicTokens(f);
    const hit = clusters.find((c) => similar(c.tokens, t));
    if (hit) hit.members.push(f);
    else clusters.push({ rep: f, tokens: t, members: [f] });
  }
  return clusters.map(({ rep, members }) => {
    const sources: TrendSource[] = [];
    for (const m of members) for (const s of m.sources) if (!sources.some((x) => x.url === s.url)) sources.push(s);
    // A story that also has a non-competitor source is a trend; competitor only when every source is a competitor's.
    const kinds = new Set(members.map((m) => m.kind));
    const kind = KIND_PRIORITY.find((k) => kinds.has(k)) ?? rep.kind;
    const velocities = members.map((m) => m.velocity).filter((v): v is number => v !== null);
    return { topic: rep.topic, note: rep.note, sources, kind, velocity: velocities.length ? Math.max(...velocities) : null };
  });
}

export interface ScoreContext {
  window: ResearchWindow;
  /** Words from what the brand sells, its category, city and the owner's focus (see brandKeywords). */
  keywords: string[];
}

/** The words that say what matters to this brand. */
export function brandKeywords(b: { sells: string; category: string; city: string | null; focus: string | null }): string[] {
  return [...new Set([...tokens(b.sells), ...tokens(b.category), ...tokens(b.focus ?? ""), ...tokens(b.city ?? "")])].filter((w) => w.length >= 3);
}

function fitOf(f: GatheredFinding, keywords: string[]): number {
  if (keywords.length === 0) return 0.5; // nothing to compare with: neutral
  const have = new Set(tokens(`${f.topic} ${f.note} ${f.sources.map((s) => s.title).join(" ")}`));
  const matched = keywords.filter((k) => have.has(k)).length;
  return Math.min(1, matched / Math.min(3, keywords.length));
}

function engagementOf(f: GatheredFinding): number {
  let total = 0;
  for (const s of f.sources) {
    const e = s.engagement;
    if (e) total += (e.likes ?? 0) + (e.comments ?? 0) * 2 + (e.views ?? 0) * 0.05;
  }
  return total;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Score 0-100. */
export function scoreFinding(f: GatheredFinding, c: ScoreContext): number {
  const newest = Math.min(...f.sources.map((s) => ageDays(s.publishedAt, c.window)));
  const recency = SCORE_WEIGHTS.recency * Math.max(0, 1 - newest / RESEARCH_WINDOW_DAYS);
  const velocity = f.velocity === null ? 0 : SCORE_WEIGHTS.velocity * Math.max(0, Math.min(1, f.velocity / 100));
  const fit = fitOf(f, c.keywords);
  const engagement = fit >= RELEVANCE_FLOOR ? SCORE_WEIGHTS.engagement * Math.min(1, Math.log10(1 + engagementOf(f)) / Math.log10(1 + ENGAGEMENT_FULL)) : 0;
  return r2(Math.max(0, Math.min(100, recency + velocity + engagement + SCORE_WEIGHTS.fit * fit)));
}

/** Merge, score, rank (best first; ties by topic) and number the findings f1, f2, ... Keeps the best `limit`. */
export function rankFindings(list: GatheredFinding[], c: ScoreContext, limit = MAX_FINDINGS_FOR_CARDS): ScoredFinding[] {
  return mergeFindings(list)
    .map((f) => ({ f, score: scoreFinding(f, c) }))
    .sort((a, b) => b.score - a.score || a.f.topic.localeCompare(b.f.topic))
    .slice(0, limit)
    .map(({ f, score }, i) => ({ ...f, id: `f${i + 1}`, score }));
}
