import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptToken, resetTokenKeyForTests } from "@/lib/connections/crypto";
import { openPending } from "@/lib/connections/facebook";
import { choosePage, finishConnect, listPendingPages, startConnect } from "@/lib/connections/oauth";
import { getConnection, listConnections } from "@/lib/connections/service";
import { signConnectState } from "@/lib/connections/state";
import { readToken } from "@/lib/connections/tokens";
import { ConnectionError } from "@/lib/connections/types";
import type { MockDb } from "@/lib/db/mock";
import {
  addMember,
  closeDb,
  fakeFetch,
  graphError,
  makeOwner,
  makeStranger,
  openDb,
  stubMetaEnv,
  when,
  type Handler,
  type Owner,
} from "./helpers";

let db: MockDb;
let owner: Owner;
let editor: string;

const NOW = new Date("2026-10-14T10:00:00Z");
const SHORT = "IGshort-token-aaaaaaaaaaaaaaaa";
const LONG = "IGlong-token-bbbbbbbbbbbbbbbbbbbb";
const IG_ID = "17841400000000001";

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
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const igHandlers = (o: { accountType?: string; permissions?: string[]; extra?: Handler[] } = {}): Handler[] => [
  ...(o.extra ?? []),
  when("POST", /\/oauth\/access_token$/, {
    body: { data: [{ access_token: SHORT, user_id: IG_ID, permissions: o.permissions ?? ["instagram_business_basic", "instagram_business_content_publish"] }] },
  }),
  when("GET", /\/me$/, { body: { user_id: IG_ID, username: "cornerbakery", account_type: o.accountType ?? "BUSINESS" } }),
  when("GET", /\/access_token$/, { body: { access_token: LONG, token_type: "bearer", expires_in: 5_184_000 } }),
];

async function start(provider: "instagram" | "facebook", userId = owner.userId, brandId = owner.brandId) {
  const { state, nonce } = await signConnectState({ brandId, userId, provider }, NOW.getTime());
  return { state, nonce };
}

const allRowsText = async () =>
  JSON.stringify(
    await db.withAdmin(async (tx) => [
      await tx.query("select * from public.channel_tokens"),
      await tx.query("select * from public.channel_connections"),
      await tx.query("select * from public.email_log"),
    ]),
  );

