import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET, maxDuration } from "@/app/api/cron/insights/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import type { MockDb } from "@/lib/db/mock";
import { getEnv } from "@/lib/env";
import { closeDb, openDb } from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
afterEach(() => vi.unstubAllEnvs());

const call = (headers: Record<string, string> = {}) => GET(new NextRequest("http://localhost/api/cron/insights", { headers }));

describe("GET /api/cron/insights", () => {
  it("answers 401 without a CRON_SECRET configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(getEnv().cronSecret).toBeUndefined();
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect((await call({ authorization: "Bearer undefined" })).status).toBe(401);
  });

  it("answers 401 for a missing or wrong bearer token and does not run the sweep", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-value" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret-value-and-more" })).status).toBe(401);
    expect(spy.mock.calls.some((c) => String(c[0]).includes("[insights] sweep"))).toBe(false);
    spy.mockRestore();
  });

  it("runs the sweep with the right token and answers a summary (nothing due: no call to Meta)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call({ authorization: "Bearer s3cret-value" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, due: 0, stored: 0, permissionMissing: 0, errors: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("is a public path (it checks the secret itself) and is listed in vercel.json, the Cloud Scheduler script and the deploy doc", async () => {
    expect(maxDuration).toBe(120);
    expect(isPublicPath("/api/cron/insights")).toBe(true);
    const { readFileSync } = await import("node:fs");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: "/api/cron/insights", schedule: "45 * * * *" });
    expect(readFileSync("scripts/gcp/scheduler.sh", "utf8")).toMatch(/upsert weekly-posts-insights\s+"45 \* \* \* \*" \/api\/cron\/insights/);
    expect(readFileSync("docs/deploy.md", "utf8")).toMatch(/weekly-posts-insights.*45 \* \* \* \*.*\/api\/cron\/insights/);
  });
});
