import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const fake = vi.hoisted(() => ({ calls: [] as Array<{ via: string; sql: string; params: unknown[] }>, enabled: false }));
vi.mock("@/lib/db", async (orig) => {
  const real = await orig<typeof import("@/lib/db")>();
  return {
    ...real,
    getDb: () => {
      if (!fake.enabled) return real.getDb();
      const tx = {
        async query(sql: string, params: unknown[] = []) {
          fake.calls.push({ via: "withService", sql: sql.replace(/\s+/g, " ").trim(), params });
          return [{ jti_hash: "x" }];
        },
      };
      return {
        withService: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
        withUser: async () => {
          throw new Error("withUser must not be used for the delete link store");
        },
      };
    },
  };
});

import {
  USED_TOKEN_RETENTION_DAYS,
  claimDeleteLink,
  isDeleteLinkUnused,
  jtiHash,
  registerDeleteLink,
  releaseDeleteLink,
} from "@/lib/account/delete-link";
import { deleteAccount } from "@/lib/account/delete";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { createMockStorage } from "@/lib/storage/mock";
import { newUser } from "./helpers";
import { seedAccount } from "./seed";

let db: MockDb;
beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
afterEach(() => {
  fake.enabled = false;
  fake.calls.length = 0;
  vi.unstubAllEnvs();
});

const row = (jti: string) =>
  db.withAdmin((tx) => tx.query<{ purpose: string; used_at: string | null }>("select purpose, used_at from public.used_tokens where jti_hash = $1", [jtiHash(jti)]));

describe("delete-link store (public.used_tokens)", () => {
  it("registers, claims once, releases, and claims again", async () => {
    const jti = randomUUID();
    await registerDeleteLink(jti, new Date(Date.now() + 3600_000));
    expect(await row(jti)).toEqual([{ purpose: "delete_account", used_at: null }]);
    expect(await isDeleteLinkUnused(jti)).toBe(true);
    expect(await claimDeleteLink(jti)).toBe(true);
    expect(await claimDeleteLink(jti)).toBe(false);
    expect(await isDeleteLinkUnused(jti)).toBe(false);
    await releaseDeleteLink(jti);
    expect(await isDeleteLinkUnused(jti)).toBe(true);
    expect(await claimDeleteLink(jti)).toBe(true);
    // An unknown id is never usable.
    expect(await isDeleteLinkUnused(randomUUID())).toBe(false);
    expect(await claimDeleteLink(randomUUID())).toBe(false);
  });

  it("stores only a sha256 of the jti", async () => {
    const jti = randomUUID();
    await registerDeleteLink(jti, new Date(Date.now() + 3600_000));
    expect(jtiHash(jti)).toMatch(/^[0-9a-f]{64}$/);
    const all = await db.withAdmin((tx) => tx.query<{ jti_hash: string }>("select jti_hash from public.used_tokens"));
    expect(all.some((r) => r.jti_hash === jti)).toBe(false);
  });

  it("a new request deletes rows that expired more than 7 days ago, and keeps newer ones", async () => {
    expect(USED_TOKEN_RETENTION_DAYS).toBe(7);
    const old = randomUUID();
    const recent = randomUUID();
    const live = randomUUID();
    await db.withAdmin(async (tx) => {
      for (const [jti, interval] of [[old, "-8 days"], [recent, "-3 days"], [live, "1 hour"]] as const) {
        await tx.query("insert into public.used_tokens (jti_hash, purpose, expires_at, used_at) values ($1, 'delete_account', now() + $2::interval, now())", [jtiHash(jti), interval]);
      }
    });
    await registerDeleteLink(randomUUID(), new Date(Date.now() + 3600_000));
    expect(await row(old)).toHaveLength(0);
    expect(await row(recent)).toHaveLength(1);
    expect(await row(live)).toHaveLength(1);
  });

  it("is server-only: the owner role cannot read or write it", async () => {
    const u = await newUser(db, `tok-${randomUUID().slice(0, 6)}@example.com`);
    await expect(db.withUser(u, (tx) => tx.query("select * from public.used_tokens"))).rejects.toThrow();
    await expect(
      db.withUser(u, (tx) => tx.query("insert into public.used_tokens (jti_hash, purpose, expires_at) values ('h', 'delete_account', now())")),
    ).rejects.toThrow();
  });

  it("rows are kept when the account is deleted (they hold no personal data)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pm-tok-"));
    try {
      const storage = createMockStorage(root);
      const a = await seedAccount(db, storage);
      const jti = randomUUID();
      await registerDeleteLink(jti, new Date(Date.now() + 3600_000));
      await claimDeleteLink(jti);
      await deleteAccount(a.userId, { storage });
      expect(await row(jti)).toEqual([{ purpose: "delete_account", used_at: expect.anything() }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("the mock and Supabase backends run the very same store code, through withService", async () => {
    const run = async () => {
      fake.calls.length = 0;
      fake.enabled = true;
      const jti = "jti-1";
      await registerDeleteLink(jti, new Date("2026-10-13T10:00:00Z"));
      await isDeleteLinkUnused(jti);
      await claimDeleteLink(jti);
      await releaseDeleteLink(jti);
      return fake.calls.map((c) => ({ ...c }));
    };
    vi.stubEnv("DATA_BACKEND", "mock");
    const asMock = await run();
    vi.stubEnv("DATA_BACKEND", "supabase");
    const asSupabase = await run();
    expect(asSupabase).toEqual(asMock);
    expect(asMock.length).toBe(5); // cleanup, insert, select, claim, release
    expect(asMock.every((c) => c.via === "withService" && c.sql.includes("public.used_tokens"))).toBe(true);

    // And there is no backend branch or mock-only table in the store module.
    const src = readFileSync(path.join(process.cwd(), "src", "lib", "account", "delete-link.ts"), "utf8");
    expect(src).not.toMatch(/mock_meta|getMockDb|dataBackend|withAdmin/);
  });
});
