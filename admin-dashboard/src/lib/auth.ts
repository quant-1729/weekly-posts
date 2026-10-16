import { db } from "./db";
import { mac, randomId, sha256Hex, sign, verify } from "./crypto";
import { appUrl, isAdminEmail } from "./env";

/**
 * Sign-in: an emailed magic link, for addresses in ADMIN_EMAILS only.
 *
 * - The link is a signed, stateless token (HMAC with ADMIN_AUTH_SECRET) holding the email, an expiry and a nonce.
 * - It works once. Used nonces live in public.admin_actions (action 'link_used', target = hash of the nonce), because
 *   serverless memory is not shared. Consuming runs in a transaction under an advisory lock so two clicks at the same
 *   moment cannot both win.
 * - The session is a second signed token in an httpOnly, SameSite=Strict cookie, valid for 12 hours, and is checked
 *   against ADMIN_EMAILS on every request (remove an address and its session stops working).
 */

export const LINK_TTL_S = 15 * 60;
export const SESSION_TTL_S = 12 * 60 * 60;
/** Link requests allowed per address per hour, and in total per hour (so random addresses cannot fill the table). */
export const LINK_LIMIT_PER_EMAIL = 5;
export const LINK_LIMIT_TOTAL = 60;

const LINK = "admin-link-v1";
const SESSION = "admin-session-v1";

export interface LinkPayload {
  e: string; // email
  x: number; // expires at, unix seconds
  n: string; // nonce
}
export interface SessionPayload {
  e: string;
  x: number;
  s: string; // random session id (only for tamper-proofing; sessions are not stored)
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

const nowS = (now: number) => Math.floor(now / 1000);
const nonceHash = (nonce: string) => sha256Hex(`nonce:${nonce}`);
/** Keyed hash of an address, so the request log never holds a raw address (known or not). */
export const emailKey = (email: string) => mac("admin-email-key", email).slice(0, 32);

export function createLinkToken(email: string, now = Date.now()): { token: string; nonce: string } {
  const nonce = randomId(18);
  const payload: LinkPayload = { e: email.toLowerCase(), x: nowS(now) + LINK_TTL_S, n: nonce };
  return { token: sign(LINK, payload), nonce };
}

/** Checks signature, expiry and allowlist. Does NOT consume. */
export function readLinkToken(token: string | undefined | null, now = Date.now()): LinkPayload | null {
  const p = verify<LinkPayload>(LINK, token);
  if (!p || typeof p.e !== "string" || typeof p.n !== "string" || typeof p.x !== "number") return null;
  if (p.x <= nowS(now)) return null;
  if (!isAdminEmail(p.e)) return null;
  return p;
}

export async function linkAlreadyUsed(nonce: string): Promise<boolean> {
  const rows = await db().query<{ n: number }>(
    "select count(*)::int as n from public.admin_actions where action = 'link_used' and target = $1",
    [nonceHash(nonce)],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** Marks the link used and returns the email, or null when the link is invalid, expired, not allowed or already used. */
export async function consumeLinkToken(token: string | undefined | null, now = Date.now()): Promise<string | null> {
  const p = readLinkToken(token, now);
  if (!p) return null;
  const target = nonceHash(p.n);
  return db().tx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`link_used:${target}`]);
    const used = await tx.query<{ n: number }>(
      "select count(*)::int as n from public.admin_actions where action = 'link_used' and target = $1",
      [target],
    );
    if ((used[0]?.n ?? 0) > 0) return null;
    await tx.query(
      "insert into public.admin_actions (admin_email, action, target, detail) values ($1, 'link_used', $2, '{}'::jsonb)",
      [p.e, target],
    );
    await tx.query(
      "insert into public.admin_actions (admin_email, action, target, detail) values ($1, 'sign_in', null, '{}'::jsonb)",
      [p.e],
    );
    return p.e;
  });
}

export interface LoginMail {
  to: string;
  url: string;
}

/**
 * Handles a sign-in request. Every caller gets the same answer; this returns the mail to send (or null) only to the
 * server action, which sends it after answering. Rate limits and logging happen for unknown addresses too, so the
 * behaviour cannot be used to find out which addresses are admins.
 */
export async function requestLoginLink(rawEmail: unknown, now = Date.now()): Promise<LoginMail | null> {
  const email = normaliseEmail(rawEmail);
  if (!email) return null;
  const key = emailKey(email);
  const allowed = isAdminEmail(email);

  return db().tx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('link_requested'))");
    const counts = await tx.query<{ total: number; mine: number }>(
      `select count(*)::int as total, (count(*) filter (where target = $1))::int as mine
         from public.admin_actions
        where action = 'link_requested' and at > now() - interval '1 hour'`,
      [key],
    );
    const total = counts[0]?.total ?? 0;
    const mine = counts[0]?.mine ?? 0;
    if (total >= LINK_LIMIT_TOTAL || mine >= LINK_LIMIT_PER_EMAIL) return null;
    await tx.query(
      "insert into public.admin_actions (admin_email, action, target, detail) values ('anonymous', 'link_requested', $1, '{}'::jsonb)",
      [key],
    );
    if (!allowed) return null;
    const { token } = createLinkToken(email, now);
    return { to: email, url: `${appUrl()}/auth/verify?t=${encodeURIComponent(token)}` };
  });
}

export function createSessionToken(email: string, now = Date.now()): string {
  const payload: SessionPayload = { e: email.toLowerCase(), x: nowS(now) + SESSION_TTL_S, s: randomId(12) };
  return sign(SESSION, payload);
}

/** The admin's email when the cookie value is a valid, unexpired session of an allowed address. */
export function readSessionToken(token: string | undefined | null, now = Date.now()): string | null {
  const p = verify<SessionPayload>(SESSION, token);
  if (!p || typeof p.e !== "string" || typeof p.x !== "number") return null;
  if (p.x <= nowS(now)) return null;
  return isAdminEmail(p.e) ? p.e : null;
}
