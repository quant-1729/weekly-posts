// The judges' demo sign-in (docs/15-demo-login.md): POST /api/demo/login and the /demo page.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

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

import DemoPage from "@/app/demo/page";
import { POST } from "@/app/api/demo/login/route";
import { createMockAuth, resetMockAuthState } from "@/lib/auth/mock";
import { isPublicPath } from "@/lib/auth/public-paths";
import { DEMO_SESSION_MAX_AGE_SECONDS, SESSION_COOKIE, needsRefresh, verifySession } from "@/lib/auth/session";
import { DEMO_ATTEMPTS, codeMatches } from "@/lib/demo";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { proxy } from "@/proxy";
import { DEMO_CODE, DEMO_EMAIL, locationOf, makeDemoOwner } from "./helpers";

let db: MockDb;
let owner: { userId: string; brandId: string };

const URL_LOGIN = "http://localhost:3000/api/demo/login";
const IP_A = "203.0.113.10";

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  owner = await makeDemoOwner(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  await resetMockAuthState(); // clears the in-memory limiter too
  env.store.clear();
  env.reqHeaders = new Headers({ "x-forwarded-for": IP_A, "user-agent": "vitest" });
  vi.stubEnv("DEMO_LOGIN_EMAIL", DEMO_EMAIL);
  vi.stubEnv("DEMO_ACCESS_CODE", DEMO_CODE);
  await db.withAdmin((tx) => tx.query("delete from public.user_sessions"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** What the form on /demo does. `ip` is what the proxy puts in x-forwarded-for. */
const submit = (code: string | undefined, ip = IP_A) =>
  POST(
    new NextRequest(URL_LOGIN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
      body: new URLSearchParams(code === undefined ? {} : { code }),
    }),
  );
const submitJson = (code: unknown, ip = IP_A) =>
  POST(new NextRequest(URL_LOGIN, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ code }) }));

const sessionRows = () => db.withAdmin((tx) => tx.query<{ id: string; user_id: string; demo: boolean; created_at: Date }>("select id, user_id, demo, created_at from public.user_sessions"));
const accountCount = async () =>
  (await db.withAdmin((tx) => tx.query<{ n: number }>("select (select count(*) from auth.users)::int + (select count(*) from public.profiles)::int as n")))[0].n;

describe("POST /api/demo/login: the right code", () => {
  it("signs in as the demo user with a demo session that lasts 12 hours, and goes to /home", async () => {
    const res = await submit(DEMO_CODE);
    expect(res.status).toBe(303);
    expect(locationOf(res)).toBe("/home");

    const cookie = env.store.get(SESSION_COOKIE)!;
    const payload = await verifySession(cookie.value);
    expect(payload).toMatchObject({ sub: owner.userId, email: DEMO_EMAIL, demo: true });
    expect(payload!.exp - payload!.iat).toBe(12 * 60 * 60);
    expect(cookie.options).toMatchObject({ httpOnly: true, maxAge: DEMO_SESSION_MAX_AGE_SECONDS });

    const rows = await sessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: payload!.sid, user_id: owner.userId, demo: true });
  });

  it("makes getCurrentUser say demo: true (the database row decides)", async () => {
    await submit(DEMO_CODE);
    const user = await createMockAuth().getCurrentUser();
    expect(user).toMatchObject({ id: owner.userId, email: DEMO_EMAIL, demo: true });
    // A plain session row for the same user is not a demo session.
    await db.withAdmin((tx) => tx.query("update public.user_sessions set demo = false"));
    expect(await createMockAuth().getCurrentUser()).toMatchObject({ demo: false });
  });

  it("matches the demo email in any case", async () => {
    vi.stubEnv("DEMO_LOGIN_EMAIL", "  Demo.Judge@EXAMPLE.com ");
    const res = await submit(DEMO_CODE);
    expect(locationOf(res)).toBe("/home");
    expect((await sessionRows())[0].user_id).toBe(owner.userId);
  });

  it("works for a JSON caller too", async () => {
    const res = await submitJson(DEMO_CODE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/home" });
    expect(env.store.has(SESSION_COOKIE)).toBe(true);
  });

  it("ends 12 hours after sign-in even if the cookie is still valid, and is never renewed", async () => {
    await submit(DEMO_CODE);
    const auth = createMockAuth();
    expect(await auth.getCurrentUser()).not.toBeNull();
    await db.withAdmin((tx) => tx.query("update public.user_sessions set created_at = now() - interval '13 hours'"));
    expect(await auth.getCurrentUser()).toBeNull();

    const payload = (await verifySession(env.store.get(SESSION_COOKIE)!.value))!;
    expect(needsRefresh({ ...payload, iat: payload.iat - 3 * 24 * 3600 })).toBe(false);
    expect(needsRefresh({ ...payload, demo: false, iat: payload.iat - 3 * 24 * 3600 })).toBe(true);
  });

  it("the proxy does not extend a demo cookie", async () => {
    await submit(DEMO_CODE);
    const token = env.store.get(SESSION_COOKIE)!.value;
    const res = await proxy(new NextRequest("http://localhost:3000/home", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/demo/login: a wrong code", () => {
  it("fails with one generic answer and starts no session", async () => {
    for (const bad of ["nope", DEMO_CODE + "x", DEMO_CODE.toUpperCase(), "", undefined]) {
      const res = await submit(bad);
      expect(res.status).toBe(303);
      expect(locationOf(res)).toBe("/demo?error=invalid");
    }
    expect(env.store.has(SESSION_COOKIE)).toBe(false);
    expect(await sessionRows()).toHaveLength(0);
    const json = await submitJson("nope");
    expect(json.status).toBe(401);
    expect(await json.json()).toEqual({ ok: false, code: "invalid" });
    expect((await submitJson({ not: "a string" })).status).toBe(401);
  });

  it("the page shows the error without saying what was wrong", async () => {
    const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({ error: "invalid" }) }));
    expect(html).toContain(s.demo.errors.invalid);
    expect(html).not.toContain(DEMO_EMAIL);
    expect(html).not.toContain(DEMO_CODE);
  });
});

