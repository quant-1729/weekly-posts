import { IT, assertSafeEnvironment, cleanupAfterAll, itEmail, trackEmail } from "./helpers";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// In-memory cookie jar standing in for next/headers cookies().
const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api }));

import { getAuth } from "@/lib/auth";
import { AuthError } from "@/lib/auth/types";
import { LINKS_PER_EMAIL_PER_HOUR, LINKS_PER_IP_PER_HOUR } from "@/lib/auth/links";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { linksIn, listOutbox } from "@/lib/email/outbox";
import { randomId } from "./sweep";

/** The app's own magic-link sign-in on the Supabase backend (D8). Emails go to the mock outbox, never to a real inbox. */

cleanupAfterAll();

const auth = () => getAuth();

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AuthError) return e.code;
    throw e;
  }
  return undefined;
}

/** The token in the newest emailed link, for this address. */
async function tokenFor(email: string): Promise<string> {
  const mails = (await listOutbox(20)).filter((m) => m.to === email);
  expect(mails.length).toBeGreaterThan(0);
  const url = new URL(linksIn(mails[0].text)[0]);
  expect(url.pathname).toBe("/auth/callback");
  return url.searchParams.get("token")!;
}

const userIdByEmail = async (email: string) =>
  (await getDb().withService((tx) => tx.query<{ id: string | null }>("select public.auth_user_id_by_email($1) as id", [email])))[0].id;

/** Lets the next link for this address through the 60-second gap without waiting. */
const skipGap = (email: string) =>
  getDb().withService((tx) =>
    tx.query("update public.magic_links set created_at = created_at - interval '2 minutes' where lower(email) = $1", [email]),
  );

