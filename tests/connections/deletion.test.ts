import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as deauthorize } from "@/app/api/meta/deauthorize/route";
import { POST as dataDeletion } from "@/app/api/meta/data-deletion/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { getDeletionStatus, parseSignedRequest, signRequestForTests } from "@/lib/connections/deletion";
import { getConnection, saveConnection } from "@/lib/connections/service";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, makeOwner, openDb, stubMetaEnv, type Owner } from "./helpers";

let db: MockDb;
let owner: Owner;

const IG_SECRET = "ig-secret-abcdef";
const META_SECRET = "meta-secret-abcdef";
const IG_USER = "17841400000000001";
const FB_USER = "4242";

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
  await saveConnection({ brandId: owner.brandId, userId: owner.userId, provider: "instagram", accountId: IG_USER, accountName: "@x", scopes: [], platformUserId: IG_USER, expiresAt: null, token: "IGtoken-aaaaaaaaaaaaaaaaaaaaaaa" });
  await saveConnection({ brandId: owner.brandId, userId: owner.userId, provider: "facebook", accountId: "1001", accountName: "Page", scopes: [], platformUserId: FB_USER, expiresAt: null, token: "EAAPage-aaaaaaaaaaaaaaaaaaaaaaaaa" });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function post(path: string, signed: string | null) {
  const form = new FormData();
  if (signed !== null) form.set("signed_request", signed);
  return new NextRequest(`http://localhost:3000${path}`, { method: "POST", body: form });
}
const tokenCount = async () => (await db.withAdmin((tx) => tx.query("select 1 from public.channel_tokens where brand_id = $1", [owner.brandId]))).length;

describe("signed_request", () => {
  it("verifies with the Instagram or the Meta app secret and says which", () => {
    expect(parseSignedRequest(signRequestForTests({ user_id: IG_USER }, IG_SECRET))).toEqual({ userId: IG_USER, provider: "instagram" });
    expect(parseSignedRequest(signRequestForTests({ user_id: FB_USER }, META_SECRET))).toEqual({ userId: FB_USER, provider: "facebook" });
  });

  it.each([
    ["a wrong secret", () => signRequestForTests({ user_id: IG_USER }, "not-the-secret")],
    ["no signature", () => `.${Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: IG_USER })).toString("base64url")}`],
    ["a changed payload", () => {
      const [sig] = signRequestForTests({ user_id: IG_USER }, IG_SECRET).split(".");
      return `${sig}.${Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "999" })).toString("base64url")}`;
    }],
    ["another algorithm", () => signRequestForTests({ user_id: IG_USER, algorithm: "HMAC-SHA1" }, IG_SECRET)],
    ["no user id", () => signRequestForTests({}, IG_SECRET)],
    ["garbage", () => "not a signed request"],
    ["empty", () => ""],
  ])("refuses %s", (_name, make) => {
    expect(parseSignedRequest(make())).toBeNull();
  });

  it("refuses everything when no app secret is set", () => {
    vi.stubEnv("META_APP_ID", "");
    vi.stubEnv("META_APP_SECRET", "");
    vi.stubEnv("INSTAGRAM_APP_ID", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    expect(parseSignedRequest(signRequestForTests({ user_id: IG_USER }, IG_SECRET))).toBeNull();
  });
});

describe("the data-deletion callback", () => {
  it("deletes the person's connection and token, records a receipt and returns the status URL and code", async () => {
    const res = await dataDeletion(post("/api/meta/data-deletion", signRequestForTests({ user_id: IG_USER }, IG_SECRET)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; confirmation_code: string };
    expect(body.confirmation_code).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(body.url).toBe(`https://app.example.com/meta/deletion/${body.confirmation_code}`);

    expect(await getConnection(owner.brandId, "instagram")).toBeNull();
    expect(await getConnection(owner.brandId, "facebook")).not.toBeNull(); // someone else's connection is untouched
    expect(await tokenCount()).toBe(1);

    const receipt = await db.withAdmin((tx) => tx.query<{ provider: string; account_id: string; status: string }>("select provider, account_id, status from public.deletion_requests where code = $1", [body.confirmation_code]));
    expect(receipt).toEqual([{ provider: "instagram", account_id: IG_USER, status: "done" }]);
    expect(await getDeletionStatus(body.confirmation_code)).toMatchObject({ status: "done" });
  });

  it("finds a Facebook person by the user id Meta knows them by (not the Page id)", async () => {
    const res = await dataDeletion(post("/api/meta/data-deletion", signRequestForTests({ user_id: FB_USER }, META_SECRET)));
    expect(res.status).toBe(200);
    expect(await getConnection(owner.brandId, "facebook")).toBeNull();
    expect(await getConnection(owner.brandId, "instagram")).not.toBeNull();
  });

  it("still answers (with a receipt) when there is nothing to delete", async () => {
    const res = await dataDeletion(post("/api/meta/data-deletion", signRequestForTests({ user_id: "5555" }, META_SECRET)));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { confirmation_code: string }).confirmation_code).toBeTruthy();
    expect(await tokenCount()).toBe(2);
  });

  it("refuses an invalid signed_request and changes nothing", async () => {
    for (const signed of [signRequestForTests({ user_id: IG_USER }, "wrong"), "junk", null]) {
      const res = await dataDeletion(post("/api/meta/data-deletion", signed));
      expect(res.status).toBe(400);
    }
    expect(await getConnection(owner.brandId, "instagram")).not.toBeNull();
    expect(await tokenCount()).toBe(2);
  });

  it("the status page data shows only the state, and unknown codes find nothing", async () => {
    expect(await getDeletionStatus("does-not-exist-1234567890")).toBeNull();
    expect(await getDeletionStatus("short")).toBeNull();
    expect(await getDeletionStatus("../../etc/passwd/xxxxxxxxx")).toBeNull();
  });

  it("its URLs are public (the signature is the proof)", () => {
    expect(isPublicPath("/api/meta/data-deletion")).toBe(true);
    expect(isPublicPath("/api/meta/deauthorize")).toBe(true);
    expect(isPublicPath("/meta/deletion/abcdefghijklmnopqrstuvwx")).toBe(true);
    expect(isPublicPath("/api/connect/instagram")).toBe(false);
    expect(isPublicPath("/api/connect/instagram/callback")).toBe(false);
    expect(isPublicPath("/connections")).toBe(false);
  });
});