describe("POST /api/demo/login: the rate limit", () => {
  it("allows 10 tries per network in 15 minutes; the 11th is refused even with the right code", async () => {
    for (let i = 0; i < DEMO_ATTEMPTS; i++) expect((await submitJson(`wrong-${i}`)).status).toBe(401);
    const blocked = await submitJson(DEMO_CODE);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ ok: false, code: "rate_limited" });
    expect(env.store.has(SESSION_COOKIE)).toBe(false);
    expect(locationOf(await submit(DEMO_CODE))).toBe("/demo?error=rate_limited");
  });

  it("counts each network on its own", async () => {
    for (let i = 0; i < DEMO_ATTEMPTS; i++) await submitJson("wrong", IP_A);
    expect((await submitJson(DEMO_CODE, IP_A)).status).toBe(429);
    expect((await submitJson(DEMO_CODE, "198.51.100.7")).status).toBe(200);
  });
});

describe("when the demo is not set up", () => {
  it("answers 404 and shows 'not available' when a setting is empty", async () => {
    for (const [email, code] of [["", ""], [DEMO_EMAIL, ""], ["", DEMO_CODE]]) {
      vi.stubEnv("DEMO_LOGIN_EMAIL", email);
      vi.stubEnv("DEMO_ACCESS_CODE", code);
      const res = await submit(DEMO_CODE);
      expect(res.status).toBe(404);
      expect(await sessionRows()).toHaveLength(0);
      const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({}) }));
      expect(html).toContain(s.demo.notAvailableTitle);
      expect(html).not.toContain(s.demo.codeLabel);
    }
  });

  it("shows the form when it is set up", async () => {
    const html = renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(s.demo.codeLabel);
    expect(html).toContain('action="/api/demo/login"');
    expect(html).not.toContain(DEMO_CODE);
    expect(html).not.toContain(DEMO_EMAIL);
  });

  it("says the demo is not available for an email with no account, and never creates one", async () => {
    vi.stubEnv("DEMO_LOGIN_EMAIL", "nobody@example.com");
    const before = await accountCount();
    const res = await submitJson(DEMO_CODE);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: "not_available" });
    expect(locationOf(await submit(DEMO_CODE))).toBe("/demo?error=not_available");
    expect(await accountCount()).toBe(before);
    expect(await sessionRows()).toHaveLength(0);
    expect(env.store.has(SESSION_COOKIE)).toBe(false);
  });
});

describe("public paths and the code check", () => {
  it("/demo and /api/demo/login need no sign-in", () => {
    expect(isPublicPath("/demo")).toBe(true);
    expect(isPublicPath("/api/demo/login")).toBe(true);
    expect(isPublicPath("/api/demo/other")).toBe(false);
  });

  it("compares codes exactly, whatever their length", () => {
    expect(codeMatches("abc", "abc")).toBe(true);
    expect(codeMatches("abc", "abd")).toBe(false);
    expect(codeMatches("abc", "abcd")).toBe(false);
    expect(codeMatches("", "abc")).toBe(false);
    expect(codeMatches("é", "é")).toBe(true);
  });
});
