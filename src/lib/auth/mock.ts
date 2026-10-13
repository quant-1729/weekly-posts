import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { getMockDb } from "@/lib/db/mock";
import { sendEmail, EmailSendError } from "@/lib/email";
import { magicLinkEmail } from "@/lib/email/magic-link";
import { normalizeEmail } from "./email";
import { signMagicToken, verifyMagicToken } from "./magic-link";
import { resetRateLimits, takeAll, type Bucket } from "./rate-limit";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "./session";
import { AuthError, type Auth, type AuthUser } from "./types";

/**
 * Mock sign-in: the emailed link goes to the dev outbox (.data/outbox, /dev/outbox).
 * Anyone who can read the outbox can sign in as anyone, so it never runs on Vercel
 * production.
 */

const HOUR_MS = 60 * 60 * 1000;
export const LINKS_PER_EMAIL_PER_HOUR = 5;
export const LINKS_PER_IP_PER_HOUR = 20;
/** Minimum gap between two links to the same address (the "resend" button). */
export const RESEND_GAP_MS = 60 * 1000;

/** Tests only. */
export function resetMockAuthState(): void {
  resetRateLimits();
}

function assertMockAllowed(): void {
  if (getEnv().isVercelProduction) {
    throw new AuthError(
      "not_available",
      "Mock auth is disabled on Vercel production: anyone reading the outbox could sign in.",
    );
  }
}

function requireAppUrl(): string {
  const base = getEnv().appUrl;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is required to build sign-in links in production.");
  return base;
}

export function createMockAuth(): Auth {
  return {
    async requestMagicLink(input, consent, opts) {
      assertMockAllowed();
      if (consent !== true) throw new AuthError("consent_required");
      const email = normalizeEmail(input);
      if (!email) throw new AuthError("invalid_email");
      const appUrl = requireAppUrl();

      const buckets: Bucket[] = [
        { key: `email:${email}`, limit: LINKS_PER_EMAIL_PER_HOUR, windowMs: HOUR_MS },
        { key: `email-gap:${email}`, limit: 1, windowMs: RESEND_GAP_MS },
      ];
      if (opts?.ip) buckets.push({ key: `ip:${opts.ip}`, limit: LINKS_PER_IP_PER_HOUR, windowMs: HOUR_MS });
      if (!takeAll(buckets)) throw new AuthError("rate_limited");

      // Same path for a known and an unknown address: the account is made when the link is opened.
      const { token, jti, expiresAt } = await signMagicToken(email);
      const mock = await getMockDb();
      await mock.withAdmin((tx) =>
        tx.query("insert into mock_meta.magic_links (jti, email, expires_at) values ($1, $2, $3)", [
          jti,
          email,
          expiresAt.toISOString(),
        ]),
      );

      const message = magicLinkEmail(`${appUrl}/auth/callback?token=${encodeURIComponent(token)}`);
      try {
        await sendEmail({ to: email, kind: "magic_link", ...message });
      } catch (e) {
        if (e instanceof EmailSendError) throw new AuthError("email_failed", e.message);
        throw e;
      }
    },

    async checkMagicLink(token) {
      assertMockAllowed();
      const payload = await verifyMagicToken(token);
      if (!payload) return false;
      const mock = await getMockDb();
      const rows = await mock.withAdmin((tx) =>
        tx.query("select 1 from mock_meta.magic_links where jti = $1 and email = $2 and used_at is null", [
          payload.jti,
          payload.email,
        ]),
      );
      return rows.length > 0;
    },

    async consumeMagicLink(token) {
      assertMockAllowed();
      const payload = await verifyMagicToken(token);
      if (!payload) throw new AuthError("invalid_link");

      const mock = await getMockDb();
      // One statement marks the link used only if it was not used before, so two
      // clicks at once cannot both win. The stub does not grant auth.users to
      // service_role, so the owner connection is used (real Supabase Auth creates
      // this row itself).
      const user = await mock.withAdmin(async (tx) => {
        const used = await tx.query<{ jti: string }>(
          `update mock_meta.magic_links set used_at = now()
           where jti = $1 and email = $2 and used_at is null
           returning jti`,
          [payload.jti, payload.email],
        );
        if (used.length === 0) return null;
        const [row] = await tx.query<{ id: string }>(
          `insert into auth.users (email) values ($1)
           on conflict (email) do update set email = excluded.email
           returning id`,
          [payload.email],
        );
        return row;
      });
      if (!user) throw new AuthError("invalid_link");

      // Consent time is set on first sign-in only; a returning owner keeps the first one.
      const [profile] = await mock.withService(async (tx) => {
        await tx.query(
          `insert into public.profiles (id, email, consent_at) values ($1, $2, now())
           on conflict (id) do nothing`,
          [user.id, payload.email],
        );
        return tx.query<{ phone: string | null }>("select phone from public.profiles where id = $1", [
          user.id,
        ]);
      });

      const result: AuthUser = { id: user.id, email: payload.email, phone: profile?.phone ?? null };
      const store = await cookies();
      store.set(SESSION_COOKIE, await signSession({ id: result.id, email: payload.email }), sessionCookieOptions());
      return result;
    },

    async getCurrentUser() {
      assertMockAllowed();
      const store = await cookies();
      const payload = await verifySession(store.get(SESSION_COOKIE)?.value);
      if (!payload) return null;
      // A valid cookie for a user that no longer exists (e.g. .data was wiped) is signed out.
      const mock = await getMockDb();
      const rows = await mock.withService((tx) =>
        tx.query<{ id: string; email: string | null; phone: string | null }>(
          "select id, email, phone from public.profiles where id = $1",
          [payload.sub],
        ),
      );
      return rows[0] ? { id: rows[0].id, email: rows[0].email, phone: rows[0].phone } : null;
    },

    async signOut() {
      const store = await cookies();
      store.delete(SESSION_COOKIE);
    },
  };
}
