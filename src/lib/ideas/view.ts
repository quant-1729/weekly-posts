// What the Ideas page shows (R-6): the last research, the live trend cards of the latest finished run with their
// ideas, "Research now" state, and what competitors posted lately. Read as the signed-in owner, so row-level
// security keeps it to the brand. Plain data, safe to send to a client component.

import { requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { addDaysIso, localDateIn, weekStartFor } from "@/lib/occasions/dates";
import type { PostType } from "@/lib/briefs/types";
import { businessDiscoveryEnabled } from "./competitor-instagram";
import { checkBudget, manualRunsThisWeek, type CapReason } from "./budget";
import { estimateRunUsd } from "./cost";
import {
  MANUAL_RUNS_PER_WEEK,
  MAX_CARDS,
  type CardStatus,
  type Confidence,
  type IdeaFormat,
  type IdeaStatus,
  type RunStatus,
  type SourceKind,
  type TrendKind,
  type TrendSource,
} from "./types";

/** Why "Research now" cannot be pressed. */
export type ResearchDisabled = "off" | "no_profile" | "manual_limit" | "research_cap" | "daily_cap";
export type Freshness = "week" | "lastWeek" | "month";

export interface IdeaView {
  id: string;
  postType: PostType;
  angle: string;
  description: string;
  format: IdeaFormat | null;
  flags: string[];
  status: Extract<IdeaStatus, "new" | "used">;
  briefId: string | null;
}

export interface CardView {
  id: string;
  title: string;
  summary: string;
  whyItMatters: string;
  kind: TrendKind;
  confidence: Confidence;
  sources: TrendSource[];
  freshness: Freshness;
  ideas: IdeaView[];
}

export interface CompetitorPostView {
  permalink: string;
  postedAt: string;
  format: "photo" | "video" | "carousel";
  likes: number | null;
  comments: number | null;
}

export interface CompetitorRecentView {
  competitorId: string;
  name: string;
  takenAt: string;
  posts: CompetitorPostView[];
  /** Link of the post with the most likes + comments. */
  bestPermalink: string | null;
}

export interface IdeasView {
  researchOn: boolean;
  hasProfile: boolean;
  /** When the last real run (not a capped attempt) finished, ISO; null when there was none. */
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  /** A run started in the last 10 minutes has not finished. */
  running: boolean;
  runsLeft: number;
  runsMax: number;
  /** Estimated cost of one run in USD, for the note beside the button. */
  runCostUsd: number;
  disabled: ResearchDisabled | null;
  /** Live cards (status new, not expired) of the latest finished run, newest first, at most MAX_CARDS. */
  cards: CardView[];
  /** The latest finished run made cards (so an empty list means they were dismissed or expired, not "nothing found"). */
  runMadeCards: boolean;
  competitors: {
    named: number;
    businessDiscovery: boolean;
    recent: CompetitorRecentView[];
  };
}

const RUNNING_STALE_MS = 10 * 60_000;
const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

/** Only web links are shown as links. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function freshnessOf(sources: TrendSource[], today: string): Freshness {
  const newest = sources.map((s) => s.publishedAt).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
  if (!newest) return "month";
  if (newest >= addDaysIso(today, -7)) return "week";
  if (newest >= addDaysIso(today, -14)) return "lastWeek";
  return "month";
}

interface CardRow {
  id: string;
  title: string;
  summary: string;
  why_it_matters: string;
  kind: TrendKind;
  sources: unknown;
  confidence: Confidence;
  status: CardStatus;
}
interface IdeaRow {
  id: string;
  card_id: string;
  post_type: PostType;
  angle: string;
  description: string;
  format: IdeaFormat | null;
  flags: unknown;
  status: IdeaStatus;
  brief_id: string | null;
}

/** Reads the stored sources (snake_case jsonb) into TrendSource, dropping anything that is not a web link. */
export function readSources(raw: unknown): TrendSource[] {
  if (!Array.isArray(raw)) return [];
  const out: TrendSource[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const url = safeHttpUrl(r?.url);
    if (!url) continue;
    out.push({
      url,
      title: String(r.title ?? "").slice(0, 200),
      site: String(r.site ?? "").slice(0, 100),
      publishedAt: String(r.published_at ?? r.publishedAt ?? ""),
      kind: (r.kind as SourceKind) ?? "web",
    });
  }
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function readRecent(raw: unknown): CompetitorPostView[] {
  if (!Array.isArray(raw)) return [];
  const out: CompetitorPostView[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const link = typeof r?.permalink === "string" && /^https:\/\/(www\.)?instagram\.com\//i.test(r.permalink) ? r.permalink : null;
    if (!link) continue;
    const format = r.format === "video" || r.format === "carousel" ? r.format : "photo";
    out.push({ permalink: link, postedAt: String(r.posted_at ?? ""), format, likes: num(r.likes), comments: num(r.comments) });
  }
  return out;
}

const REASON_FROM_CAP: Record<CapReason, ResearchDisabled> = {
  research_cap: "research_cap",
  weekly_cap: "research_cap",
  daily_cap: "daily_cap",
  manual_limit: "manual_limit",
};

export async function loadIdeasView(
  userId: string,
  brandId: string,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<IdeasView> {
  await requireBrandMember(userId, brandId);
  const data = await getDb().withUser(userId, async (tx) => {
    const [mem] = await tx.query<{ research_on: boolean; category: string | null; timezone: string }>(
      "select research_on, category, timezone from public.brand_memory where brand_id = $1",
      [brandId],
    );
    const [last] = await tx.query<{ status: RunStatus; started_at: Date | string; finished_at: Date | string | null }>(
      `select status, started_at, finished_at from public.research_runs
        where brand_id = $1 and status <> 'capped' order by started_at desc limit 1`,
      [brandId],
    );
    const [doneRun] = await tx.query<{ id: string }>(
      "select id::text as id from public.research_runs where brand_id = $1 and status = 'done' order by started_at desc limit 1",
      [brandId],
    );
    let cards: CardRow[] = [];
    let ideas: IdeaRow[] = [];
    let total = 0;
    if (doneRun) {
      const [t] = await tx.query<{ n: number }>("select count(*)::int as n from public.trend_cards where brand_id = $1 and run_id = $2", [brandId, doneRun.id]);
      total = t?.n ?? 0;
      cards = await tx.query<CardRow>(
        `select id::text as id, title, summary, why_it_matters, kind, sources, confidence, status
           from public.trend_cards
          where brand_id = $1 and run_id = $2 and status = 'new' and expires_at > $3::timestamptz
          order by created_at desc, score desc, id limit ${MAX_CARDS}`,
        [brandId, doneRun.id, now.toISOString()],
      );
      if (cards.length > 0) {
        ideas = await tx.query<IdeaRow>(
          `select id::text as id, card_id::text as card_id, post_type::text as post_type, angle, description, format, flags, status, brief_id::text as brief_id
             from public.post_ideas
            where brand_id = $1 and card_id = any($2::uuid[]) and status in ('new', 'used')
            order by created_at, id`,
          [brandId, cards.map((c) => c.id)],
        );
      }
    }
    const snapshots = await tx.query<{ competitor_id: string; name: string; taken_at: Date | string; recent: unknown }>(
      `select distinct on (s.competitor_id) s.competitor_id::text as competitor_id, c.name, s.taken_at, s.recent
         from public.competitor_snapshots s join public.competitors c on c.id = s.competitor_id and c.brand_id = s.brand_id
        where s.brand_id = $1
        order by s.competitor_id, s.taken_at desc`,
      [brandId],
    );
    const [named] = await tx.query<{ n: number }>("select count(*)::int as n from public.competitors where brand_id = $1", [brandId]);
    return { mem, last, cards, ideas, total, snapshots, named: named?.n ?? 0 };
  });

  const tz = data.mem?.timezone || "UTC";
  const today = (() => {
    try {
      return localDateIn(now, tz);
    } catch {
      return now.toISOString().slice(0, 10);
    }
  })();
  const researchOn = data.mem?.research_on ?? true;
  const hasProfile = !!data.mem?.category?.trim();
  const lastRunAt = data.last && data.last.status !== "running" ? iso(data.last.finished_at ?? data.last.started_at) : null;
  const running = !!data.last && data.last.status === "running" && now.getTime() - new Date(data.last.started_at).getTime() < RUNNING_STALE_MS;

  // "Research now" state.
  const weekStart = weekStartFor(now, tz);
  const used = await manualRunsThisWeek(brandId, weekStart, tz);
  const runsLeft = Math.max(0, MANUAL_RUNS_PER_WEEK - used);
  let disabled: ResearchDisabled | null = null;
  if (!researchOn) disabled = "off";
  else if (!hasProfile) disabled = "no_profile";
  else {
    const budget = await checkBudget(brandId, "manual", now, tz);
    if (!budget.ok) disabled = REASON_FROM_CAP[budget.reason];
  }

  const byCard = new Map<string, IdeaView[]>();
  for (const i of data.ideas) {
    const list = byCard.get(i.card_id) ?? [];
    list.push({
      id: i.id,
      postType: i.post_type,
      angle: i.angle,
      description: i.description,
      format: i.format,
      flags: Array.isArray(i.flags) ? (i.flags as unknown[]).filter((f): f is string => typeof f === "string") : [],
      status: i.status === "used" ? "used" : "new",
      briefId: i.brief_id,
    });
    byCard.set(i.card_id, list);
  }
  const cards: CardView[] = data.cards.map((c) => {
    const sources = readSources(c.sources);
    return {
      id: c.id,
      title: c.title,
      summary: c.summary,
      whyItMatters: c.why_it_matters,
      kind: c.kind,
      confidence: c.confidence,
      sources,
      freshness: freshnessOf(sources, today),
      ideas: byCard.get(c.id) ?? [],
    };
  });

  const recent: CompetitorRecentView[] = data.snapshots
    .map((r) => {
      const posts = readRecent(r.recent)
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
        .slice(0, 3);
      const best = [...posts].sort((a, b) => (b.likes ?? 0) + (b.comments ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0)))[0];
      return { competitorId: r.competitor_id, name: r.name, takenAt: iso(r.taken_at)!, posts, bestPermalink: best?.permalink ?? null };
    })
    .filter((r) => r.posts.length > 0);

  return {
    researchOn,
    hasProfile,
    lastRunAt,
    lastRunStatus: data.last?.status ?? null,
    running,
    runsLeft,
    runsMax: MANUAL_RUNS_PER_WEEK,
    runCostUsd: estimateRunUsd(),
    disabled,
    cards,
    runMadeCards: data.total > 0,
    competitors: { named: data.named, businessDiscovery: businessDiscoveryEnabled(env), recent },
  };
}
