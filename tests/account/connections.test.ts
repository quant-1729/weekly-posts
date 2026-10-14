import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deleteAccount } from "@/lib/account/delete";
import { buildExport } from "@/lib/account/export";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { saveConnection } from "@/lib/connections/service";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import type { Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { stubMetaEnv } from "../connections/helpers";
import { seedAccount, type SeededAccount } from "./seed";
import { collect, parseZip } from "./zip-read";

let db: MockDb;
let root: string;
let storage: Storage;
let a: SeededAccount;

const IG_TOKEN = "IGAAexport-secret-token-123456789";
const FB_TOKEN = "EAAexport-page-token-123456789012";

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  stubMetaEnv();
  resetTokenKeyForTests();
  root = await mkdtemp(path.join(os.tmpdir(), "pm-account-conn-"));
  storage = createMockStorage(root);
  a = await seedAccount(db, storage);
  const base = { brandId: a.brandId, userId: a.userId, scopes: [], expiresAt: null };
  await saveConnection({ ...base, provider: "instagram", accountId: "17841400000000001", accountName: "@cornerbakery", platformUserId: "17841400000000001", expiresAt: new Date("2026-12-01T00:00:00Z"), token: IG_TOKEN });
  await saveConnection({ ...base, provider: "facebook", accountId: "1001", accountName: "Corner Bakery", platformUserId: "4242", token: FB_TOKEN });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

const connectionRows = () => db.withAdmin((tx) => tx.query("select 1 from public.channel_connections where brand_id = $1", [a.brandId]));
const tokenRows = () => db.withAdmin((tx) => tx.query("select 1 from public.channel_tokens where brand_id = $1", [a.brandId]));

describe("account export", () => {
  it("lists the connections (provider, account name, status, dates) and never a token", async () => {
    const zip = parseZip(await collect(await buildExport(a.userId, { storage, now: new Date("2026-10-14T00:00:00Z") })));
    const list = JSON.parse(new TextDecoder().decode(zip.files.get("connections.json"))) as Array<Record<string, unknown>>;
    expect(list.map((c) => [c.provider, c.account_name, c.status]).sort()).toEqual([
      ["facebook", "Corner Bakery", "active"],
      ["instagram", "@cornerbakery", "active"],
    ]);
    const ig = list.find((c) => c.provider === "instagram")!;
    expect(Object.keys(ig).sort()).toEqual(["account_name", "connected_at", "expires_at", "provider", "status", "updated_at"]);
    expect(ig.expires_at).toBe("2026-12-01T00:00:00Z");

    expect(new TextDecoder().decode(zip.files.get("README.txt"))).toContain("connections.json");
    for (const bytes of zip.files.values()) {
      const text = new TextDecoder().decode(bytes);
      expect(text).not.toContain(IG_TOKEN);
      expect(text).not.toContain(FB_TOKEN);
      expect(text).not.toContain("ciphertext");
    }
  });
});

describe("account deletion", () => {
  it("asks Meta to drop our access while the tokens still exist, then removes connections and tokens", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      // The connection and its token are still there when Meta is asked.
      seen.push(`${init?.method ?? "GET"} ${u.host}${u.pathname} rows=${(await connectionRows()).length}/${(await tokenRows()).length}`);
      expect(u.searchParams.get("access_token")).toBe(FB_TOKEN);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    const res = await deleteAccount(a.userId, { storage });
    expect(res.deleted).toBe(true);
    expect(seen).toEqual(["DELETE graph.facebook.com/v23.0/me/permissions rows=2/2"]);
    expect(await connectionRows()).toHaveLength(0);
    expect(await tokenRows()).toHaveLength(0);
  });

  it("is not blocked when Meta cannot be reached or refuses", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect((await deleteAccount(a.userId, { storage })).deleted).toBe(true);
    expect(await connectionRows()).toHaveLength(0);
    expect(await tokenRows()).toHaveLength(0);
  });

  it("is not blocked when a token cannot be read (the key changed)", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await deleteAccount(a.userId, { storage })).deleted).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await connectionRows()).toHaveLength(0);
  });
});