describe("the deauthorize callback", () => {
  it("marks the connection revoked and deletes its token", async () => {
    const res = await deauthorize(post("/api/meta/deauthorize", signRequestForTests({ user_id: IG_USER }, IG_SECRET)));
    expect(res.status).toBe(200);
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("revoked");
    expect(await tokenCount()).toBe(1);
  });

  it("refuses an invalid signed_request", async () => {
    expect((await deauthorize(post("/api/meta/deauthorize", signRequestForTests({ user_id: IG_USER }, "wrong")))).status).toBe(400);
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("active");
  });
});

describe("matching the person (platform_user_id)", () => {
  it("is stored in its own column, not as a scopes tag", async () => {
    const rows = await db.withAdmin((tx) =>
      tx.query<{ provider: string; platform_user_id: string; scopes: string[] }>("select provider, platform_user_id, scopes from public.channel_connections where brand_id = $1 order by provider", [owner.brandId]),
    );
    expect(rows.map((r) => [r.provider, r.platform_user_id])).toEqual([["facebook", FB_USER], ["instagram", IG_USER]]);
    expect(rows.every((r) => !r.scopes.some((s) => s.startsWith("meta_user:")))).toBe(true);
  });

  it("falls back to the account id when the column is empty", async () => {
    await db.withAdmin((tx) => tx.query("update public.channel_connections set platform_user_id = null where brand_id = $1", [owner.brandId]));
    await dataDeletion(post("/api/meta/data-deletion", signRequestForTests({ user_id: IG_USER }, IG_SECRET)));
    expect(await getConnection(owner.brandId, "instagram")).toBeNull();
    expect(await getConnection(owner.brandId, "facebook")).not.toBeNull();
  });

  it("still reads the old scopes tag on rows saved before the column existed", async () => {
    await db.withAdmin((tx) => tx.query("update public.channel_connections set platform_user_id = null, scopes = array['meta_user:4242'] where brand_id = $1 and provider = 'facebook'", [owner.brandId]));
    await dataDeletion(post("/api/meta/data-deletion", signRequestForTests({ user_id: FB_USER }, META_SECRET)));
    expect(await getConnection(owner.brandId, "facebook")).toBeNull();
  });
});