describe.skipIf(!IT)("Supabase magic-link sign-in", () => {
  beforeAll(() => assertSafeEnvironment());
  beforeEach(() => jar.store.clear());
  afterEach(() => vi.unstubAllEnvs());

  it("request, check, consume: creates the auth user and profile with consent time; a second use is refused", async () => {
    const email = itEmail();
    trackEmail(email);
    const before = Date.now() - 10_000;
    await auth().requestMagicLink(email, true, { ip: `it-${randomId()}` });

    // The link went to the mock outbox (no Resend key), addressed to the normalised address.
    const [mail] = await listOutbox(1);
    expect(mail).toMatchObject({ to: email, kind: "magic_link" });
    const token = await tokenFor(email);

    // Same answer for an unknown address: no user exists until the link is opened.
    expect(await userIdByEmail(email)).toBeNull();

    // Checking changes nothing (mail scanners open links first).
    expect(await auth().checkMagicLink(token)).toBe(true);
    expect(await auth().checkMagicLink(token)).toBe(true);
    expect(await userIdByEmail(email)).toBeNull();
    const unused = await getDb().withService((tx) =>
      tx.query<{ used_at: Date | null }>("select used_at from public.magic_links where lower(email) = $1", [email]),
    );
    expect(unused).toHaveLength(1);
    expect(unused[0].used_at).toBeNull();
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);

    const user = await auth().consumeMagicLink(token);
    expect(user.email).toBe(email);
    expect(user.phone).toBeNull();
    expect(await userIdByEmail(email)).toBe(user.id);

    const [profile] = await getDb().withService((tx) =>
      tx.query<{ email: string; consent_at: Date }>("select email, consent_at from public.profiles where id = $1", [user.id]),
    );
    expect(profile.email).toBe(email);
    expect(profile.consent_at).toBeInstanceOf(Date);
    expect(profile.consent_at.getTime()).toBeGreaterThan(before);

    // The session cookie is the app's own, signed with AUTH_SECRET, and getCurrentUser reads it.
    const session = await verifySession(jar.store.get(SESSION_COOKIE));
    expect(session).toMatchObject({ sub: user.id, email });
    expect(await auth().getCurrentUser()).toEqual(user);

    // The link is used up.
    const used = await getDb().withService((tx) =>
      tx.query<{ used_at: Date | null }>("select used_at from public.magic_links where lower(email) = $1", [email]),
    );
    expect(used[0].used_at).toBeInstanceOf(Date);
    jar.store.clear();
    expect(await auth().checkMagicLink(token)).toBe(false);
    expect(await code(() => auth().consumeMagicLink(token))).toBe("invalid_link");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);

    await auth().signOut();
    expect(await auth().getCurrentUser()).toBeNull();
  });

  it("a returning owner keeps the same user id and the first consent time", async () => {
    const email = itEmail();
    trackEmail(email);
    await auth().requestMagicLink(email, true);
    const first = await auth().consumeMagicLink(await tokenFor(email));
    const [{ consent_at: c1 }] = await getDb().withService((tx) =>
      tx.query<{ consent_at: Date }>("select consent_at from public.profiles where id = $1", [first.id]),
    );

    await skipGap(email);
    await auth().requestMagicLink(email.toUpperCase(), true);
    const second = await auth().consumeMagicLink(await tokenFor(email));
    expect(second.id).toBe(first.id);

    const profiles = await getDb().withService((tx) =>
      tx.query<{ consent_at: Date }>("select consent_at from public.profiles where email = $1", [email]),
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0].consent_at.getTime()).toBe(c1.getTime());
  });

  it("two clicks at once: only one wins and only one user is made", async () => {
    const email = itEmail();
    trackEmail(email);
    await auth().requestMagicLink(email, true);
    const token = await tokenFor(email);
    const results = await Promise.all([code(() => auth().consumeMagicLink(token)), code(() => auth().consumeMagicLink(token))]);
    expect(results.filter((r) => r === undefined)).toHaveLength(1);
    expect(results.filter((r) => r === "invalid_link")).toHaveLength(1);
    expect(await userIdByEmail(email)).not.toBeNull();
  });

  it("two different links for one new address opened at once give one user", async () => {
    const email = itEmail();
    trackEmail(email);
    await auth().requestMagicLink(email, true);
    const t1 = await tokenFor(email);
    await skipGap(email);
    await auth().requestMagicLink(email, true);
    const t2 = await tokenFor(email);
    expect(t2).not.toBe(t1);
    const [u1, u2] = await Promise.all([auth().consumeMagicLink(t1), auth().consumeMagicLink(t2)]);
    expect(u1.id).toBe(u2.id);
  });

  it("refuses without consent, for an invalid address, and for a tampered or unknown link; stores nothing", async () => {
    const email = itEmail();
    trackEmail(email);
    expect(await code(() => auth().requestMagicLink(email, false))).toBe("consent_required");
    expect(await code(() => auth().requestMagicLink("not-an-email", true))).toBe("invalid_email");
    const rows = await getDb().withService((tx) => tx.query("select 1 from public.magic_links where lower(email) = $1", [email]));
    expect(rows).toHaveLength(0);

    await auth().requestMagicLink(email, true);
    const token = await tokenFor(email);
    const [h, p, sig] = token.split(".");
    expect(await code(() => auth().consumeMagicLink(`${h}.${p}x.${sig}`))).toBe("invalid_link");
    expect(await code(() => auth().consumeMagicLink("garbage"))).toBe("invalid_link");
    expect(await userIdByEmail(email)).toBeNull();
  });

  it("rate limits come from public.magic_links: 60-second gap, 5 per address per hour, 20 per IP per hour", async () => {
    // Gap: a second link straight away is refused, and the refused request stored nothing.
    const gapEmail = itEmail();
    trackEmail(gapEmail);
    await auth().requestMagicLink(gapEmail, true);
    expect(await code(() => auth().requestMagicLink(gapEmail, true))).toBe("rate_limited");
    const gapRows = await getDb().withService((tx) => tx.query("select 1 from public.magic_links where lower(email) = $1", [gapEmail]));
    expect(gapRows).toHaveLength(1);

    // Per address: 5 earlier links in the last hour (written by "other instances"), then the 6th is refused.
    const hourEmail = itEmail();
    trackEmail(hourEmail);
    await getDb().withService(async (tx) => {
      for (let i = 0; i < LINKS_PER_EMAIL_PER_HOUR; i++) {
        await tx.query(
          `insert into public.magic_links (jti, email, ip, expires_at, created_at)
           values ($1, $2, null, now() + interval '15 minutes', now() - ($3 || ' minutes')::interval)`,
          [`it-${randomId()}`, hourEmail, String(5 + i * 5)],
        );
      }
    });
    expect(await code(() => auth().requestMagicLink(hourEmail, true))).toBe("rate_limited");
    // An hour later it is fine.
    await getDb().withService((tx) =>
      tx.query("update public.magic_links set created_at = now() - interval '2 hours' where lower(email) = $1", [hourEmail]),
    );
    expect(await code(() => auth().requestMagicLink(hourEmail, true))).toBeUndefined();

    // Per IP: 20 links from one IP across other addresses.
    const ip = `it-ip-${randomId()}`;
    await getDb().withService(async (tx) => {
      for (let i = 0; i < LINKS_PER_IP_PER_HOUR; i++) {
        const e = itEmail();
        trackEmail(e);
        await tx.query(
          `insert into public.magic_links (jti, email, ip, expires_at, created_at)
           values ($1, $2, $3, now() + interval '15 minutes', now() - interval '10 minutes')`,
          [`it-${randomId()}`, e, ip],
        );
      }
    });
    const ipEmail = itEmail();
    trackEmail(ipEmail);
    expect(await code(() => auth().requestMagicLink(ipEmail, true, { ip }))).toBe("rate_limited");
    expect(await code(() => auth().requestMagicLink(ipEmail, true, { ip: `it-ip-${randomId()}` }))).toBeUndefined();
  });

  it("a signed cookie for a user that no longer exists is treated as signed out", async () => {
    const { signSession } = await import("@/lib/auth/session");
    jar.api.set(SESSION_COOKIE, await signSession({ id: "00000000-0000-4000-8000-000000000000", email: "it-ghost@example.com", sid: "00000000-0000-4000-8000-000000000001" }));
    expect(await auth().getCurrentUser()).toBeNull();
  });

  it("never sent a real email: Resend is off and the sign-in mails are in the mock outbox", async () => {
    expect(process.env.RESEND_API_KEY).toBe("");
    expect(process.env.EMAIL_FROM).toBe("");
    const mails = await listOutbox(50);
    expect(mails.length).toBeGreaterThan(0);
    expect(mails.every((m) => m.to.startsWith("it-") && m.to.endsWith("@example.com"))).toBe(true);
  });
});
