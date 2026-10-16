// Trend cards and post ideas (R-5). One model call (IDEAS_CARDS_SYSTEM) turns the ranked findings into cards; then
// code is the reviewer. A card is kept only when:
//  - it points at findings we gave it, and at least one source is dated inside the window ("reviewer" rule: no
//    dated source, no card);
//  - title, summary and why-it-matters are inside the database limits;
//  - it has at least one idea left after the checks below.
// An idea is kept only when:
//  - its post type is valid;
//  - after prices, numbers, dates, ratings, statistics, contact details and superlative or guarantee claims are
//    removed (each removal flagged "from research, please check"), it still reads as a description;
//  - the deterministic guardrail passes: no word the owner avoids; for a regulated brand no outcome promise.

import { IDEAS_CARDS_SYSTEM, buildIdeasCardsUser, type IdeasBrandContext, type IdeasFindingInput } from "@/lib/ai/prompts/ideas";
import { POST_TYPES, type PostType } from "@/lib/briefs/types";
import { checkPostDeterministic } from "@/lib/guardrail/deterministic";
import { redactPaymentIds } from "@/lib/payments/redact";
import type { AiDeps } from "./deps";
import { oneLine, type ScoredFinding } from "./findings";
import { cardsEnvelopeSchema, cardsJsonSchema, rawCardSchema, type RawCard } from "./schemas";
import { stripClaims, tidy } from "./strip";
import { IDEAS_PER_CARD, MAX_CARDS, type Confidence, type IdeaFormat, type TrendKind, type TrendSource } from "./types";
import { inWindow, type ResearchWindow } from "./window";

export const TITLE_MAX = 120;
export const SUMMARY_MAX = 600;
export const WHY_MAX = 400;
export const ANGLE_MAX = 120;
export const DESCRIPTION_MAX = 600;
export const DESCRIPTION_MIN_CHARS = 12;
export const DESCRIPTION_MIN_WORDS = 3;
/** The database allows 12 sources per card; a card shows its freshest few. */
export const SOURCES_PER_CARD = 6;

export interface IdeaDraft {
  postType: PostType;
  angle: string;
  description: string;
  format: IdeaFormat | null;
  flags: string[];
}

export interface CardDraft {
  findingIds: string[];
  title: string;
  summary: string;
  whyItMatters: string;
  kind: TrendKind;
  sources: TrendSource[];
  score: number;
  velocity: number | null;
  confidence: Confidence;
  ideas: IdeaDraft[];
}

export type DropReason =
  | "bad_card"
  | "unknown_findings"
  | "no_dated_source"
  | "bad_title"
  | "bad_summary"
  | "bad_why"
  | "duplicate_findings"
  | "no_ideas";
export type IdeaDropReason = "bad_post_type" | "bad_angle" | "empty" | "too_short" | "payment_id" | "avoid_word" | "regulated_claim" | "leftover_detail";

export interface CardsOutcome {
  cards: CardDraft[];
  droppedCards: DropReason[];
  droppedIdeas: IdeaDropReason[];
}

const FORMATS: readonly IdeaFormat[] = ["single", "carousel", "story", "reel"];
const KINDS: readonly TrendKind[] = ["trend", "competitor", "seasonal"];
const CONFIDENCES: readonly Confidence[] = ["low", "medium", "high"];

const clean = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

export type IdeaScreen = { ok: true; text: string; flags: string[] } | { ok: false; reason: IdeaDropReason };

