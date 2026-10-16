// Persistence for research runs, cards and ideas (R-2, R-5). Server-only: runs as the service role, after the
// caller has checked who may start a run. Reads for the screens (R-6) go through RLS in their own functions.

import { getDb } from "@/lib/db";
import type { CardDraft } from "./cards";
import { CARD_TTL_DAYS, type PlannedQuery, type ResearchRun, type RunStatus, type RunTrigger } from "./types";

interface RunRow {
  id: string;
  brand_id: string;
  trigger: RunTrigger;
  status: RunStatus;
  window_start: string;
  window_end: string;
  focus: string | null;
  queries: PlannedQuery[];
  sources_count: number;
  cost_usd: string | number;
  error: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
}

const COLUMNS = `id::text as id, brand_id::text as brand_id, trigger, status, window_start::text as window_start, window_end::text as window_end,
  focus, queries, sources_count, cost_usd, error, started_at, finished_at`;
const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

export function toRun(r: RunRow): ResearchRun {
  return {
    id: r.id,
    brandId: r.brand_id,
    trigger: r.trigger,
    status: r.status,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    focus: r.focus,
    queries: Array.isArray(r.queries) ? r.queries : [],
    sourcesCount: r.sources_count,
    costUsd: Number(r.cost_usd),
    error: r.error,
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
  };
}

export async function createRun(args: {
  brandId: string;
  trigger: RunTrigger;
  status: RunStatus;
  windowStart: string;
  windowEnd: string;
  focus: string | null;
  error?: string | null;
  now: Date;
}): Promise<ResearchRun> {
  const finished = args.status === "running" ? null : args.now.toISOString();
  const [row] = await getDb().withService((tx) =>
    tx.query<RunRow>(
      `insert into public.research_runs (brand_id, trigger, status, window_start, window_end, focus, error, started_at, finished_at)
       values ($1, $2, $3, $4::date, $5::date, $6, $7, $8::timestamptz, $9::timestamptz) returning ${COLUMNS}`,
      [args.brandId, args.trigger, args.status, args.windowStart, args.windowEnd, args.focus, args.error ?? null, args.now.toISOString(), finished],
    ),
  );
  return toRun(row);
}

export async function finishRun(args: {
  runId: string;
  brandId: string;
  status: Exclude<RunStatus, "running">;
  costUsd: number;
  sourcesCount: number;
  queries: PlannedQuery[];
  error: string | null;
  now: Date;
}): Promise<ResearchRun> {
  const [row] = await getDb().withService((tx) =>
    tx.query<RunRow>(
      `update public.research_runs
          set status = $3, cost_usd = $4, sources_count = $5, queries = $6::jsonb, error = $7, finished_at = $8::timestamptz
        where id = $1 and brand_id = $2 returning ${COLUMNS}`,
      [args.runId, args.brandId, args.status, Math.round(args.costUsd * 10_000) / 10_000, args.sourcesCount, JSON.stringify(args.queries), args.error?.slice(0, 500) ?? null, args.now.toISOString()],
    ),
  );
  return toRun(row);
}

/** Saves the run's cards and their ideas in one transaction. expires_at = now + CARD_TTL_DAYS. */
export async function saveCards(brandId: string, runId: string, cards: CardDraft[], now: Date): Promise<{ cards: number; ideas: number }> {
  const expires = new Date(now.getTime() + CARD_TTL_DAYS * 86_400_000).toISOString();
  let ideas = 0;
  await getDb().withService(async (tx) => {
    for (const c of cards) {
      const [card] = await tx.query<{ id: string }>(
        `insert into public.trend_cards (brand_id, run_id, title, summary, why_it_matters, kind, sources, score, velocity, confidence, expires_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::timestamptz, $12::timestamptz) returning id::text as id`,
        [
          brandId,
          runId,
          c.title,
          c.summary,
          c.whyItMatters,
          c.kind,
          JSON.stringify(c.sources.map((s) => ({ url: s.url, title: s.title, site: s.site, published_at: s.publishedAt, kind: s.kind, ...(s.engagement ? { engagement: s.engagement } : {}) }))),
          c.score,
          c.velocity,
          c.confidence,
          expires,
          now.toISOString(),
        ],
      );
      for (const i of c.ideas) {
        await tx.query(
          `insert into public.post_ideas (brand_id, card_id, post_type, angle, description, format, flags, created_at)
           values ($1, $2, $3::public.post_type, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
          [brandId, card.id, i.postType, i.angle, i.description, i.format, JSON.stringify(i.flags), now.toISOString()],
        );
        ideas++;
      }
    }
  });
  return { cards: cards.length, ideas };
}

/** The most recent run of the brand, if any. */
export async function latestRun(brandId: string): Promise<ResearchRun | null> {
  const [row] = await getDb().withService((tx) =>
    tx.query<RunRow>(`select ${COLUMNS} from public.research_runs where brand_id = $1 order by started_at desc limit 1`, [brandId]),
  );
  return row ? toRun(row) : null;
}
