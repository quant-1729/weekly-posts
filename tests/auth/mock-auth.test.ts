import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// In-memory cookie jar standing in for next/headers cookies().
const jar = vi.hoisted(() => {
  const store = new Map<string, { value: string; options?: Record<string, unknown> }>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)!.value } : undefined),
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        store.set(name, { value, options });
      },
      delete: (name: string) => {
        store.delete(name);
      },
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api }));

import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import {
  LINKS_PER_EMAIL_PER_HOUR,
  LINKS_PER_IP_PER_HOUR,
  RESEND_GAP_MS,
  createMockAuth,
  resetMockAuthState,
} from "@/lib/auth/mock";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { MAGIC_LINK_TTL_SECONDS, signMagicToken } from "@/lib/auth/magic-link";
import { AuthError } from "@/lib/auth/types";
import { linksIn, listOutbox, setOutboxDirForTests } from "@/lib/email/outbox";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  needsRefresh,
  verifySession,
} from "@/lib/auth/session";
import { signSession, signSessionNoRow } from "../helpers/session";

let db: MockDb;
let outbox: string;
const auth = createMockAuth();
const EMAIL = "Owner@Example.com";
const NORMAL = "owner@example.com";

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AuthError) return e.code;
    throw e;
  }
  return undefined;
}

/** The token in the newest emailed link. */
async function latestToken(): Promise<string> {
  const [mail] = await listOutbox(1);
  const url = new URL(linksIn(mail.text)[0]);
  expect(url.pathname).toBe("/auth/callback");
  return url.searchParams.get("token")!;
}

/** Requests a link for `email` and returns its token. */
async function linkFor(email: string = EMAIL): Promise<string> {
  await auth.requestMagicLink(email, true);
  return latestToken();
}

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  await resetMockAuthState();
  jar.store.clear();
  outbox = await mkdtemp(path.join(os.tmpdir(), "outbox-"));
  setOutboxDirForTests(outbox);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setOutboxDirForTests(null);
  await rm(outbox, { recursive: true, force: true });
});

