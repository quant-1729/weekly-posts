import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string; phone: null } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));

import { GET as callback } from "@/app/api/connect/[provider]/callback/route";
import { GET as start } from "@/app/api/connect/[provider]/route";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { getConnection } from "@/lib/connections/service";
import type { MockDb } from "@/lib/db/mock";
import { addMember, closeDb, fakeFetch, makeOwner, openDb, stubMetaEnv, when, type Handler, type Owner } from "./helpers";

let db: MockDb;
let owner: Owner;
let editor: string;

beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
beforeEach(async () => {
  stubMetaEnv();
  resetTokenKeyForTests();
  owner = await makeOwner(db);
  editor = await addMember(db, owner.brandId, "editor");
  session.user = { id: owner.userId, email: "owner@example.com", phone: null };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });
const startReq = (provider: string) => start(new NextRequest(`https://app.example.com/api/connect/${provider}`), ctx(provider));
const location = (res: Response) => res.headers.get("location") ?? "";

function cookieOf(res: Response, name: string): string | undefined {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return raw?.split(";")[0].slice(name.length + 1);
}

const IG_FLOW: Handler[] = [
  when("POST", /\/oauth\/access_token$/, { body: { access_token: "IGshort", user_id: "17841400000000001", permissions: ["instagram_business_basic", "instagram_business_content_publish"] } }),
  when("GET", /\/me$/, { body: { user_id: "17841400000000001", username: "cornerbakery", account_type: "BUSINESS" } }),
  when("GET", /\/access_token$/, { body: { access_token: "IGlong-token-1234567890", expires_in: 5_184_000 } }),
];

describe("GET /api/connect/[provider]", () => {
  it("sends the owner to Instagram with a state and a nonce cookie that JavaScript cannot read", async () => {
    const res = await startReq("instagram");
    expect(res.status).toBe(307);
    const u = new URL(location(res));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("state")).toBeTruthy();
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("pm_connect_nonce="))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=lax/i);
    expect(raw).toMatch(/Path=\/api\/connect/);
  });

  it("answers 404 for an unknown provider, and sends a signed-out visitor to sign in", async () => {
    expect((await startReq("tiktok")).status).toBe(404);
    session.user = null;
    expect(new URL(location(await startReq("instagram"))).pathname).toBe("/login");
  });

  it("sends back to Connections with a reason for a non-owner and for missing Meta settings", async () => {
    session.user = { id: editor, email: "e@example.com", phone: null };
    expect(location(await startReq("instagram"))).toBe("https://app.example.com/connections?connect_error=not_owner");
    session.user = { id: owner.userId, email: "o@example.com", phone: null };
    vi.stubEnv("META_APP_ID", "");
    expect(location(await startReq("facebook"))).toBe("https://app.example.com/connections?connect_error=not_configured");
  });
});

describe("GET /api/connect/[provider]/callback", () => {
  async function begin(provider: "instagram" | "facebook") {
    const res = await startReq(provider);
    return { state: new URL(location(res)).searchParams.get("state")!, nonce: cookieOf(res, "pm_connect_nonce")! };
  }
  const cb = (provider: string, qs: string, nonce?: string) =>
    callback(new NextRequest(`https://app.example.com/api/connect/${provider}/callback?${qs}`, { headers: nonce ? { cookie: `pm_connect_nonce=${nonce}` } : {} }), ctx(provider));

  it("completes the Instagram connection and clears the nonce cookie", async () => {
    const { state, nonce } = await begin("instagram");
    vi.stubGlobal("fetch", fakeFetch(IG_FLOW).fetch);
    const res = await cb("instagram", `code=abc&state=${encodeURIComponent(state)}`, nonce);
    expect(location(res)).toBe("https://app.example.com/connections?connected=instagram");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("pm_connect_nonce=;") || /pm_connect_nonce=;/.test(c) || /Max-Age=0/i.test(c))).toBe(true);
    expect(await getConnection(owner.brandId, "instagram")).toMatchObject({ status: "active", accountName: "@cornerbakery" });
  });

  it("refuses without the nonce cookie, a state meant for someone else, or after the owner said no", async () => {
    const { state, nonce } = await begin("instagram");
    vi.stubGlobal("fetch", fakeFetch(IG_FLOW).fetch);
    expect(location(await cb("instagram", `code=abc&state=${encodeURIComponent(state)}`))).toContain("connect_error=bad_state");
    session.user = { id: editor, email: "e@example.com", phone: null };
    expect(location(await cb("instagram", `code=abc&state=${encodeURIComponent(state)}`, nonce))).toContain("connect_error=bad_state");
    session.user = { id: owner.userId, email: "o@example.com", phone: null };
    expect(location(await cb("instagram", `error=access_denied&error_reason=user_denied&state=${encodeURIComponent(state)}`, nonce))).toContain("connect_error=denied");
    expect(await getConnection(owner.brandId, "instagram")).toBeNull();
  });

  it("with several Pages, goes to the picker and sets an httpOnly cookie that holds no token in the clear", async () => {
    const { state, nonce } = await begin("facebook");
    vi.stubGlobal(
      "fetch",
      fakeFetch([
        when("GET", /\/oauth\/access_token$/, { body: { access_token: "EAAUserTokenAAAAAAAAAAAAAAAAAAAA" } }),
        when("GET", /\/me$/, { body: { id: "4242" } }),
        when("GET", /\/me\/accounts$/, { body: { data: [{ id: "1", name: "A", access_token: "EAAPageA" }, { id: "2", name: "B", access_token: "EAAPageB" }] } }),
      ]).fetch,
    );
    const res = await cb("facebook", `code=abc&state=${encodeURIComponent(state)}`, nonce);
    expect(location(res)).toBe("https://app.example.com/connections/facebook");
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("pm_fb_pending="))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).not.toContain("EAAUserToken");
    expect(Buffer.from(raw.split(";")[0].split("=")[1], "base64url").toString("utf8")).not.toContain("EAAUserToken");
    expect(await getConnection(owner.brandId, "facebook")).toBeNull();
  });
});
