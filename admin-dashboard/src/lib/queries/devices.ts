import { db } from "../db";
import {
  PAGE_SIZE,
  Params,
  UUID_RE,
  cleanChoice,
  cleanText,
  decodeCursor,
  iso,
  likeContains,
  paginate,
  type Page,
} from "./common";

export const DEVICE_TYPES = ["desktop", "mobile", "tablet", "bot", "unknown"] as const;

export interface DeviceFilters {
  /** Only sessions that have not been signed out. */
  active?: boolean;
  device?: string;
  country?: string;
  /** Part of the user's email. */
  q?: string;
  cursor?: string;
}

export interface SessionRow {
  id: string;
  ts: string; // last_seen_at, ISO
  user_id: string;
  email: string | null;
  brand_name: string | null;
  device_type: string;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  first_seen: string;
  last_seen: string;
  revoked_at: string | null;
  revoked_by: string | null;
  online: boolean;
}

export const SESSION_COLUMNS = `
  s.id::text as id, ${iso("s.last_seen_at")} as ts, s.user_id::text as user_id, p.email, b.name as brand_name,
  s.device_type, s.browser, s.os, s.country, s.city,
  ${iso("s.created_at")} as first_seen, ${iso("s.last_seen_at")} as last_seen,
  ${iso("s.revoked_at")} as revoked_at, s.revoked_by,
  (s.revoked_at is null and s.last_seen_at > now() - interval '15 minutes') as online`;

export function devicesSql(f: DeviceFilters): { sql: string; params: unknown[] } {
  const p = new Params();
  const where: string[] = [];
  if (f.active) where.push("s.revoked_at is null");
  const device = cleanChoice(f.device, DEVICE_TYPES);
  if (device) where.push(`s.device_type = ${p.add(device)}`);
  const country = cleanText(f.country, 2).toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) where.push(`s.country = ${p.add(country)}`);
  const q = cleanText(f.q);
  if (q) where.push(`p.email ilike ${p.add(likeContains(q))} escape '\\'`);
  const cur = decodeCursor(f.cursor, UUID_RE);
  if (cur) where.push(`(s.last_seen_at, s.id) < (${p.add(cur.t)}::timestamptz, ${p.add(cur.i)}::uuid)`);
  const sql = `
select ${SESSION_COLUMNS}
  from public.user_sessions s
  left join public.profiles p on p.id = s.user_id
  left join public.brands b on b.id = p.last_brand_id
 ${where.length ? `where ${where.join(" and ")}` : ""}
 order by s.last_seen_at desc, s.id desc
 limit ${PAGE_SIZE + 1}`;
  return { sql, params: p.values };
}

export async function listSessions(f: DeviceFilters): Promise<Page<SessionRow>> {
  const { sql, params } = devicesSql(f);
  return paginate(await db().query<SessionRow>(sql, params));
}

