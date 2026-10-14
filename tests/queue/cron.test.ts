import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET, maxDuration } from "@/app/api/cron/queue/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import type { MockDb } from "@/lib/db/mock";
import { getEnv } from "@/lib/env";
import { closeDb, openDb } from "../helpers/details";
import { itemOf, mailOf, makeShop, seedApproved, seedItem } from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
afterEach(() => vi.unstubAllEnvs());

const call = (headers: Record<string, string> = {}) => GET(new NextRequest("http://localhost/api/cron/queue", { headers }));

describe("GET /api/cron/queue", () => {
  it("answers 401 without a CRON_SECRET configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(getEnv().cronSecret).toBeUndefined();
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect((await call({ authorization: "Bearer undefined" })).status).toBe(401);
  });

  it("answers 401 for a missing or wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-value" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret-value-and-more" })).status).toBe(401);
  });

  it("runs the sweep with the right token: an item that is due is delivered, and the answer is a summary", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["whatsapp"], { endsOn: null });
    // Due an hour ago in real time (the route uses the real clock).
    await seedItem(db, shop, x.posts[0], { slotAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    const res = await call({ authorization: "Bearer s3cret-value" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, brands: expect.any(Number), delivered: expect.any(Number), published: expect.any(Number), missed: expect.any(Number), expired: expect.any(Number), pausedBrands: expect.any(Number) });
    expect(Array.isArray(body.items)).toBe(true);
    expect((await itemOf(db, x.posts[0].id)).status).toBe("delivered");
    expect(await mailOf(shop, "post_delivery")).toHaveLength(1);
    // The next hourly call finds nothing more for it.
    await call({ authorization: "Bearer s3cret-value" });
    expect(await mailOf(shop, "post_delivery")).toHaveLength(1);
  });

  it("is a public path (it checks the secret itself) and is listed in the Vercel crons and the Cloud Scheduler script", async () => {
    expect(maxDuration).toBe(120);
    expect(isPublicPath("/api/cron/queue")).toBe(true);
    const { readFileSync } = await import("node:fs");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: "/api/cron/queue", schedule: "15 * * * *" });
    expect(readFileSync("scripts/gcp/scheduler.sh", "utf8")).toMatch(/upsert weekly-posts-queue\s+"15 \* \* \* \*" \/api\/cron\/queue/);
  });
});