/** Removes research claims from a description, then runs the deterministic guardrail. Pure. */
export function screenIdea(description: string, o: { regulated: IdeasBrandContext["regulated"]; wordsToAvoid: string[] }): IdeaScreen {
  const raw = clean(description);
  if (!raw) return { ok: false, reason: "empty" };
  if (redactPaymentIds(raw) !== raw) return { ok: false, reason: "payment_id" };
  const stripped = stripClaims(raw);
  let text = stripped.text;
  const flags = [...stripped.flags];

  const det = checkPostDeterministic({
    post: { channel: "instagram", caption: text, cta: "", hashtags: [], image_text: { headline: "", subline: "" } },
    facts: [], // research has no facts of the brand to lean on: nothing is supported
    regulated: o.regulated,
    wordsToAvoid: o.wordsToAvoid,
  });
  const cut: { start: number; end: number; label: string }[] = [];
  for (const i of det.issues) {
    if (i.code === "avoid") return { ok: false, reason: "avoid_word" };
    if (i.code === "unsupported_phrase") {
      // A promise of outcomes is never allowed for a regulated brand; for others the phrase is removed and flagged.
      if (o.regulated !== "none" || i.regulated) return { ok: false, reason: "regulated_claim" };
    }
    if (i.start < 0 || i.end <= i.start) return { ok: false, reason: "leftover_detail" };
    cut.push({ start: i.start, end: i.end, label: i.text });
  }
  if (cut.length > 0) {
    cut.sort((a, b) => b.start - a.start);
    for (const c of cut) text = text.slice(0, c.start) + " " + text.slice(c.end);
    text = tidy(text);
    for (const c of cut.reverse()) flags.push(`from research, please check: removed a claim (${c.label.slice(0, 40)})`);
  }

  text = oneLine(text, DESCRIPTION_MAX);
  if ([...text].length < DESCRIPTION_MIN_CHARS || words(text) < DESCRIPTION_MIN_WORDS) return { ok: false, reason: "too_short" };
  return { ok: true, text, flags };
}

function distinctSites(sources: TrendSource[]): number {
  return new Set(sources.map((s) => s.site)).size;
}

/** A card's confidence: the model's, lowered when the sources do not support it. */
export function confidenceFor(claimed: string | undefined, sources: TrendSource[]): Confidence {
  let c: Confidence = CONFIDENCES.includes(claimed as Confidence) ? (claimed as Confidence) : "low";
  if (c === "high" && (sources.length < 2 || distinctSites(sources) < 2)) c = "medium"; // high needs 2+ independent sources
  if (c === "medium" && sources.length < 1) c = "low";
  return c;
}

/**
 * Checks the model's cards one by one against the findings we gave it. Pure: same input, same output.
 * Cards with no dated source inside the window, or with a title or summary outside the limits, are dropped.
 */
export function validateCards(
  rawCards: unknown[],
  findings: ScoredFinding[],
  o: { window: ResearchWindow; regulated: IdeasBrandContext["regulated"]; wordsToAvoid: string[]; maxCards?: number; ideasPerCard?: number },
): CardsOutcome {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const used = new Set<string>();
  const outcome: CardsOutcome = { cards: [], droppedCards: [], droppedIdeas: [] };
  const maxCards = o.maxCards ?? MAX_CARDS;
  const perCard = o.ideasPerCard ?? IDEAS_PER_CARD;

  for (const item of rawCards) {
    const parsed = rawCardSchema.safeParse(item);
    if (!parsed.success) {
      outcome.droppedCards.push("bad_card");
      continue;
    }
    const raw: RawCard = parsed.data;
    const ids = [...new Set(raw.finding_ids)].filter((id) => byId.has(id));
    if (ids.length === 0) {
      outcome.droppedCards.push("unknown_findings");
      continue;
    }
    if (ids.every((id) => used.has(id))) {
      outcome.droppedCards.push("duplicate_findings");
      continue;
    }
    const used_ = ids.map((id) => byId.get(id)!);

    // Reviewer rule: every source must be dated inside the window; with none left there is no card.
    const sources: TrendSource[] = [];
    for (const f of used_) {
      for (const s of f.sources) if (inWindow(s.publishedAt, o.window) && !sources.some((x) => x.url === s.url)) sources.push(s);
    }
    if (sources.length === 0) {
      outcome.droppedCards.push("no_dated_source");
      continue;
    }
    sources.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.url.localeCompare(b.url));

    const title = clean(raw.title);
    const summary = clean(raw.summary);
    const why = clean(raw.why_it_matters);
    if (title.length < 1 || [...title].length > TITLE_MAX) {
      outcome.droppedCards.push("bad_title");
      continue;
    }
    if (summary.length < 1 || [...summary].length > SUMMARY_MAX) {
      outcome.droppedCards.push("bad_summary");
      continue;
    }
    if (why.length < 1 || [...why].length > WHY_MAX) {
      outcome.droppedCards.push("bad_why");
      continue;
    }

    const ideas: IdeaDraft[] = [];
    for (const idea of raw.ideas) {
      if (ideas.length >= perCard) break;
      if (!(POST_TYPES as readonly string[]).includes(idea.post_type)) {
        outcome.droppedIdeas.push("bad_post_type");
        continue;
      }
      const angle = clean(idea.angle);
      if (angle.length < 1 || [...angle].length > ANGLE_MAX) {
        outcome.droppedIdeas.push("bad_angle");
        continue;
      }
      const screened = screenIdea(idea.description, { regulated: o.regulated, wordsToAvoid: o.wordsToAvoid });
      if (!screened.ok) {
        outcome.droppedIdeas.push(screened.reason);
        continue;
      }
      ideas.push({
        postType: idea.post_type as PostType,
        angle,
        description: screened.text,
        format: FORMATS.includes(idea.format as IdeaFormat) ? (idea.format as IdeaFormat) : null,
        flags: screened.flags,
      });
    }
    if (ideas.length === 0) {
      outcome.droppedCards.push("no_ideas");
      continue;
    }

    for (const id of ids) used.add(id);
    const velocities = used_.map((f) => f.velocity).filter((v): v is number => v !== null);
    const kind: TrendKind = used_.every((f) => f.kind === "competitor")
      ? "competitor"
      : KINDS.includes(raw.kind as TrendKind)
        ? (raw.kind as TrendKind)
        : used_[0].kind;
    outcome.cards.push({
      findingIds: ids,
      title,
      summary,
      whyItMatters: why,
      kind,
      sources: sources.slice(0, SOURCES_PER_CARD),
      score: Math.max(...used_.map((f) => f.score)),
      velocity: velocities.length ? Math.max(...velocities) : null,
      confidence: confidenceFor(raw.confidence, sources),
      ideas,
    });
  }
  outcome.cards.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  if (outcome.cards.length > maxCards) outcome.cards.length = maxCards;
  return outcome;
}

