import { cookies, headers } from "next/headers";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { sendEmail, EmailSendError } from "@/lib/email";
import { logEvent } from "@/lib/events/log";
import { TOUCH_AFTER_MS, createSession, revokeSession, type HeaderReader } from "@/lib/sessions";
import { magicLinkEmail } from "@/lib/email/magic-link";
import { normalizeEmail } from "./email";
import { signMagicToken, verifyMagicToken } from "./magic-link";
import { DEMO_SESSION_MAX_AGE_SECONDS, SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from "./session";
import { AuthError, type Auth, type AuthUser } from "./types";

/**
 * The one email magic-link flow, shared by the mock and Supabase backends (D8). Links are
 * tracked in public.magic_links, and the rate limits are counted from that table, so they
 * hold across serverless instances and restarts. Only two things differ per backend, and
 * they are passed in as `AuthUsers`: finding or creating the auth user, and (in the
 * mock) refusing to run on Vercel production.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const LINKS_PER_EMAIL_PER_HOUR = 5;
export const LINKS_PER_IP_PER_HOUR = 20;
/** Minimum gap between two links to the same address (the "resend" button). */
export const RESEND_GAP_MS = 60 * 1000;

export interface AuthUsers {
  /** Throws when this backend must not run here (mock on Vercel production). Optional. */
  assertAllowed?(): void;
  /** The id of the auth user with this (normalised) address, created if it does not exist. */
  findOrCreateUser(email: string): Promise<string>;
}

/** The current request's headers, or null outside a request (a script, a test that does not mock them). */
async function requestHeaders(): Promise<HeaderReader | null> {
  try {
    return await headers();
  } catch {
    return null;
  }
}

function requireAppUrl(): string {
  const base = getEnv().appUrl;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is required to build sign-in links in production.");
  return base;
}

export function createLinkAuth(users: AuthUsers): Auth {
  const guard = () => users.assertAllowed?.();

  return {
    async requestMagicLink(input, consent, opts) {
      guard();
      if (consent !== true) throw new AuthError("consent_required");
      const email = normalizeEmail(input);
      if (!email) throw new AuthError("invalid_email");
      const appUrl = requireAppUrl();

      const now = Date.now();
      const ip = opts?.ip?.trim() || null;
      const { token, jti, expiresAt } = await signMagicToken(email, now);
      const hourAgo = new Date(now - HOUR_MS).toISOString();
      const gapAgo = new Date(now - RESEND_GAP_MS).toISOString();

      await getDb().withService(async (tx) => {
        // Serialise requests for one address, so two at once cannot both slip under a limit.
        await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`magic_links:${email}`]);
        const [c] = await tx.query<{ per_email: number; recent: number; per_ip: number }>(
          `select count(*) filter (where lower(email) = $1 and created_at > $2)::int as per_email,
                  count(*) filter (where lower(email) = $1 and created_at > $3)::int as recent,
                  count(*) filter (where $4::text is not null and ip = $4::text and created_at > $2)::int as per_ip
             from public.magic_links
            where created_at > $2 and (lower(email) = $1 or ip = $4::text)`,
          [email, hourAgo, gapAgo, ip],
        );
        // A refused request stores nothing, so it does not use up allowance.
        if (c.per_email >= LINKS_PER_EMAIL_PER_HOUR || c.recent >= 1 || (ip && c.per_ip >= LINKS_PER_IP_PER_HOUR)) {
          throw new AuthError("rate_limited");
        }
        // Same path for a known and an unknown address: the account is made when the link is opened.
        await tx.query(
          `insert into public.magic_links (jti, email, ip, expires_at, created_at) values ($1, $2, $3, $4, $5)`,
          [jti, email, ip, expiresAt.toISOString(), new Date(now).toISOString()],
        );
        // Housekeeping: links expire after 15 minutes, limits look back one hour.
        await tx.query("delete from public.magic_links where created_at < $1", [new Date(now - DAY_MS).toISOString()]);
      }).catch((e: unknown) => {
        if (e instanceof AuthError) void logEvent({ kind: "auth.link_requested", ok: false, detail: { reason: e.code } });
        throw e;
      });

      const message = magicLinkEmail(`${appUrl}/auth/callback?token=${encodeURIComponent(token)}`);
      try {
        await sendEmail({ to: email, kind: "magic_link", ...message });
      } catch (e) {
        void logEvent({ kind: "auth.link_requested", ok: false, detail: { reason: "email_failed" } });
        if (e instanceof EmailSendError) throw new AuthError("email_failed", e.message);
        throw e;
      }
      void logEvent({ kind: "auth.link_requested" }); // no address in the log
    },

    async checkMagicLink(token) {
      guard();
      const payload = await verifyMagicToken(token);
      if (!payload) return false;
      const rows = await getDb().withService((tx) =>
        tx.query(
          `select 1 from public.magic_links
            where jti = $1 and email = $2 and used_at is null and expires_at > $3`,
          [payload.jti, payload.email, new Date().toISOString()],
        ),
      );
      return rows.length > 0;
    },

    async consumeMagicLink(token) {
      guard();
      const payload = await verifyMagicToken(token);
      if (!payload) throw new AuthError("invalid_link");
      const db = getDb();

      // One statement marks the link used only if it was not used before, so two
      // clicks at once cannot both win.
      const used = await db.withService((tx) =>
        tx.query<{ jti: string }>(
          `update public.magic_links set used_at = now()
            where jti = $1 and email = $2 and used_at is null and expires_at > $3
            returning jti`,
          [payload.jti, payload.email, new Date().toISOString()],
        ),
      );
      if (used.length === 0) throw new AuthError("invalid_link");

      let userId: string;
      let phone: string | null;
      let sessionId: string;
      try {
        userId = await users.findOrCreateUser(payload.email);
        // Consent time is set on first sign-in only; a returning owner keeps the first one.
        const [profile] = await db.withService(async (tx) => {
          await tx.query(
            `insert into public.profiles (id, email, consent_at) values ($1, $2, now())
             on conflict (id) do nothing`,
            [userId, payload.email],
          );
          return tx.query<{ phone: string | null }>("select phone from public.profiles where id = $1", [userId]);
        });
        phone = profile?.phone ?? null;
        sessionId = await createSession(userId, await requestHeaders());
      } catch (e) {
        // The owner never got in: give the link back so the same email can be tried again.
        await db
          .withService((tx) => tx.query("update public.magic_links set used_at = null where jti = $1", [payload.jti]))
          .catch(() => undefined);
        throw e;
      }

      const result: AuthUser = { id: userId, email: payload.email, phone, sessionId, demo: false };
      const store = await cookies();
      store.set(SESSION_COOKIE, await signSession({ id: result.id, email: payload.email, sid: sessionId }), sessionCookieOptions());
      void logEvent({ kind: "auth.sign_in", userId, sessionId });
      return result;
    },

    async startDemoSession(input) {
      guard();
      const email = normalizeEmail(input);
      if (!email) return null;
      // Only an account that already exists: the demo never creates one.
      const [profile] = await getDb().withService((tx) =>
        tx.query<{ id: string; email: string | null; phone: string | null }>(
          "select id::text as id, email, phone from public.profiles where lower(email) = $1",
          [email],
        ),
      );
      if (!profile) return null;
      const sessionId = await createSession(profile.id, await requestHeaders(), { demo: true });
      const store = await cookies();
      store.set(
        SESSION_COOKIE,
        await signSession({ id: profile.id, email: profile.email ?? email, sid: sessionId, demo: true }),
        sessionCookieOptions({ demo: true }),
      );
      void logEvent({ kind: "auth.sign_in", userId: profile.id, sessionId, detail: { demo: true } });
      return { id: profile.id, email: profile.email, phone: profile.phone, sessionId, demo: true };
    },

    async getCurrentUser() {
      guard();
      const store = await cookies();
      const payload = await verifySession(store.get(SESSION_COOKIE)?.value);
      if (!payload) return null;
      // One query: the live session joined with its profile. A valid cookie whose session row is gone or revoked
      // (signed out, revoked by an admin, account deleted, database wiped) is signed out. The same statement
      // moves last_seen_at forward, but only when it is more than 5 minutes old.
      const now = Date.now();
      const rows = await getDb().withService((tx) =>
        tx.query<{ id: string; email: string | null; phone: string | null; demo: boolean }>(
          `with touched as (
             update public.user_sessions set last_seen_at = $3::timestamptz
              where id = $1::uuid and user_id = $2::uuid and revoked_at is null and last_seen_at < $4::timestamptz
              returning id
           )
           select p.id::text as id, p.email, p.phone, s.demo
             from public.user_sessions s join public.profiles p on p.id = s.user_id
            where s.id = $1::uuid and s.user_id = $2::uuid and s.revoked_at is null
              and (not s.demo or s.created_at > $5::timestamptz)`, // a demo session also ends 12 hours after it started, whatever the cookie says
          [
            payload.sid,
            payload.sub,
            new Date(now).toISOString(),
            new Date(now - TOUCH_AFTER_MS).toISOString(),
            new Date(now - DEMO_SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
          ],
        ),
      );
      return rows[0] ? { id: rows[0].id, email: rows[0].email, phone: rows[0].phone, sessionId: payload.sid, demo: rows[0].demo === true } : null;
    },

    async signOut() {
      const store = await cookies();
      const payload = await verifySession(store.get(SESSION_COOKIE)?.value);
      store.delete(SESSION_COOKIE);
      if (!payload) return;
      try {
        // Nothing to log when there was no live row (already revoked, or the account was just deleted).
        if (await revokeSession(payload.sid, "user", payload.sub)) {
          void logEvent({ kind: "auth.sign_out", userId: payload.sub, sessionId: payload.sid });
        }
      } catch (e) {
        // The cookie is already gone from this browser; say so loudly rather than hide that the row stayed live.
        console.error("[auth] could not revoke the session", (e as Error)?.name ?? e);
      }
    },
  };
}
