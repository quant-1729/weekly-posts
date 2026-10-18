import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null; phone: string | null; sessionId: string } | null,
  brand: null as { id: string; name: string; setupCompleted: boolean } | null,
}));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), getCurrentUser: async () => state.user }));
vi.mock("@/lib/brand/current", async (orig) => ({ ...(await orig<typeof import("@/lib/brand/current")>()), getCurrentBrand: async () => state.brand }));

import { POST } from "@/app/api/live/token/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import { LIVE_TOKEN_TTL_MS, mintLiveToken, setLiveTokenMinterForTests, type LiveTokenRequest } from "@/lib/realtime";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", phone: null, sessionId: "s1" };
const BRAND_A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Bakery", setupCompleted: true };
const BRAND_B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Cafe", setupCompleted: true };
const FIREBASE_ENV = { FIREBASE_PROJECT_ID: "proj-1", FIREBASE_WEB_API_KEY: "key-1", FIREBASE_WEB_APP_ID: "1:2:web:3" };

const call = (headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://localhost:3000/api/live/token", { method: "POST", headers }));

beforeEach(() => {
  state.user = USER;
  state.brand = BRAND_A;
  for (const [k, v] of Object.entries(FIREBASE_ENV)) vi.stubEnv(k, v);
});
afterEach(() => {
  setLiveTokenMinterForTests(null);
  vi.unstubAllEnvs();
});

describe("POST /api/live/token", () => {
  it("answers 401 when signed out", async () => {
    state.user = null;
    setLiveTokenMinterForTests(async () => "tok");
    const res = await call({ origin: "http://localhost:3000" });
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 403 for a foreign Origin, before anything is minted", async () => {
    const minter = vi.fn(async () => "tok");
    setLiveTokenMinterForTests(minter);
    const res = await call({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(minter).not.toHaveBeenCalled();
    expect((await call({ origin: "not a url" })).status).toBe(403);
    // A different port is a different origin.
    expect((await call({ origin: "http://localhost:4000" })).status).toBe(403);
  });

  it("accepts the app's own Origin and a request without an Origin", async () => {
    setLiveTokenMinterForTests(async () => "tok");
    expect((await call({ origin: "http://localhost:3000" })).status).toBe(200);
    expect((await call()).status).toBe(200);
  });

  it("answers { mode: 'off' } when live status is not on (vitest is always mock)", async () => {
    const res = await call({ origin: "http://localhost:3000" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "off" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers { mode: 'off' } when the browser config is incomplete", async () => {
    setLiveTokenMinterForTests(async () => "tok");
    vi.stubEnv("FIREBASE_WEB_API_KEY", "");
    expect(await (await call()).json()).toEqual({ mode: "off" });
  });

  it("mints for the user id with exactly { b, until } claims, no email, and no-store", async () => {
    const seen: Array<LiveTokenRequest & { claims: object }> = [];
    setLiveTokenMinterForTests(async (req) => {
      seen.push(req);
      return "custom-token";
    });
    const before = Date.now();
    const res = await call({ origin: "http://localhost:3000" });
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      mode: "firestore",
      token: "custom-token",
      brandId: BRAND_A.id,
      until: body.until,
      config: { apiKey: "key-1", authDomain: "proj-1.firebaseapp.com", projectId: "proj-1", appId: "1:2:web:3" },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe(USER.id);
    expect(seen[0].brandId).toBe(BRAND_A.id);
    expect(Object.keys(seen[0].claims).sort()).toEqual(["b", "until"]);
    expect(seen[0].claims).toEqual({ b: BRAND_A.id, until: seen[0].now + 3_600_000 });
    expect(body.until).toBe(seen[0].now + LIVE_TOKEN_TTL_MS);
    expect(seen[0].now).toBeGreaterThanOrEqual(before);
    expect(seen[0].now).toBeLessThanOrEqual(after);
    expect(JSON.stringify(seen)).not.toContain(USER.email);
    expect(JSON.stringify(body)).not.toContain(USER.email);
  });

  it("changes the b claim when the current brand changes", async () => {
    const claims: Array<{ b: string }> = [];
    setLiveTokenMinterForTests(async (req) => {
      claims.push(req.claims);
      return "t";
    });
    await call();
    state.brand = BRAND_B;
    const body = await (await call()).json();
    expect(claims.map((c) => c.b)).toEqual([BRAND_A.id, BRAND_B.id]);
    expect(body.brandId).toBe(BRAND_B.id);
  });

  it("answers 404 when the user has no brand", async () => {
    setLiveTokenMinterForTests(async () => "t");
    state.brand = null;
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 500 without leaking the error when minting fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setLiveTokenMinterForTests(async () => {
      throw new Error("signBlob denied for secret-sa@x");
    });
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret-sa");
    vi.restoreAllMocks();
  });

  it("is not a public path (the proxy answers 401 to signed-out callers)", () => {
    expect(isPublicPath("/api/live/token")).toBe(false);
  });
});

describe("mintLiveToken", () => {
  it("refuses to mint without a minter while live status is not on", async () => {
    await expect(mintLiveToken({ userId: USER.id, brandId: BRAND_A.id, now: 1 })).rejects.toThrow();
  });
});
