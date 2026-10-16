import type { MockDb } from "@/lib/db/mock";
import { NOW, rows } from "./helpers";

const iso = (d: Date | string) => new Date(d).toISOString();

export async function seedRun(
  db: MockDb,
  brandId: string,
  o: { status?: string; trigger?: string; startedAt?: Date | string; costUsd?: number; error?: string | null; focus?: string | null } = {},
): Promise<string> {
  const started = iso(o.startedAt ?? NOW);
  const [r] = await rows<{ id: string }>(
    db,
    `insert into public.research_runs (brand_id, trigger, status, window_start, window_end, focus, cost_usd, error, started_at, finished_at)
     values ($1, $2, $3, '2026-09-15', '2026-10-15', $4, $5, $6, $7::timestamptz, $7::timestamptz) returning id::text as id`,
    [brandId, o.trigger ?? "weekly", o.status ?? "done", o.focus ?? null, o.costUsd ?? 0.34, o.error ?? null, started],
  );
  return r.id;
}

export interface SeedSource {
  url: string;
  title?: string;
  site?: string;
  published_at?: string;
  kind?: string;
}

export async function seedCard(
  db: MockDb,
  brandId: string,
  runId: string,
  o: { title?: string; score?: number; status?: string; createdAt?: Date | string; expiresAt?: Date | string; sources?: SeedSource[]; confidence?: string } = {},
): Promise<string> {
  const created = new Date(o.createdAt ?? NOW);
  const sources = (o.sources ?? [{ url: "https://news.example.com/autumn", title: "Autumn bakes are back", site: "news.example.com", published_at: "2026-10-12", kind: "web" }]).map((s) => ({
    title: "A source",
    site: "news.example.com",
    published_at: "2026-10-12",
    kind: "web",
    ...s,
  }));
  const [r] = await rows<{ id: string }>(
    db,
    `insert into public.trend_cards (brand_id, run_id, title, summary, why_it_matters, kind, sources, score, confidence, status, expires_at, created_at)
     values ($1, $2, $3, 'People are looking for autumn bakes.', 'It fits what you sell.', 'trend', $4::jsonb, $5, $6, $7, $8::timestamptz, $9::timestamptz) returning id::text as id`,
    [
      brandId,
      runId,
      o.title ?? "Autumn bakes",
      JSON.stringify(sources),
      o.score ?? 50,
      o.confidence ?? "medium",
      o.status ?? "new",
      iso(o.expiresAt ?? new Date(created.getTime() + 14 * 86_400_000)),
      created.toISOString(),
    ],
  );
  return r.id;
}

export async function seedIdea(
  db: MockDb,
  brandId: string,
  cardId: string,
  o: { postType?: string; angle?: string; description?: string; format?: string | null; flags?: string[]; status?: string; createdAt?: Date | string } = {},
): Promise<string> {
  const [r] = await rows<{ id: string }>(
    db,
    `insert into public.post_ideas (brand_id, card_id, post_type, angle, description, format, flags, status, created_at)
     values ($1, $2, $3::public.post_type, $4, $5, $6, $7::jsonb, $8, $9::timestamptz) returning id::text as id`,
    [
      brandId,
      cardId,
      o.postType ?? "announcement",
      o.angle ?? "Autumn bakes are in",
      o.description ?? "A post about our autumn bakes, inviting people to come in and try them",
      o.format === undefined ? "single" : o.format,
      JSON.stringify(o.flags ?? ["from research, please check: no prices, dates or claims were added"]),
      o.status ?? "new",
      iso(o.createdAt ?? NOW),
    ],
  );
  return r.id;
}

/** A finished run with `n` cards, each with one idea. Returns the ids. */
export async function seedCards(db: MockDb, brandId: string, n: number, o: { startedAt?: Date | string } = {}) {
  const runId = await seedRun(db, brandId, { startedAt: o.startedAt });
  const out: { cardId: string; ideaId: string }[] = [];
  for (let i = 0; i < n; i++) {
    const cardId = await seedCard(db, brandId, runId, { title: `Trend ${i + 1}`, score: 10 * (i + 1), createdAt: new Date(NOW.getTime() - (n - i) * 60_000) });
    const ideaId = await seedIdea(db, brandId, cardId, { angle: `Angle ${i + 1}` });
    out.push({ cardId, ideaId });
  }
  return { runId, items: out };
}
