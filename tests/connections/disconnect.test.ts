import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { disconnectChannel, getConnection, listConnections, saveConnection } from "@/lib/connections/service";
import type { MockDb } from "@/lib/db/mock";
import { addMember, closeDb, fakeFetch, graphError, makeOwner, openDb, stubMetaEnv, when, type Owner } from "./helpers";

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
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const connect = (provider: "instagram" | "facebook", token = "IGtoken-aaaaaaaaaaaaaaaaaaaaaaa") =>
  saveConnection({ brandId: owner.brandId, userId: owner.userId, provider, accountId: "1001", accountName: "Corner Bakery", scopes: [], platformUserId: null, expiresAt: null, token });

const tokenRows = () => db.withAdmin((tx) => tx.query("select 1 from public.channel_tokens where brand_id = $1", [owner.brandId]));

describe("disconnect", () => {
  it("deletes the token, marks the connection revoked and hides it from the list", async () => {
    await connect("instagram");
    expect(await tokenRows()).toHaveLength(1);
    expect(await disconnectChannel({ userId: owner.userId, brandId: owner.brandId, provider: "instagram" })).toBe(true);
    expect(await tokenRows()).toHaveLength(0);
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("revoked");
    expect(await listConnections(owner.userId, owner.brandId)).toHaveLength(0);
    // Nothing left to disconnect.
    expect(await disconnectChannel({ userId: owner.userId, brandId: owner.brandId, provider: "instagram" })).toBe(false);
  });

  it("refuses anyone who is not the owner and changes nothing", async () => {
    await connect("instagram");
    await expect(disconnectChannel({ userId: editor, brandId: owner.brandId, provider: "instagram" })).rejects.toMatchObject({ code: "not_owner" });
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("active");
    expect(await tokenRows()).toHaveLength(1);
  });

  it("asks Facebook to drop its permissions (best effort) and still disconnects when that fails", async () => {
    await connect("facebook", "EAAPageToken-aaaaaaaaaaaaaaaaaaaaaaa");
    const ok = fakeFetch([when("DELETE", /\/me\/permissions$/, { body: { success: true } })]);
    expect(await disconnectChannel({ userId: owner.userId, brandId: owner.brandId, provider: "facebook", fetch: ok.fetch })).toBe(true);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0].host).toBe("graph.facebook.com");

    await connect("facebook", "EAAPageToken-bbbbbbbbbbbbbbbbbbbbbbb");
    const bad = fakeFetch([when("DELETE", /\/me\/permissions$/, graphError(190, "nope"))]);
    expect(await disconnectChannel({ userId: owner.userId, brandId: owner.brandId, provider: "facebook", fetch: bad.fetch })).toBe(true);
    expect((await getConnection(owner.brandId, "facebook"))!.status).toBe("revoked");
  });

  it("can be connected again afterwards", async () => {
    await connect("instagram");
    await disconnectChannel({ userId: owner.userId, brandId: owner.brandId, provider: "instagram" });
    await connect("instagram", "IGtoken-bbbbbbbbbbbbbbbbbbbbbbb");
    expect((await listConnections(owner.userId, owner.brandId)).map((c) => c.status)).toEqual(["active"]);
    expect(await tokenRows()).toHaveLength(1);
  });
});
