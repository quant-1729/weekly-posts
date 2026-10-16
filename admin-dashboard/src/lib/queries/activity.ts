import { db } from "../db";
import { safeDetail } from "../format";
import {
  INT_RE,
  PAGE_SIZE,
  Params,
  cleanChoice,
  cleanDate,
  cleanText,
  decodeCursor,
  iso,
  likeContains,
  paginate,
  type Page,
} from "./common";

export interface ActivityFilters {
  /** Exact event kind, e.g. "design.generated". */
  kind?: string;
  ok?: string; // "ok" | "failed"
  /** Part of the user's email. */
  user?: string;
  /** Part of the brand name. */
  brand?: string;
  from?: string; // YYYY-MM-DD (UTC), inclusive
  to?: string; // YYYY-MM-DD (UTC), inclusive
  cursor?: string;
}

export interface ActivityRow {
  id: number;
  ts: string;
  kind: string;
  ok: boolean;
  user_id: string | null;
  email: string | null;
  brand_name: string | null;
  /** Short, filtered summary of app_events.detail (see safeDetail); the raw JSON never leaves this module. */
  detail: string;
}

export const KIND_RE = /^[a-z][a-z0-9_.]{1,59}$/;

export function activitySql(f: ActivityFilters): { sql: string; params: unknown[] } {
  const p = new Params();
  const where: string[] = [];
  const kind = cleanText(f.kind, 60);
  if (KIND_RE.test(kind)) where.push(`a.kind = ${p.add(kind)}`);
  const ok = cleanChoice(f.ok, ["ok", "failed"] as const);
  if (ok) where.push(`a.ok = ${p.add(ok === "ok")}`);
  const user = cleanText(f.user);
  if (user) where.push(`u.email ilike ${p.add(likeContains(user))} escape '\\'`);
  const brand = cleanText(f.brand);
  if (brand) where.push(`b.name ilike ${p.add(likeContains(brand))} escape '\\'`);
  const from = cleanDate(f.from);
  if (from) where.push(`a.at >= ${p.add(from)}::date::timestamptz`);
  const to = cleanDate(f.to);
  if (to) where.push(`a.at < (${p.add(to)}::date + 1)::timestamptz`);
  const cur = decodeCursor(f.cursor, INT_RE);
  if (cur) where.push(`(a.at, a.id) < (${p.add(cur.t)}::timestamptz, ${p.add(cur.i)}::bigint)`);
  const sql = `
select a.id, ${iso("a.at")} as ts, a.kind, a.ok, a.user_id::text as user_id, u.email, b.name as brand_name, a.detail
  from public.app_events a
  left join public.profiles u on u.id = a.user_id
  left join public.brands b on b.id = a.brand_id
 ${where.length ? `where ${where.join(" and ")}` : ""}
 order by a.at desc, a.id desc
 limit ${PAGE_SIZE + 1}`;
  return { sql, params: p.values };
}

export async function listActivity(f: ActivityFilters): Promise<Page<ActivityRow>> {
  const { sql, params } = activitySql(f);
  const rows = await db().query<Omit<ActivityRow, "detail"> & { detail: unknown }>(sql, params);
  return paginate(rows.map((r) => ({ ...r, detail: safeDetail(r.detail) })));
}

export const ACTIVITY_KINDS_SQL = `select distinct kind from public.app_events order by kind limit 200`;

export async function listActivityKinds(): Promise<string[]> {
  return (await db().query<{ kind: string }>(ACTIVITY_KINDS_SQL)).map((r) => r.kind);
}