export function findingsForPrompt(findings: ScoredFinding[]): IdeasFindingInput[] {
  return findings.map((f) => ({
    id: f.id,
    topic: f.topic,
    note: f.note,
    kind: f.kind,
    score: f.score,
    sources: f.sources.map((s) => ({ site: s.site, title: s.title, publishedAt: s.publishedAt })),
  }));
}

export interface MakeCardsResult extends CardsOutcome {
  usd: number;
}

export async function makeCards(
  brand: IdeasBrandContext,
  findings: ScoredFinding[],
  o: { window: ResearchWindow; brandId: string; wordsToAvoid: string[] },
  ai: AiDeps,
): Promise<MakeCardsResult> {
  if (findings.length === 0) return { cards: [], droppedCards: [], droppedIdeas: [], usd: 0 };
  const { data, stats } = await ai.json({
    system: IDEAS_CARDS_SYSTEM,
    user: buildIdeasCardsUser(brand, findingsForPrompt(findings), { maxCards: MAX_CARDS, ideasPerCard: IDEAS_PER_CARD, today: o.window.end }),
    zodSchema: cardsEnvelopeSchema,
    jsonSchema: cardsJsonSchema,
    temperature: 0.6,
    fixture: () => fixtureCards(findings),
    timeoutMs: 40_000,
    budgetMs: 60_000,
    logContext: { brandId: o.brandId },
  });
  const outcome = validateCards(data.cards, findings, { window: o.window, regulated: brand.regulated, wordsToAvoid: o.wordsToAvoid });
  return { ...outcome, usd: stats?.usd ?? 0 };
}

/** Offline cards for AI_MODE=fixture without scripted dependencies. */
export function fixtureCards(findings: ScoredFinding[]): { cards: RawCard[] } {
  return {
    cards: findings.slice(0, MAX_CARDS).map((f) => ({
      finding_ids: [f.id],
      title: oneLine(f.topic, 60),
      summary: f.note,
      why_it_matters: "It matches what your customers are looking at right now.",
      kind: f.kind,
      confidence: "medium",
      ideas: [
        { post_type: "announcement", angle: oneLine(f.topic, 50), format: "single", description: `A post about ${oneLine(f.topic, 60).toLowerCase()}, with [your offer] for customers.` },
      ],
    })),
  };
}