describe("starting a connection", () => {
  it("builds the Instagram authorize URL with the right scopes, redirect URI and a signed state", async () => {
    const { url, nonce } = await startConnect({ userId: owner.userId, brandId: owner.brandId, provider: "instagram", now: NOW });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("9876543210");
    expect(u.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/connect/instagram/callback");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(nonce).toBeTruthy();
    expect(u.searchParams.get("state")!.split(".")).toHaveLength(3);
  });

  it("builds the Facebook authorize URL with the Page scopes", async () => {
    const { url } = await startConnect({ userId: owner.userId, brandId: owner.brandId, provider: "facebook" });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v23.0/dialog/oauth");
    expect(u.searchParams.get("client_id")).toBe("1234567890");
    expect(u.searchParams.get("scope")).toBe("pages_manage_posts,pages_read_engagement,pages_show_list");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/connect/facebook/callback");
  });

  it("refuses a member who is not the owner, a stranger, missing setup and a missing key", async () => {
    await expect(startConnect({ userId: editor, brandId: owner.brandId, provider: "instagram" })).rejects.toMatchObject({ code: "not_owner" });
    await expect(startConnect({ userId: await makeStranger(db), brandId: owner.brandId, provider: "facebook" })).rejects.toMatchObject({ code: "not_owner" });

    vi.stubEnv("INSTAGRAM_APP_ID", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    vi.stubEnv("META_APP_ID", "");
    await expect(startConnect({ userId: owner.userId, brandId: owner.brandId, provider: "instagram" })).rejects.toMatchObject({ code: "not_configured" });

    stubMetaEnv();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(startConnect({ userId: owner.userId, brandId: owner.brandId, provider: "instagram" })).rejects.toMatchObject({ code: "key_missing" });
  });

  it("falls back to the Meta app's id and secret when the Instagram ones are blank", async () => {
    vi.stubEnv("INSTAGRAM_APP_ID", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    const { url } = await startConnect({ userId: owner.userId, brandId: owner.brandId, provider: "instagram" });
    expect(new URL(url).searchParams.get("client_id")).toBe("1234567890");
  });
});

describe("the Instagram callback", () => {
  it("stores the connection and an ENCRYPTED long-lived token", async () => {
    const { state, nonce } = await start("instagram");
    const { fetch, calls } = fakeFetch(igHandlers());
    const out = await finishConnect({ provider: "instagram", userId: owner.userId, code: "the-code#_", state, nonceCookie: nonce }, { fetch, now: NOW });
    expect(out).toEqual({ ok: true, next: "done", provider: "instagram" });

    // The code is exchanged with the Instagram app's credentials and the redirect URI; "#_" is stripped.
    const ex = calls.find((c) => c.method === "POST")!;
    expect(ex.host).toBe("api.instagram.com");
    expect(ex.params.get("code")).toBe("the-code");
    expect(ex.params.get("client_id")).toBe("9876543210");
    expect(ex.params.get("redirect_uri")).toBe("https://app.example.com/api/connect/instagram/callback");

    const conn = await getConnection(owner.brandId, "instagram");
    expect(conn).toMatchObject({ accountId: IG_ID, accountName: "@cornerbakery", status: "active" });
    expect(new Date(conn!.expiresAt!).getTime()).toBe(NOW.getTime() + 5_184_000 * 1000);

    // The token is in the database only as ciphertext, bound to this brand and provider.
    const text = await allRowsText();
    expect(text).not.toContain(LONG);
    expect(text).not.toContain(SHORT);
    expect(await readToken({ id: conn!.id, brandId: owner.brandId, provider: "instagram" })).toBe(LONG);
    const [row] = await db.withAdmin((tx) => tx.query<{ ciphertext: string; iv: string; tag: string; key_version: number }>("select * from public.channel_tokens"));
    expect(row.key_version).toBe(1);
    expect(() => decryptToken({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: 1 }, "channel-token:other:instagram")).toThrow();
  });

  it("reconnecting replaces the token and clears an old problem", async () => {
    const { fetch } = fakeFetch(igHandlers());
    for (let i = 0; i < 2; i++) {
      const { state, nonce } = await start("instagram");
      await finishConnect({ provider: "instagram", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW });
      if (i === 0) await db.withAdmin((tx) => tx.query("update public.channel_connections set status = 'expired', last_error = 'x' where brand_id = $1", [owner.brandId]));
    }
    const list = await listConnections(owner.userId, owner.brandId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "active", lastError: null });
  });

  it("refuses a user who is not the brand's owner (even with a valid state), and stores nothing", async () => {
    const { state, nonce } = await start("instagram", editor); // a state naming the owner's brand, started by an editor
    const { fetch, calls } = fakeFetch(igHandlers());
    const out = await finishConnect({ provider: "instagram", userId: editor, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW });
    expect(out).toEqual({ ok: false, code: "not_owner" });
    const stranger = await makeStranger(db);
    const s2 = await start("instagram", stranger);
    expect(await finishConnect({ provider: "instagram", userId: stranger, code: "c", state: s2.state, nonceCookie: s2.nonce }, { fetch, now: NOW })).toEqual({ ok: false, code: "not_owner" });
    expect(calls).toHaveLength(0);
    expect(await getConnection(owner.brandId, "instagram")).toBeNull();
  });

  it.each([
    ["garbage", async () => ({ state: "garbage", nonce: "n" })],
    ["another provider", async () => start("facebook")],
    ["another user", async () => start("instagram", editor)],
    ["a wrong nonce cookie", async () => ({ state: (await start("instagram")).state, nonce: "not-the-nonce" })],
    ["no nonce cookie", async () => ({ state: (await start("instagram")).state, nonce: null as unknown as string })],
  ])("refuses a bad state: %s", async (_name, make) => {
    const { state, nonce } = await make();
    const { fetch, calls } = fakeFetch(igHandlers());
    const out = await finishConnect({ provider: "instagram", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW });
    expect(out).toEqual({ ok: false, code: "bad_state" });
    expect(calls).toHaveLength(0);
    expect(await getConnection(owner.brandId, "instagram")).toBeNull();
  });

  it("refuses an expired state", async () => {
    const { state, nonce } = await start("instagram");
    const { fetch } = fakeFetch(igHandlers());
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);
    expect(await finishConnect({ provider: "instagram", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: later })).toEqual({ ok: false, code: "bad_state" });
  });

  it("refuses a personal account without storing a token", async () => {
    const { state, nonce } = await start("instagram");
    const { fetch, calls } = fakeFetch(igHandlers({ accountType: "PERSONAL" }));
    const out = await finishConnect({ provider: "instagram", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW });
    expect(out).toEqual({ ok: false, code: "personal_account" });
    expect(calls.some((c) => c.path.endsWith("/access_token") && c.method === "GET")).toBe(false); // never asked for a long-lived token
    expect(await getConnection(owner.brandId, "instagram")).toBeNull();
    expect(await db.withAdmin((tx) => tx.query("select 1 from public.channel_tokens where brand_id = $1", [owner.brandId]))).toHaveLength(0);
  });

  it("accepts a creator account", async () => {
    const { state, nonce } = await start("instagram");
    const { fetch } = fakeFetch(igHandlers({ accountType: "MEDIA_CREATOR" }));
    expect((await finishConnect({ provider: "instagram", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW })).ok).toBe(true);
  });

  it("refuses when the owner did not allow publishing, or said no", async () => {
    const a = await start("instagram");
    const { fetch } = fakeFetch(igHandlers({ permissions: ["instagram_business_basic"] }));
    expect(await finishConnect({ provider: "instagram", userId: owner.userId, code: "c", state: a.state, nonceCookie: a.nonce }, { fetch, now: NOW })).toEqual({ ok: false, code: "missing_permission" });
    const b = await start("instagram");
    expect(await finishConnect({ provider: "instagram", userId: owner.userId, code: null, state: b.state, nonceCookie: b.nonce, denied: true }, { fetch, now: NOW })).toEqual({ ok: false, code: "denied" });
  });

  it("reports a Meta refusal without leaking the app secret or the code", async () => {
    const { state, nonce } = await start("instagram");
    const { fetch } = fakeFetch([when("POST", /access_token/, graphError(400, "Invalid code ig-secret-abcdef the-code"))]);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await finishConnect({ provider: "instagram", userId: owner.userId, code: "the-code", state, nonceCookie: nonce }, { fetch, now: NOW });
    expect(out).toEqual({ ok: false, code: "exchange_failed" });
    expect(JSON.stringify(out) + JSON.stringify(log.mock.calls)).not.toContain("ig-secret-abcdef");
    expect(await getConnection(owner.brandId, "instagram")).toBeNull();
  });
});

describe("the Facebook callback and picking a Page", () => {
  const PAGE_A = { id: "1001", name: "Corner Bakery", access_token: "EAAPageTokenAAAAAAAAAAAAAAAAAAAA" };
  const PAGE_B = { id: "1002", name: "Corner Cafe", access_token: "EAAPageTokenBBBBBBBBBBBBBBBBBBBB" };
  const fbHandlers = (pages: unknown[]): Handler[] => [
    when("GET", /\/oauth\/access_token$/, (c) =>
      c.params.get("grant_type") === "fb_exchange_token" ? { body: { access_token: "EAAUserLongLivedTokenCCCCCCCCCCCC" } } : { body: { access_token: "EAAUserShortTokenDDDDDDDDDDDDD" } },
    ),
    when("GET", /\/me$/, { body: { id: "4242" } }),
    when("GET", /\/me\/accounts$/, { body: { data: pages } }),
  ];

  it("connects straight away when there is a single Page, with an encrypted non-expiring Page token", async () => {
    const { state, nonce } = await start("facebook");
    const { fetch } = fakeFetch(fbHandlers([PAGE_A]));
    const out = await finishConnect({ provider: "facebook", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW });
    expect(out).toEqual({ ok: true, next: "done", provider: "facebook" });
    const conn = await getConnection(owner.brandId, "facebook");
    expect(conn).toMatchObject({ accountId: "1001", accountName: "Corner Bakery", status: "active", expiresAt: null });
    expect(await readToken({ id: conn!.id, brandId: owner.brandId, provider: "facebook" })).toBe(PAGE_A.access_token);
    const text = await allRowsText();
    expect(text).not.toContain(PAGE_A.access_token);
    expect(text).not.toContain("EAAUser");
  });

  it("asks the owner to pick when there are several Pages, and keeps tokens out of the browser cookie", async () => {
    const { state, nonce } = await start("facebook");
    const { fetch } = fakeFetch(fbHandlers([PAGE_A, PAGE_B]));
    const out = await finishConnect({ provider: "facebook", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW });
    expect(out.ok && out.next).toBe("pick_page");
    if (!out.ok || out.next !== "pick_page") return;
    expect(await getConnection(owner.brandId, "facebook")).toBeNull();

    const decoded = Buffer.from(out.pending, "base64url").toString("utf8");
    expect(decoded).not.toContain("EAAUser");
    expect(out.pending).not.toContain("EAAPage");

    const listed = await listPendingPages({ userId: owner.userId, pending: out.pending }, { fetch, now: NOW });
    expect(listed.pages).toEqual([
      { id: "1001", name: "Corner Bakery" },
      { id: "1002", name: "Corner Cafe" },
    ]);
    expect(JSON.stringify(listed)).not.toContain("EAAPage");

    const chosen = await choosePage({ userId: owner.userId, pending: out.pending, pageId: "1002" }, { fetch, now: NOW });
    expect(chosen).toEqual({ ok: true, next: "done", provider: "facebook" });
    const conn = await getConnection(owner.brandId, "facebook");
    expect(conn).toMatchObject({ accountId: "1002", accountName: "Corner Cafe" });
    expect(await readToken({ id: conn!.id, brandId: owner.brandId, provider: "facebook" })).toBe(PAGE_B.access_token);
  });

  it("refuses a Page the owner does not have, another user's pending cookie, a tampered one and an expired one", async () => {
    const { state, nonce } = await start("facebook");
    const { fetch } = fakeFetch(fbHandlers([PAGE_A, PAGE_B]));
    const out = await finishConnect({ provider: "facebook", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW });
    if (!out.ok || out.next !== "pick_page") throw new Error("expected a pick");

    expect(await choosePage({ userId: owner.userId, pending: out.pending, pageId: "9999" }, { fetch, now: NOW })).toEqual({ ok: false, code: "page_not_found" });
    expect(await choosePage({ userId: editor, pending: out.pending, pageId: "1001" }, { fetch, now: NOW })).toEqual({ ok: false, code: "pending_expired" });
    expect(await choosePage({ userId: owner.userId, pending: out.pending.slice(0, -4) + "AAAA", pageId: "1001" }, { fetch, now: NOW })).toEqual({ ok: false, code: "pending_expired" });
    expect(await choosePage({ userId: owner.userId, pending: undefined, pageId: "1001" }, { fetch, now: NOW })).toEqual({ ok: false, code: "pending_expired" });
    expect(() => openPending(out.pending, owner.userId, NOW.getTime() + 11 * 60 * 1000)).toThrow(ConnectionError);
    expect(await getConnection(owner.brandId, "facebook")).toBeNull();
  });

  it("reports no Pages", async () => {
    const { state, nonce } = await start("facebook");
    const { fetch } = fakeFetch(fbHandlers([]));
    expect(await finishConnect({ provider: "facebook", userId: owner.userId, code: "c", state, nonceCookie: nonce }, { fetch, now: NOW })).toEqual({ ok: false, code: "no_pages" });
  });
});
