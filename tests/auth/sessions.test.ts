import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Cookie jar and request headers standing in for next/headers.
const env = vi.hoisted(() => {
  const store = new Map<string, { value: string; options?: Record<string, unknown> }>();
  return {
    store,
    reqHeaders: new Headers(),
    cookies: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)!.value } : undefined),
      set: (name: string, value: string, options?: Record<string, unknown>) => void store.set(name, { value, options }),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => env.cookies, headers: async () => env.reqHeaders }));

import { SignJWT } from "jose";
import { createMockAuth, resetMockAuthState } from "@/lib/auth/mock";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { getEnv } from "@/lib/env";
import { linksIn, listOutbox, setOutboxDirForTests } from "@/lib/email/outbox";
import { purgeOldSessionData, revokeSession, TOUCH_AFTER_MS } from "@/lib/sessions";
import { signSession as signWithRow } from "../helpers/session";

let db: MockDb;
let outbox: string;
const auth = createMockAuth();
const EMAIL = "devices@example.com"; // only used in "must not appear" checks
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const RAW_IP = "203.0.113.77";

interface Row {
  id: string;
  user_id: string;
  user_agent: string | null;
  browser: string | null;
  os: string | null;
  device_type: string;
  country: string | null;
  city: string | null;
  ip_hash: string | null;
  last_seen_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
}

const sessions = (userId?: string) =>
  db.withAdmin((tx) =>
    tx.query<Row>(
      userId
        ? "select * from public.user_sessions where user_id = $1 order by created_at"
        : "select * from public.user_sessions order by created_at",
      userId ? [userId] : [],
    ),
  );
const events = (kind: string) =>
  db.withAdmin((tx) => tx.query<{ user_id: string | null; session_id: string | null; ok: boolean; detail: Record<string, unknown> }>("select user_id, session_id, ok, detail from public.app_events where kind = $1 order by id", [kind]));

/** Fire-and-forget log writes land a moment later: wait for them. */
async function eventually<T>(read: () => Promise<T[]>, n = 1): Promise<T[]> {
  for (let i = 0; i < 50; i++) {
    const rows = await read();
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return read();
}

let n = 0;
async function signIn(email = `devices${++n}@example.com`, headers: Record<string, string> = {}) {
  env.reqHeaders = new Headers({ "user-agent": CHROME_WIN, "x-forwarded-for": `${RAW_IP}, 10.0.0.1`, ...headers });
  await resetMockAuthState(); // skip the resend gap
  await auth.requestMagicLink(email, true);
  const [mail] = await listOutbox(1);
  const token = new URL(linksIn(mail.text)[0]).searchParams.get("token")!;
  return auth.consumeMagicLink(token);
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
  env.store.clear();
  outbox = await mkdtemp(path.join(os.tmpdir(), "outbox-"));
  setOutboxDirForTests(outbox);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setOutboxDirForTests(null);
  await rm(outbox, { recursive: true, force: true });
});

