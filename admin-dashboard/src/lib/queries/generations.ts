import { db } from "../db";
import {
  INT_RE,
  PAGE_SIZE,
  Params,
  cleanText,
  decodeCursor,
  iso,
  likeContains,
  paginate,
  type Page,
} from "./common";

// The AI usage log (public.usage_events): one row per AI call (kind, model, cost, ok). Older rows have model = null.

export interface GenerationRow {
  id: number;
  ts: string;
  brand_name: string | null;
  kind: string;
  model: string | null;
  ok: boolean;
  usd: number;
}

export interface GenerationFilters {
  kind?: string;
  brand?: string;
  /** "failed" = only failed calls. */
  ok?: string;
  cursor?: string;
}

export function generationsSql(f: GenerationFilters): { sql: string; params: unknown[] } {
  const p = new Params();
  const where: string[] = [];
  const kind = cleanText(f.kind, 40);
  if (/^[a-z_]{2,40}$/.test(kind)) where.push(`u.kind::text = ${p.add(kind)}`);
  if (f.ok === "failed") where.push("u.ok = false");
  const brand = cleanText(f.brand);
  if (brand) where.push(`b.name ilike ${p.add(likeContains(brand))} escape '\\'`);
  const cur = decodeCursor(f.cursor, INT_RE);
  if (cur) where.push(`(u.created_at, u.id) < (${p.add(cur.t)}::timestamptz, ${p.add(cur.i)}::bigint)`);
  const sql = `
select u.id, ${iso("u.created_at")} as ts, b.name as brand_name, u.kind::text as kind, u.model, u.ok, u.usd::float8 as usd
  from public.usage_events u
  left join public.brands b on b.id = u.brand_id
 ${where.length ? `where ${where.join(" and ")}` : ""}
 order by u.created_at desc, u.id desc
 limit ${PAGE_SIZE + 1}`;
  return { sql, params: p.values };
}

export async function listGenerations(f: GenerationFilters): Promise<Page<GenerationRow>> {
  const { sql, params } = generationsSql(f);
  return paginate(await db().query<GenerationRow>(sql, params));
}

export const GEN_BY_KIND_SQL = `
select u.kind::text as kind, count(*)::int as n, (count(*) filter (where not u.ok))::int as failed,
       coalesce(sum(u.usd), 0)::float8 as usd
  from public.usage_events u
 where u.created_at >= now() - interval '30 days'
 group by u.kind
 order by coalesce(sum(u.usd), 0) desc, count(*) desc`;

export const GEN_BY_MODEL_SQL = `
select u.model, count(*)::int as n, (count(*) filter (where not u.ok))::int as failed,
       coalesce(sum(u.usd), 0)::float8 as usd
  from public.usage_events u
 where u.created_at >= now() - interval '30 days'
 group by u.model
 order by coalesce(sum(u.usd), 0) desc, count(*) desc`;

export const GEN_BY_DAY_SQL = `
select to_char(u.created_at at time zone 'utc', 'YYYY-MM-DD') as day, count(*)::int as n, coalesce(sum(u.usd), 0)::float8 as usd
  from public.usage_events u
 where u.created_at >= now() - interval '30 days'
 group by 1
 order by 1`;

export interface Totals {
  byKind: { kind: string; n: number; failed: number; usd: number }[];
  byModel: { model: string | null; n: number; failed: number; usd: number }[];
  byDay: { day: string; n: number; usd: number }[];
}

export async function getGenerationTotals(): Promise<Totals> {
  const d = db();
  const [byKind, byModel, byDay] = await Promise.all([
    d.query<Totals["byKind"][number]>(GEN_BY_KIND_SQL),
    d.query<Totals["byModel"][number]>(GEN_BY_MODEL_SQL),
    d.query<{ day: string; n: number; usd: number }>(GEN_BY_DAY_SQL),
  ]);
  return { byKind, byModel, byDay };
}
