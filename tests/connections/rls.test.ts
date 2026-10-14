import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveConnection } from "@/lib/connections/service";
import type { MockDb } from "@/lib/db/mock";
import { addMember, closeDb, makeOwner, makeStranger, openDb, stubMetaEnv, type Owner } from "./helpers";
import { vi } from "vitest";

let db: MockDb;
let owner: Owner;
let editor: string;
let stranger: string;
let connectionId: string;

beforeAll(async () => {
  db = await openDb();
  stubMetaEnv();
  owner = await makeOwner(db);
  editor = await addMember(db, owner.brandId, "editor");
  stranger = await makeStranger(db);
  const conn = await saveConnection({ brandId: owner.brandId, userId: owner.userId, provider: "instagram", accountId: "1001", accountName: "@x", scopes: [], platformUserId: null, expiresAt: null, token: "IGtoken-aaaaaaaaaaaaaaaaaaaaaaa" });
  connectionId = conn.id;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb(db);
});

describe("row-level security for connections", () => {
  it("members can read their brand's connections; other users cannot", async () => {
    for (const u of [owner.userId, editor]) {
      const rows = await db.withUser(u, (tx) => tx.query("select id from public.channel_connections where brand_id = $1", [owner.brandId]));
      expect(rows).toHaveLength(1);
    }
    expect(await db.withUser(stranger, (tx) => tx.query("select id from public.channel_connections"))).toHaveLength(0);
  });

  it("nobody signed in can insert, update or delete a connection (not even the owner)", async () => {
    for (const u of [owner.userId, editor]) {
      await expect(
        db.withUser(u, (tx) =>
          tx.query("insert into public.channel_connections (brand_id, provider, account_id) values ($1, 'facebook', 'evil')", [owner.brandId]),
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
      const updated = await db.withUser(u, (tx) => tx.query("update public.channel_connections set status = 'revoked', account_id = 'evil' where id = $1 returning id", [connectionId]));
      expect(updated).toHaveLength(0);
      const deleted = await db.withUser(u, (tx) => tx.query("delete from public.channel_connections where id = $1 returning id", [connectionId]));
      expect(deleted).toHaveLength(0);
    }
    const [row] = await db.withAdmin((tx) => tx.query<{ status: string; account_id: string }>("select status, account_id from public.channel_connections where id = $1", [connectionId]));
    expect(row).toEqual({ status: "active", account_id: "1001" });
  });

  it("a stranger cannot touch another brand's connection either", async () => {
    await expect(
      db.withUser(stranger, (tx) => tx.query("insert into public.channel_connections (brand_id, provider, account_id) values ($1, 'facebook', 'evil')", [owner.brandId])),
    ).rejects.toThrow();
    expect(await db.withUser(stranger, (tx) => tx.query("update public.channel_connections set status = 'revoked' where id = $1 returning id", [connectionId]))).toHaveLength(0);
  });
});

describe("channel_tokens is server only", () => {
  it("signed-in users, owners included, cannot read, write or delete tokens", async () => {
    for (const u of [owner.userId, editor, stranger]) {
      await expect(db.withUser(u, (tx) => tx.query("select * from public.channel_tokens"))).rejects.toThrow(/permission denied/i);
      await expect(db.withUser(u, (tx) => tx.query("select ciphertext from public.channel_tokens where brand_id = $1", [owner.brandId]))).rejects.toThrow(/permission denied/i);
      await expect(db.withUser(u, (tx) => tx.query("delete from public.channel_tokens"))).rejects.toThrow(/permission denied/i);
      await expect(
        db.withUser(u, (tx) => tx.query("insert into public.channel_tokens (connection_id, brand_id, ciphertext, iv, tag) values ($1, $2, 'a', 'b', 'c')", [connectionId, owner.brandId])),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("an anonymous caller cannot read tokens, connections or deletion receipts", async () => {
    for (const table of ["channel_tokens", "channel_connections", "deletion_requests"]) {
      await expect(
        db.withAdmin(async (tx) => {
          await tx.query("set local role anon");
          return tx.query(`select * from public.${table}`);
        }),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("signed-in users cannot read deletion receipts", async () => {
    await expect(db.withUser(owner.userId, (tx) => tx.query("select * from public.deletion_requests"))).rejects.toThrow(/permission denied/i);
  });

  it("the service role can use tokens", async () => {
    const rows = await db.withService((tx) => tx.query("select connection_id from public.channel_tokens where brand_id = $1", [owner.brandId]));
    expect(rows).toHaveLength(1);
  });
});
