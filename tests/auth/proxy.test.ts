import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { isPublicPath, PATHNAME_HEADER } from "@/lib/auth/public-paths";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from "@/lib/auth/session";

const user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com" };
afterEach(() => vi.unstubAllEnvs());

const DAY_MS = 24 * 60 * 60 * 1000;

function req(path: string, token?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

describe("proxy guard", () => {
  it.each(["/create", "/plan", "/history", "/setup", "/review/abc"])(
    "signed-out %s goes to /login",
    async (path) => {
      const res = await proxy(req(path));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    },
  );

  it.each(["/auth/callback", "/auth/invalid", "/terms"])("signed-out %s is allowed (email sign-in pages)", async (path) => {
    const res = await proxy(req(path));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it.each(["/login", "/a/token123", "/s/token123", "/r/abc123", "/api/files/renders/x/y"])(
    "signed-out %s is allowed",
    async (path) => {
      const res = await proxy(req(path));
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each(["/brand", "/some-new-page", "/review/abc", "/mascot", "/summary", "/", "/api/setup/transcribe", "/api/brand/logo"])(
    "signed-out %s is protected (everything is protected unless it is on the public list)",
    async (path) => {
      const res = await proxy(req(path));
      // Pages redirect to /login; API routes answer 401.
      if (path.startsWith("/api/")) expect(res.status).toBe(401);
      else expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    },
  );

  it("signed-out /brand goes to /login", async () => {
    const res = await proxy(req("/brand"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("signed-out API calls get 401 JSON, not a redirect to the login page", async () => {
    const res = await proxy(req("/api/setup/transcribe"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "signed_out" });
  });

  it.each(["/api/whatsapp/webhook", "/api/files/brand-assets/x/logo.png", "/a/tok", "/s/tok", "/r/abc123"])(
    "signed-out %s is public",
    async (path) => {
      const res = await proxy(req(path));
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).toBe(200);
    },
  );

  it("/dev/outbox is public in development and test", async () => {
    expect(isPublicPath("/dev/outbox")).toBe(true);
    expect(isPublicPath("/dev/outbox/x")).toBe(false);
    const res = await proxy(req("/dev/outbox"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("/dev/outbox is not public and answers 404 in production, signed in or not", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    expect(isPublicPath("/dev/outbox")).toBe(false);
    expect((await proxy(req("/dev/outbox"))).status).toBe(404);
    expect((await proxy(req("/dev/outbox", await signSession(user)))).status).toBe(404);
    expect((await proxy(req("/dev/anything"))).status).toBe(404);
  });

  it("/dev/outbox answers 404 on any Vercel environment (even preview)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isPublicPath("/dev/outbox")).toBe(false);
    expect((await proxy(req("/dev/outbox"))).status).toBe(404);
  });

  it("only the listed prefixes are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/extra")).toBe(false);
    expect(isPublicPath("/api")).toBe(false);
    expect(isPublicPath("/api/filesx/a")).toBe(false);
    expect(isPublicPath("/api/cron/weekly")).toBe(true); // checks CRON_SECRET itself
    expect(isPublicPath("/api/cronx/weekly")).toBe(false);
    expect(isPublicPath("/about")).toBe(false);
    expect(isPublicPath("/a")).toBe(false);
    expect(isPublicPath("/_next/data/x.json")).toBe(true);
  });

  it("passes the page path to the layout and overwrites a forged header", async () => {
    const r = new NextRequest("http://localhost:3000/brand", {
      headers: { cookie: `${SESSION_COOKIE}=${await signSession(user)}`, [PATHNAME_HEADER]: "/setup" },
    });
    const res = await proxy(r);
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe("/brand");
  });

  it("signed-in /brand passes through", async () => {
    const res = await proxy(req("/brand", await signSession(user)));
    expect(res.headers.get("location")).toBeNull();
  });

  it("signed-in /login goes to /", async () => {
    const res = await proxy(req("/login", await signSession(user)));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("signed-in app page passes through", async () => {
    const res = await proxy(req("/create", await signSession(user)));
    expect(res.headers.get("location")).toBeNull();
  });

  it("an expired cookie counts as signed out", async () => {
    const old = await signSession(user, Date.now() - (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    const res = await proxy(req("/create", old));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("does not renew a fresh cookie", async () => {
    const res = await proxy(req("/create", await signSession(user)));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("renews (sliding 30 days) a cookie older than a day", async () => {
    const res = await proxy(req("/create", await signSession(user, Date.now() - 2 * DAY_MS)));
    const set = res.headers.get("set-cookie")!;
    expect(set).toContain(`${SESSION_COOKIE}=`);
    expect(set).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(set.toLowerCase()).toContain("httponly");
    expect(set.toLowerCase()).toContain("samesite=lax");
  });
});