describe("sign-in sessions (ADM-2)", () => {
  it("sign-in creates a session row with the parsed user agent, and its id is the cookie's sid", async () => {
    const user = await signIn();
    const rows = await sessions(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: user.sessionId,
      browser: "Chrome 130",
      os: "Windows",
      device_type: "desktop",
      country: null, // no GEOIP_DB_PATH in tests
      city: null,
      revoked_at: null,
      revoked_by: null,
    });
    expect(rows[0].user_agent).toBe(CHROME_WIN);
    const payload = await verifySession(env.store.get(SESSION_COOKIE)!.value);
    expect(payload).toMatchObject({ sub: user.id, sid: rows[0].id });
  });

  it("stores only a keyed hash of the IP: the raw address is nowhere in the row", async () => {
    const user = await signIn();
    const [row] = await sessions(user.id);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain(RAW_IP);
    expect(JSON.stringify(row)).not.toContain("203.0.113");
    // Same address, same hash; another address, another hash; another secret, another hash.
    await signIn(user.email!);
    await signIn(user.email!, { "x-forwarded-for": "198.51.100.9" });
    const all = await sessions(user.id);
    expect(all[1].ip_hash).toBe(all[0].ip_hash);
    expect(all[2].ip_hash).not.toBe(all[0].ip_hash);
    // The events and every other table that could have seen the sign-in hold no raw address either.
    const ev = await eventually(() => events("auth.sign_in"), 3);
    expect(JSON.stringify(ev)).not.toContain(RAW_IP);
    const link = await db.withAdmin((tx) => tx.query("select * from public.magic_links"));
    expect(JSON.stringify(link)).not.toContain(RAW_IP); // the link request had no IP option here
  });

  it("works without request headers (a script): the row exists with unknown device and no hash", async () => {
    env.reqHeaders = new Headers();
    await auth.requestMagicLink("headless@example.com", true);
    const [mail] = await listOutbox(1);
    const user = await auth.consumeMagicLink(new URL(linksIn(mail.text)[0]).searchParams.get("token")!);
    const [row] = await sessions(user.id);
    expect(row).toMatchObject({ device_type: "unknown", browser: null, os: null, ip_hash: null, user_agent: null });
  });

  it("getCurrentUser returns the user for a live session and carries the session id", async () => {
    const user = await signIn();
    expect(await auth.getCurrentUser()).toEqual(user);
    expect((await auth.getCurrentUser())?.sessionId).toBe(user.sessionId);
  });

  it("a revoked session is signed out", async () => {
    const user = await signIn();
    expect(await revokeSession(user.sessionId, "admin")).toBe(true);
    expect(await auth.getCurrentUser()).toBeNull();
    const [row] = await sessions(user.id);
    expect(row.revoked_by).toBe("admin");
    expect(row.revoked_at).toBeInstanceOf(Date);
    // Revoking again changes nothing.
    expect(await revokeSession(user.sessionId, "user")).toBe(false);
    expect((await sessions(user.id))[0].revoked_by).toBe("admin");
    const ev = await eventually(() => events("session.revoked"));
    expect(ev[0]).toMatchObject({ user_id: user.id, session_id: user.sessionId, detail: { by: "admin" } });
  });

  it("a session row that is gone, or that belongs to another user, is signed out", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    // A's cookie with B's session id.
    env.store.set(SESSION_COOKIE, { value: await (await import("@/lib/auth/session")).signSession({ id: a.id, email: "a@example.com", sid: b.sessionId }) });
    expect(await auth.getCurrentUser()).toBeNull();
    // Deleted row.
    env.store.set(SESSION_COOKIE, { value: await (await import("@/lib/auth/session")).signSession({ id: a.id, email: "a@example.com", sid: a.sessionId }) });
    expect(await auth.getCurrentUser()).not.toBeNull();
    await db.withAdmin((tx) => tx.query("delete from public.user_sessions where id = $1", [a.sessionId]));
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it("a legacy token without sid is signed out", async () => {
    const user = await signIn();
    const iat = Math.floor(Date.now() / 1000);
    const legacy = await new SignJWT({ email: EMAIL })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(new TextEncoder().encode(getEnv().authSecret));
    env.store.set(SESSION_COOKIE, { value: legacy });
    expect(await auth.getCurrentUser()).toBeNull();
    // And a token whose sid is not a uuid.
    const odd = await (await import("@/lib/auth/session")).signSession({ id: user.id, email: EMAIL, sid: "not-a-uuid" });
    env.store.set(SESSION_COOKIE, { value: odd });
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it("last_seen_at moves at most every 5 minutes", async () => {
    const user = await signIn();
    const seen = async () => (await sessions(user.id))[0].last_seen_at.getTime();
    const t0 = await seen();

    // Within 5 minutes of the stored time: not touched.
    await auth.getCurrentUser();
    await auth.getCurrentUser();
    expect(await seen()).toBe(t0);

    // Past 5 minutes: touched once, then quiet again.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(t0 + TOUCH_AFTER_MS + 60_000));
    expect(await auth.getCurrentUser()).not.toBeNull();
    const t1 = await seen();
    expect(t1).toBe(t0 + TOUCH_AFTER_MS + 60_000);
    vi.setSystemTime(new Date(t1 + 2 * 60_000));
    await auth.getCurrentUser();
    expect(await seen()).toBe(t1);
  });

  it("sign-out revokes the session (by user), clears the cookie and logs it", async () => {
    const user = await signIn();
    const stale = env.store.get(SESSION_COOKIE)!.value;
    await auth.signOut();
    expect(env.store.has(SESSION_COOKIE)).toBe(false);
    const [row] = await sessions(user.id);
    expect(row.revoked_by).toBe("user");
    expect(row.revoked_at).toBeInstanceOf(Date);
    // The old cookie, replayed, no longer signs anyone in.
    env.store.set(SESSION_COOKIE, { value: stale });
    expect(await auth.getCurrentUser()).toBeNull();
    const out = await eventually(() => events("auth.sign_out"));
    expect(out[0]).toMatchObject({ user_id: user.id, session_id: user.sessionId, ok: true });
    expect(JSON.stringify(out)).not.toContain(EMAIL);
  });

  it("signing out on one device leaves the other device signed in", async () => {
    const first = await signIn();
    const cookieFirst = env.store.get(SESSION_COOKIE)!.value;
    const second = await signIn(first.email!);
    expect(second.sessionId).not.toBe(first.sessionId);
    await auth.signOut(); // second device
    env.store.set(SESSION_COOKIE, { value: cookieFirst });
    expect((await auth.getCurrentUser())?.sessionId).toBe(first.sessionId);
  });

  it("logs sign-in and link requests without the email address", async () => {
    const user = await signIn();
    const inEv = await eventually(async () => (await events("auth.sign_in")).filter((e) => e.user_id === user.id));
    expect(inEv[0]).toMatchObject({ user_id: user.id, session_id: user.sessionId, ok: true });
    const linkEv = await eventually(() => events("auth.link_requested"));
    expect(linkEv.length).toBeGreaterThan(0);
    expect(JSON.stringify(linkEv)).not.toContain("devices");
  });

  it("a failed sign-in (link used) creates no session", async () => {
    const user = await signIn();
    const before = (await sessions(user.id)).length;
    await expect(auth.consumeMagicLink("garbage")).rejects.toMatchObject({ code: "invalid_link" });
    expect((await sessions(user.id)).length).toBe(before);
  });

  it("the test helper makes a cookie with a live session row", async () => {
    const user = await signIn();
    env.store.set(SESSION_COOKIE, { value: await signWithRow({ id: user.id, email: EMAIL }) });
    expect(await auth.getCurrentUser()).not.toBeNull();
  });
});

describe("retention (12 months)", () => {
  it("purges sessions revoked or last seen over 12 months ago and events over 12 months old, and keeps the rest", async () => {
    const user = await signIn("old@example.com");
    const mk = (seen: string, revoked: string | null) =>
      db.withAdmin((tx) =>
        tx.query<{ id: string }>(
          `insert into public.user_sessions (user_id, last_seen_at, revoked_at) values ($1, $2, $3) returning id::text as id`,
          [user.id, seen, revoked],
        ),
      );
    const now = new Date("2026-10-15T00:00:00Z");
    const [oldSeen] = await mk("2025-09-01T00:00:00Z", null);
    const [oldRevoked] = await mk("2026-10-01T00:00:00Z", "2025-09-30T00:00:00Z");
    const [recent] = await mk("2026-09-01T00:00:00Z", null);
    const [recentRevoked] = await mk("2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");
    await db.withAdmin(async (tx) => {
      await tx.query("insert into public.app_events (at, kind) values ('2025-09-01T00:00:00Z', 'test.old'), ('2026-09-01T00:00:00Z', 'test.new')");
    });
    const res = await purgeOldSessionData(now);
    expect(res.sessions).toBe(2);
    expect(res.events).toBe(1);
    const left = (await sessions(user.id)).map((r) => r.id);
    expect(left).toContain(recent.id);
    expect(left).toContain(recentRevoked.id);
    expect(left).not.toContain(oldSeen.id);
    expect(left).not.toContain(oldRevoked.id);
    expect(left).toContain(user.sessionId);
    const kinds = (await db.withAdmin((tx) => tx.query<{ kind: string }>("select kind from public.app_events where kind like 'test.%'"))).map((r) => r.kind);
    expect(kinds).toEqual(["test.new"]);
  });
});
