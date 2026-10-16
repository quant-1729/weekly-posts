import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const runSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ideas/run", () => ({ runResearch: runSpy }));

import { GET, maxDuration } from "@/app/api/cron/research/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import type { MockDb } from "@/lib/db/mock";
import { getEnv } from "@/lib/env";
import { closeDb, makeShop, openDb, rows } from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
afterEach(() => {
  vi.unstubAllEnvs();
  runSpy.mockReset();
});

const call = (headers: Record<string, string> = {}) => GET(new NextRequest("http://localhost/api/cron/research", { headers }));

describe("GET /api/cron/research", () => {
  it("answers 401 without a CRON_SECRET configured, and never starts a run", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(getEnv().cronSecret).toBeUndefined();
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect((await call({ authorization: "Bearer undefined" })).status).toBe(401);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("answers 401 for a missing or wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-value" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret-value-and-more" })).status).toBe(401);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("with the right token runs the weekly sweep and answers with a summary", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const shop = await makeShop(db);
    runSpy.mockResolvedValue({ status: "done", error: null });
    const res = await call({ authorization: "Bearer s3cret-value" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, eligible: 1, started: 1, done: 1, failed: 0, capped: 0, deferred: 0 });
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0][0]).toMatchObject({ brandId: shop.brandId, trigger: "weekly", service: true });
    // The answer names no brand and holds no owner text.
    expect(JSON.stringify(body)).not.toContain(shop.brandId);
    await rows(db, "select 1");
  });

  it("is a public path (it checks the secret itself) and is listed in Vercel crons, the Cloud Scheduler script and the deploy notes for Mondays, hourly 06:00-09:00 UTC", () => {
    expect(maxDuration).toBe(300);
    expect(isPublicPath("/api/cron/research")).toBe(true);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: "/api/cron/research", schedule: "0 6-9 * * 1" });
    expect(readFileSync("scripts/gcp/scheduler.sh", "utf8")).toMatch(/upsert weekly-posts-research\s+"0 6-9 \* \* 1"\s+\/api\/cron\/research/);
    expect(readFileSync("docs/deploy.md", "utf8")).toMatch(/weekly-posts-research.*0 6-9 \* \* 1.*\/api\/cron\/research/);
  });
});
