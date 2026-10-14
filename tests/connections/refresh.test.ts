import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/connections/route";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { refreshConnections } from "@/lib/connections/refresh";
import { getConnection, markConnectionProblem, saveConnection } from "@/lib/connections/service";
import { readToken } from "@/lib/connections/tokens";
import type { MockDb } from "@/lib/db/mock";
import { listOutbox } from "@/lib/email/outbox";
import { NextRequest } from "next/server";
import { closeDb, fakeFetch, graphError, makeOwner, openDb, stubMetaEnv, when, type Owner } from "./helpers";

let db: MockDb;
let owner: Owner;

const DAY = 24 * 3600 * 1000;
const OLD = "IGold-token-aaaaaaaaaaaaaaaaaaaa";
const NEW = "IGnew-token-bbbbbbbbbbbbbbbbbbbb";

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
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** An Instagram connection whose token was saved `ageHours` ago and ends in `endsInDays`. */
async function connect(o: Owner, endsInDays: number, ageHours = 48) {
  const conn = await saveConnection({
    brandId: o.brandId,
    userId: o.userId,
    provider: "instagram",
    accountId: "17841400000000001",
    accountName: "@cornerbakery",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    platformUserId: "17841400000000001",
    expiresAt: new Date(Date.now() + endsInDays * DAY),
    token: OLD,
  });
  await db.withAdmin((tx) => tx.query("update public.channel_tokens set updated_at = now() - ($2 || ' hours')::interval where connection_id = $1", [conn.id, String(ageHours)]));
  return conn;
}

const emailsFor = async (brandId: string) => (await listOutbox()).filter((e) => e.brandId === brandId && e.kind === "connection_problem");
const refreshOk = () => when("GET", /refresh_access_token$/, { body: { access_token: NEW, token_type: "bearer", expires_in: 5_184_000 } });

describe("daily token refresh", () => {
  it("renews a token that is over 24 hours old and ends within 10 days", async () => {
    const conn = await connect(owner, 5);
    const { fetch, calls } = fakeFetch([refreshOk()]);
    const summary = await refreshConnections({ fetch });
    expect(summary).toMatchObject({ refreshed: 1, expired: 0, emailed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].host).toBe("graph.instagram.com");
    expect(calls[0].params.get("grant_type")).toBe("ig_refresh_token");
    expect(calls[0].params.get("access_token")).toBe(OLD);

    const after = await getConnection(owner.brandId, "instagram");
    expect(after!.status).toBe("active");
    expect(new Date(after!.expiresAt!).getTime() - Date.now()).toBeGreaterThan(59 * DAY);
    expect(await readToken({ id: conn.id, brandId: owner.brandId, provider: "instagram" })).toBe(NEW);
    expect(JSON.stringify(await db.withAdmin((tx) => tx.query("select * from public.channel_tokens where brand_id = $1", [owner.brandId])))).not.toContain(NEW);
  });

  it("leaves alone tokens that are too new, that end later than 10 days, or that are not Instagram", async () => {
    await connect(owner, 5, 2); // saved 2 hours ago
    const o2 = await makeOwner(db);
    await connect(o2, 30); // ends in 30 days
    const o3 = await makeOwner(db);
    await saveConnection({ brandId: o3.brandId, userId: o3.userId, provider: "facebook", accountId: "1001", accountName: "Page", scopes: [], platformUserId: null, expiresAt: new Date(Date.now() + 3 * DAY), token: "EAApage" });
    const { fetch, calls } = fakeFetch([refreshOk()]);
    const summary = await refreshConnections({ fetch });
    expect(summary.checked).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("when Meta refuses: marks the connection expired, stores the reason and emails the owner once", async () => {
    await connect(owner, 3);
    const { fetch } = fakeFetch([when("GET", /refresh_access_token$/, graphError(190, `Error validating access token: Session has expired ${OLD}`))]);
    const first = await refreshConnections({ fetch });
    expect(first).toMatchObject({ refreshed: 0, expired: 1, emailed: 1 });

    const conn = await getConnection(owner.brandId, "instagram");
    expect(conn!.status).toBe("expired");
    expect(conn!.lastError).toContain("Session has expired");
    expect(conn!.lastError).not.toContain(OLD);

    const mails = await emailsFor(owner.brandId);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain("Reconnect your Instagram");
    expect(mails[0].text).toContain("https://app.example.com/connections");
    expect(mails[0].text).not.toContain(OLD);

    // The next run does not look at an expired connection again, and a second report sends nothing.
    expect(await refreshConnections({ fetch })).toMatchObject({ checked: 0, emailed: 0 });
    expect(await markConnectionProblem({ brandId: owner.brandId, provider: "instagram", message: "again" })).toBe(false);
    expect(await emailsFor(owner.brandId)).toHaveLength(1);
  });

  it("a token that already ended is marked expired without calling Meta", async () => {
    await connect(owner, -1);
    const { fetch, calls } = fakeFetch([refreshOk()]);
    expect(await refreshConnections({ fetch })).toMatchObject({ expired: 1, emailed: 1 });
    expect(calls).toHaveLength(0);
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("expired");
  });

  it("a passing problem (Meta down, timeout, rate limit) is retried later and does not email", async () => {
    await connect(owner, 4);
    for (const reply of [{ status: 503, body: { error: { message: "down", code: 2 } } }, new Error("boom"), graphError(4, "limit")]) {
      const { fetch } = fakeFetch([when("GET", /refresh_access_token$/, reply)]);
      expect(await refreshConnections({ fetch })).toMatchObject({ refreshed: 0, expired: 0, retryLater: 1, emailed: 0 });
    }
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("active");
    expect(await emailsFor(owner.brandId)).toHaveLength(0);
  });

  it("reconnecting after an expiry makes the connection active again", async () => {
    await connect(owner, -1);
    await refreshConnections({ fetch: fakeFetch([]).fetch });
    await connect(owner, 60);
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("active");
  });
});

describe("the cron route", () => {
  const call = (auth?: string) => GET(new NextRequest("http://localhost:3000/api/cron/connections", { headers: auth ? { authorization: auth } : {} }));

  it("needs the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-s3cret-s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    const ok = await call("Bearer s3cret-s3cret-s3cret");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, checked: expect.any(Number) });
  });

  it("answers 401 when no secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer anything")).status).toBe(401);
  });
});
