import { getEnv } from "@/lib/env";
import { getMockDb } from "@/lib/db/mock";
import { resetRateLimits } from "./rate-limit";
import { createLinkAuth } from "./links";
import { AuthError, type Auth } from "./types";

export { LINKS_PER_EMAIL_PER_HOUR, LINKS_PER_IP_PER_HOUR, RESEND_GAP_MS } from "./links";

/**
 * Mock sign-in: the shared magic-link flow (links.ts) with auth users kept in the mock
 * database. The emailed link goes to the dev outbox (.data/outbox, /dev/outbox). Anyone
 * who can read the outbox can sign in as anyone, so it never runs on Vercel production.
 */

/** Tests only: forgets sign-in links (and so the rate limits counted from them) and the in-memory limiter used elsewhere. */
export async function resetMockAuthState(): Promise<void> {
  resetRateLimits();
  const mock = await getMockDb();
  await mock.withAdmin((tx) => tx.query("delete from public.magic_links"));
}

function assertMockAllowed(): void {
  if (getEnv().isHostedProduction) {
    throw new AuthError(
      "not_available",
      "Mock auth is disabled on Vercel production and Cloud Run: anyone reading the outbox could sign in.",
    );
  }
}

export function createMockAuth(): Auth {
  return createLinkAuth({
    assertAllowed: assertMockAllowed,
    async findOrCreateUser(email) {
      // The stub does not grant auth.users to service_role, so the owner connection is used
      // (real Supabase creates this row through the Auth admin API).
      const mock = await getMockDb();
      const [row] = await mock.withAdmin((tx) =>
        tx.query<{ id: string }>(
          `insert into auth.users (email) values ($1)
           on conflict (email) do update set email = excluded.email
           returning id`,
          [email],
        ),
      );
      return row.id;
    },
  });
}
