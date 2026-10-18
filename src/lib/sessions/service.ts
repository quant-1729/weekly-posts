import { getDb } from "@/lib/db";
import { logEvent } from "@/lib/events/log";
import { lookupGeo } from "./geo";
import { clientIpFromHeaders, hashIp } from "./ip";
import { parseUserAgent } from "./ua";

/**
 * Sign-in sessions (public.user_sessions). One row per sign-in; the session cookie carries its id as `sid`.
 * A missing or revoked row signs the device out (src/lib/auth/links.ts checks it on every request).
 *
 * Privacy: the IP address is read from the request only to look up an approximate city/country (offline) and to
 * make a keyed hash; the address itself is never stored or logged. The user-agent string is stored cut to 400
 * characters. Rows are kept 12 months (purgeOldSessionData, run by the daily cron).
 */

export const TOUCH_AFTER_MS = 5 * 60 * 1000;
export const RETENTION_MONTHS = 12;

export type RevokedBy = "user" | "admin" | "system";

/** The request's headers (next/headers `headers()` or a Request's). Null when there is no request (a test, a script). */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Inserts a session row for `userId` and returns its id. `demo: true` marks a session started from the demo page
 * (docs/15-demo-login.md): the app refuses account-level and paid actions in it.
 */
export async function createSession(userId: string, headers: HeaderReader | null, opts: { demo?: boolean } = {}): Promise<string> {
  const ua = headers?.get("user-agent") ?? null;
  const ip = headers ? clientIpFromHeaders(headers) : null;
  const parsed = parseUserAgent(ua);
  const geo = await lookupGeo(ip);
  const ipHash = hashIp(ip); // the raw address goes no further than this function
  const [row] = await getDb().withService((tx) =>
    tx.query<{ id: string }>(
      `insert into public.user_sessions (user_id, user_agent, browser, os, device_type, country, city, ip_hash, demo)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id::text as id`,
      [userId, ua ? ua.slice(0, 400) : null, parsed.browser, parsed.os, parsed.deviceType, geo.country, geo.city, ipHash, opts.demo === true],
    ),
  );
  return row.id;
}

/**
 * Ends a session. With `userId` the row must belong to that user (a user can only end their own). Returns true
 * when a live session was revoked. Writes a session.revoked event.
 */
export async function revokeSession(sessionId: string, by: RevokedBy, userId?: string): Promise<boolean> {
  const rows = await getDb().withService((tx) =>
    tx.query<{ user_id: string }>(
      `update public.user_sessions set revoked_at = now(), revoked_by = $2
        where id = $1::uuid and revoked_at is null and ($3::uuid is null or user_id = $3::uuid)
        returning user_id::text as user_id`,
      [sessionId, by, userId ?? null],
    ),
  );
  if (rows[0]) void logEvent({ kind: "session.revoked", userId: rows[0].user_id, sessionId, detail: { by } });
  return rows.length > 0;
}

/**
 * Retention (12 months): sessions revoked or last seen more than 12 months ago, and activity events older than that.
 * Run by the daily connections cron.
 */
export async function purgeOldSessionData(now: Date = new Date()): Promise<{ sessions: number; events: number }> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  const iso = cutoff.toISOString();
  return getDb().withService(async (tx) => {
    const s = await tx.query<{ n: number }>(
      `with d as (delete from public.user_sessions where last_seen_at < $1::timestamptz or revoked_at < $1::timestamptz returning 1)
       select count(*)::int as n from d`,
      [iso],
    );
    const e = await tx.query<{ n: number }>(
      `with d as (delete from public.app_events where at < $1::timestamptz returning 1)
       select count(*)::int as n from d`,
      [iso],
    );
    return { sessions: s[0]?.n ?? 0, events: e[0]?.n ?? 0 };
  });
}