describe("mock magic-link sign-in (Req 1)", () => {
  it("emails one link to the normalised address, kind magic_link, with an html and a text version", async () => {
    await auth.requestMagicLink(`  ${EMAIL} `, true);
    const mails = await listOutbox();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: NORMAL, kind: "magic_link" });
    expect(mails[0].subject).toContain("Weekly Posts");
    expect(mails[0].html).toContain("/auth/callback?token=");
    expect(mails[0].text).toContain("/auth/callback?token=");
    expect(linksIn(mails[0].text)[0].startsWith("http://localhost:3000/auth/callback?token=")).toBe(true);
  });

  it("uses NEXT_PUBLIC_APP_URL for the link", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3100/");
    await auth.requestMagicLink(EMAIL, true);
    const [mail] = await listOutbox(1);
    expect(linksIn(mail.text)[0].startsWith("http://localhost:3100/auth/callback?token=")).toBe(true);
  });

  it("rejects a request without consent, and an invalid address, and sends nothing", async () => {
    expect(await code(() => auth.requestMagicLink(EMAIL, false))).toBe("consent_required");
    expect(await code(() => auth.requestMagicLink(EMAIL, undefined as unknown as boolean))).toBe(
      "consent_required",
    );
    expect(await code(() => auth.requestMagicLink("not-an-email", true))).toBe("invalid_email");
    expect(await listOutbox()).toHaveLength(0);
  });

  it("answers the same for a known and an unknown address", async () => {
    await auth.consumeMagicLink(await linkFor("known@example.com"));
    jar.store.clear();
    await resetMockAuthState();

    const known = await auth.requestMagicLink("known@example.com", true).then(() => "ok", (e) => e);
    const unknown = await auth.requestMagicLink("stranger@example.com", true).then(() => "ok", (e) => e);
    expect(known).toBe("ok");
    expect(unknown).toBe(known);
    // Both really got an email, and neither created a user yet.
    expect((await listOutbox()).map((m) => m.to).sort()).toEqual([
      "known@example.com",
      "known@example.com",
      "stranger@example.com",
    ]);
    const users = await db.withAdmin((tx) =>
      tx.query("select id from auth.users where email = 'stranger@example.com'"),
    );
    expect(users).toHaveLength(0);
  });

  it("stores the link id so it can be used once", async () => {
    const token = await linkFor();
    const rows = await db.withAdmin((tx) =>
      tx.query<{ email: string; used_at: Date | null }>(
        "select email, used_at from public.magic_links where email = $1",
        [NORMAL],
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    await auth.consumeMagicLink(token);
    const after = await db.withAdmin((tx) =>
      tx.query<{ used_at: Date | null }>("select used_at from public.magic_links where email = $1", [NORMAL]),
    );
    expect(after.some((r) => r.used_at instanceof Date)).toBe(true);
  });

  it("the magic_links table is in public, with row-level security and no access for anon or authenticated", async () => {
    const rows = await db.withAdmin((tx) =>
      tx.query<{ table_schema: string }>(
        "select table_schema from information_schema.tables where table_name = 'magic_links'",
      ),
    );
    expect(rows).toEqual([{ table_schema: "public" }]);
    const [rls] = await db.withAdmin((tx) =>
      tx.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.magic_links'::regclass"),
    );
    expect(rls.relrowsecurity).toBe(true);
    const grants = await db.withAdmin((tx) =>
      tx.query("select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'magic_links' and grantee in ('anon', 'authenticated')"),
    );
    expect(grants).toHaveLength(0);
  });

  it("a link works once; the second use is rejected and starts no session", async () => {
    const token = await linkFor();
    const user = await auth.consumeMagicLink(token);
    expect(user.email).toBe(NORMAL);

    jar.store.clear();
    expect(await code(() => auth.consumeMagicLink(token))).toBe("invalid_link");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("two simultaneous clicks: only one wins", async () => {
    const token = await linkFor();
    const results = await Promise.all([
      code(() => auth.consumeMagicLink(token)),
      code(() => auth.consumeMagicLink(token)),
    ]);
    expect(results.filter((r) => r === undefined)).toHaveLength(1);
    expect(results.filter((r) => r === "invalid_link")).toHaveLength(1);
  });

  it("an expired link is rejected (15 minutes)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    const token = await linkFor();
    expect(MAGIC_LINK_TTL_SECONDS).toBe(15 * 60);

    vi.setSystemTime(new Date("2026-10-13T10:16:00Z"));
    expect(await code(() => auth.consumeMagicLink(token))).toBe("invalid_link");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("a link still works just before the 15 minutes are up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    const token = await linkFor();
    vi.setSystemTime(new Date("2026-10-13T10:14:30Z"));
    expect(await code(() => auth.consumeMagicLink(token))).toBeUndefined();
  });

  it("a tampered, foreign, empty or non-link token is rejected", async () => {
    const token = await linkFor();
    const [h, p, sig] = token.split(".");
    expect(await code(() => auth.consumeMagicLink(`${h}.${p}x.${sig}`))).toBe("invalid_link");
    expect(await code(() => auth.consumeMagicLink(`${h}.${p}.${sig}x`))).toBe("invalid_link");
    expect(await code(() => auth.consumeMagicLink("garbage"))).toBe("invalid_link");
    expect(await code(() => auth.consumeMagicLink(""))).toBe("invalid_link");

    // A session cookie is not a sign-in link.
    const session = await signSessionNoRow({ id: "11111111-1111-4111-8111-111111111111", email: NORMAL });
    expect(await code(() => auth.consumeMagicLink(session))).toBe("invalid_link");

    // A sign-in link signed with another secret.
    vi.stubEnv("AUTH_SECRET", "another-secret-another-secret-another");
    const foreign = (await signMagicToken(NORMAL)).token;
    vi.unstubAllEnvs();
    expect(await code(() => auth.consumeMagicLink(foreign))).toBe("invalid_link");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("a validly signed link whose id was never issued is rejected", async () => {
    const { token } = await signMagicToken(NORMAL);
    expect(await code(() => auth.consumeMagicLink(token))).toBe("invalid_link");
  });

  it("a sign-in link is not accepted as a session cookie", async () => {
    const { token } = await signMagicToken(NORMAL);
    expect(await verifySession(token)).toBeNull();
  });

  it("a new user gets an auth user and a profile with email and consent_at", async () => {
    const before = Date.now() - 5000;
    const user = await auth.consumeMagicLink(await linkFor("New.Owner@Example.com"));
    expect(user.email).toBe("new.owner@example.com");
    expect(user.phone).toBeNull();

    const rows = await db.withService((tx) =>
      tx.query<{ id: string; email: string; phone: string | null; consent_at: Date | null }>(
        "select id, email, phone, consent_at from public.profiles where id = $1",
        [user.id],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("new.owner@example.com");
    expect(rows[0].phone).toBeNull();
    expect(rows[0].consent_at).toBeInstanceOf(Date);
    expect(rows[0].consent_at!.getTime()).toBeGreaterThan(before);
    const users = await db.withAdmin((tx) =>
      tx.query("select id from auth.users where email = 'new.owner@example.com'"),
    );
    expect(users).toHaveLength(1);
  });

  it("a returning owner gets the same user, no duplicate profile, and keeps the first consent time", async () => {
    const first = await auth.consumeMagicLink(await linkFor("back@example.com"));
    const [{ consent_at: c1 }] = await db.withService((tx) =>
      tx.query<{ consent_at: Date }>("select consent_at from public.profiles where id = $1", [first.id]),
    );

    await resetMockAuthState(); // skip the 60-second resend gap
    const second = await auth.consumeMagicLink(await linkFor("  BACK@example.com "));
    expect(second.id).toBe(first.id);

    const profiles = await db.withService((tx) =>
      tx.query<{ consent_at: Date }>("select consent_at from public.profiles where email = 'back@example.com'"),
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0].consent_at.getTime()).toBe(c1.getTime());
    const users = await db.withAdmin((tx) => tx.query("select id from auth.users where email = 'back@example.com'"));
    expect(users).toHaveLength(1);
  });

  it("sets an httpOnly, SameSite=Lax cookie that lasts 30 days, and getCurrentUser reads it", async () => {
    const user = await auth.consumeMagicLink(await linkFor());
    const c = jar.store.get(SESSION_COOKIE)!;
    expect(c.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      secure: false, // NODE_ENV is "test" here
    });
    expect(await auth.getCurrentUser()).toEqual(user);
    expect(await auth.getCurrentUser()).toMatchObject({ email: NORMAL, phone: null });
  });

  it("marks the cookie secure in production, and needs NEXT_PUBLIC_APP_URL there", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    await expect(auth.requestMagicLink(EMAIL, true)).rejects.toThrow("NEXT_PUBLIC_APP_URL");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    await auth.consumeMagicLink(await linkFor());
    expect(jar.store.get(SESSION_COOKIE)!.options).toMatchObject({ secure: true });
    const [mail] = await listOutbox(1);
    expect(linksIn(mail.text)[0].startsWith("https://app.example.com/auth/callback?token=")).toBe(true);
  });

  it("signOut clears the cookie", async () => {
    await auth.consumeMagicLink(await linkFor());
    await auth.signOut();
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it("a valid cookie for a user that no longer exists is treated as signed out", async () => {
    const token = await signSessionNoRow({ id: "00000000-0000-4000-8000-000000000000", email: NORMAL });
    jar.api.set(SESSION_COOKIE, token);
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it("an expired cookie is rejected by getCurrentUser", async () => {
    const user = await auth.consumeMagicLink(await linkFor());
    const old = await signSession({ id: user.id, email: NORMAL }, Date.now() - (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    jar.api.set(SESSION_COOKIE, old);
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it("refuses to run when VERCEL_ENV is production", async () => {
    const token = await linkFor();
    vi.stubEnv("VERCEL_ENV", "production");
    jar.store.clear();
    const before = (await listOutbox()).length;
    expect(await code(() => auth.requestMagicLink(EMAIL, true))).toBe("not_available");
    expect(await code(() => auth.consumeMagicLink(token))).toBe("not_available");
    expect(await code(() => auth.getCurrentUser())).toBe("not_available");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
    expect((await listOutbox()).length).toBe(before);
  });
});

describe("rate limits", () => {
  it("allows 5 links per address per hour (spaced over the 60-second gap) and refuses the 6th", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    for (let i = 0; i < LINKS_PER_EMAIL_PER_HOUR; i++) {
      await auth.requestMagicLink(EMAIL, true);
      vi.setSystemTime(new Date(Date.now() + RESEND_GAP_MS + 1000));
    }
    expect(await code(() => auth.requestMagicLink(EMAIL, true))).toBe("rate_limited");
    expect(await listOutbox()).toHaveLength(5);

    // Another address is unaffected; the same address is fine after the hour.
    expect(await code(() => auth.requestMagicLink("other@example.com", true))).toBeUndefined();
    vi.setSystemTime(new Date("2026-10-13T11:10:00Z"));
    expect(await code(() => auth.requestMagicLink(EMAIL, true))).toBeUndefined();
  });

  it("allows one link per address every 60 seconds (resend)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    await auth.requestMagicLink(EMAIL, true);
    vi.setSystemTime(new Date(Date.now() + RESEND_GAP_MS - 1000));
    expect(await code(() => auth.requestMagicLink(EMAIL, true))).toBe("rate_limited");
    vi.setSystemTime(new Date(Date.now() + 2000));
    expect(await code(() => auth.requestMagicLink(EMAIL, true))).toBeUndefined();
  });

  it("allows 20 links per IP per hour across different addresses and refuses the 21st", async () => {
    for (let i = 0; i < LINKS_PER_IP_PER_HOUR; i++) {
      await auth.requestMagicLink(`person${i}@example.com`, true, { ip: "203.0.113.7" });
    }
    expect(await code(() => auth.requestMagicLink("one-more@example.com", true, { ip: "203.0.113.7" }))).toBe(
      "rate_limited",
    );
    // Another IP is fine, and the refused request used up nothing for that address.
    expect(await code(() => auth.requestMagicLink("one-more@example.com", true, { ip: "203.0.113.8" }))).toBeUndefined();
  });

  it("counts from public.magic_links, not memory: a fresh auth instance and an empty in-memory limiter still refuse", async () => {
    await auth.requestMagicLink(EMAIL, true, { ip: "203.0.113.50" });
    resetRateLimits(); // what a new serverless instance would have in memory
    const fresh = createMockAuth();
    expect(await code(() => fresh.requestMagicLink(EMAIL, true))).toBe("rate_limited"); // 60-second gap

    // The address and the IP are stored with the link.
    const [row] = await db.withAdmin((tx) =>
      tx.query<{ email: string; ip: string | null }>("select email, ip from public.magic_links"),
    );
    expect(row).toEqual({ email: NORMAL, ip: "203.0.113.50" });
  });

  it("the per-address and per-IP counts come from rows written by anyone, in any instance", async () => {
    // Links already recorded (as if by other instances) in the last hour, spaced beyond the 60-second gap.
    await db.withAdmin(async (tx) => {
      for (let i = 0; i < LINKS_PER_EMAIL_PER_HOUR; i++) {
        await tx.query(
          `insert into public.magic_links (jti, email, ip, expires_at, created_at)
           values ($1, $2, null, now() + interval '15 minutes', now() - ($3 || ' minutes')::interval)`,
          [`other-${i}`, NORMAL, String(5 + i * 5)],
        );
      }
      for (let i = 0; i < LINKS_PER_IP_PER_HOUR; i++) {
        await tx.query(
          `insert into public.magic_links (jti, email, ip, expires_at, created_at)
           values ($1, $2, '203.0.113.60', now() + interval '15 minutes', now() - interval '10 minutes')`,
          [`ip-${i}`, `p${i}@example.com`],
        );
      }
    });
    resetRateLimits();
    const fresh = createMockAuth();
    expect(await code(() => fresh.requestMagicLink(EMAIL, true))).toBe("rate_limited");
    expect(await code(() => fresh.requestMagicLink("new-person@example.com", true, { ip: "203.0.113.60" }))).toBe(
      "rate_limited",
    );
    expect(await code(() => fresh.requestMagicLink("new-person@example.com", true, { ip: "203.0.113.61" }))).toBeUndefined();
    // Links older than an hour no longer count.
    await db.withAdmin((tx) => tx.query("update public.magic_links set created_at = now() - interval '2 hours'"));
    expect(await code(() => fresh.requestMagicLink(EMAIL, true))).toBeUndefined();
  });

  it("two requests for one address at the same moment: only one link is made", async () => {
    const results = await Promise.all([
      code(() => auth.requestMagicLink(EMAIL, true)),
      code(() => auth.requestMagicLink(EMAIL, true)),
    ]);
    expect(results.filter((r) => r === undefined)).toHaveLength(1);
    expect(results.filter((r) => r === "rate_limited")).toHaveLength(1);
    expect(await listOutbox()).toHaveLength(1);
  });

  it("a refused or invalid request does not use up allowance", async () => {
    await auth.requestMagicLink(EMAIL, true, { ip: "198.51.100.1" });
    for (let i = 0; i < 30; i++) {
      await code(() => auth.requestMagicLink(EMAIL, true, { ip: "198.51.100.1" })); // refused by the gap
      await code(() => auth.requestMagicLink("bad", true, { ip: "198.51.100.1" })); // invalid
      await code(() => auth.requestMagicLink(EMAIL, false, { ip: "198.51.100.1" })); // no consent
    }
    expect(await code(() => auth.requestMagicLink("fresh@example.com", true, { ip: "198.51.100.1" }))).toBeUndefined();
  });
});

describe("session token: 30 days, sliding", () => {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: NORMAL };
  const DAY = 24 * 60 * 60 * 1000;

  it("is valid for 30 days and rejected after", async () => {
    const t0 = Date.parse("2026-10-12T00:00:00Z");
    const token = await signSessionNoRow(user, t0);
    expect((await verifySession(token, t0 + 29 * DAY))?.sub).toBe(user.id);
    expect((await verifySession(token, t0 + 30 * DAY - 1000))?.sub).toBe(user.id);
    expect(await verifySession(token, t0 + 30 * DAY + 1000)).toBeNull();
  });

  it("carries the email, not a phone", async () => {
    expect(await verifySession(await signSessionNoRow(user))).toMatchObject({ sub: user.id, email: NORMAL });
  });

  it("is renewed only once it is more than a day old", async () => {
    const t0 = Date.parse("2026-10-12T00:00:00Z");
    const p = (await verifySession(await signSessionNoRow(user, t0), t0))!;
    expect(needsRefresh(p, t0 + 12 * 60 * 60 * 1000)).toBe(false);
    expect(needsRefresh(p, t0 + DAY + 60 * 1000)).toBe(true);
  });

  it("rejects a token signed with another secret, a tampered token and garbage", async () => {
    const token = await signSessionNoRow(user);
    vi.stubEnv("AUTH_SECRET", "another-secret-another-secret-another");
    expect(await verifySession(token)).toBeNull();
    vi.unstubAllEnvs();
    const [h, p, s] = token.split(".");
    expect(await verifySession(`${h}.${p}x.${s}`)).toBeNull();
    expect(await verifySession("not-a-token")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
});
