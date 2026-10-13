import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import CostsPage from "@/app/dev/costs/page";
import type { MockDb } from "@/lib/db/mock";
import { isDevToolsEnabled } from "@/lib/env";
import type { UsageKind } from "@/lib/usage";
import { costReport, formatCostReport } from "@/lib/usage/report";
import { closeTestDb, openTestDb } from "../brand/helpers";
import { seedWeeklyBrand } from "../weekly/helpers";

let db: MockDb;
let a: { brandId: string; userId: string };
let b: { brandId: string; userId: string };

async function eventAt(brandId: string, iso: string, kind: UsageKind, usd: number): Promise<void> {
  await db.withAdmin((tx) =>
    tx.query("insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, $2::public.usage_kind, $3, $4)", [brandId, kind, usd, iso]),
  );
}

beforeAll(async () => {
  db = await openTestDb();
  a = await seedWeeklyBrand(db, { name: "Corner Bakery", timezone: "Europe/London" });
  b = await seedWeeklyBrand(db, { name: "Chai Stop", timezone: "Asia/Kolkata" });
  await eventAt(a.brandId, "2026-12-21T08:00:00Z", "weekly_batch", 0.02);
  await eventAt(a.brandId, "2026-12-21T08:00:30Z", "fact_check", 0.005);
  await eventAt(a.brandId, "2026-12-22T08:00:00Z", "rewrite", 0.002);
  await eventAt(a.brandId, "2026-12-14T08:00:00Z", "weekly_batch", 0.01); // the week before
  await eventAt(b.brandId, "2026-12-20T18:40:00Z", "weekly_batch", 0.6); // Monday 00:10 IST: week of 21 Dec, over the cap
});
afterAll(async () => {
  await closeTestDb(db);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cost report (Req 23)", () => {
  it("gives total usd, calls by kind and whether the week is under the cap, per brand per local week", async () => {
    const rows = await costReport();
    const bakery = rows.find((r) => r.brandId === a.brandId && r.weekStart === "2026-12-21")!;
    expect(bakery.usd).toBeCloseTo(0.027, 6);
    expect(bakery.calls).toEqual({ weekly_batch: 1, fact_check: 1, rewrite: 1 });
    expect(bakery.totalCalls).toBe(3);
    expect(bakery.underCap).toBe(true);
    expect(bakery.brandName).toBe("Corner Bakery");

    expect(rows.find((r) => r.brandId === a.brandId && r.weekStart === "2026-12-14")).toMatchObject({ usd: 0.01, totalCalls: 1 });
    const chai = rows.find((r) => r.brandId === b.brandId)!;
    expect(chai).toMatchObject({ weekStart: "2026-12-21", underCap: false });
    expect(chai.usd).toBeCloseTo(0.6, 6);
  });

  it("lists newest weeks first, and can be narrowed to one brand or from one week", async () => {
    const rows = await costReport();
    const weeks = rows.map((r) => r.weekStart);
    expect(weeks).toEqual([...weeks].sort().reverse());
    expect((await costReport({ brandId: a.brandId })).every((r) => r.brandId === a.brandId)).toBe(true);
    expect((await costReport({ fromWeekStart: "2026-12-21" })).every((r) => r.weekStart >= "2026-12-21")).toBe(true);
  });

  it("prints a readable table", async () => {
    const text = formatCostReport(await costReport());
    expect(text).toContain("cap $0.50");
    expect(text).toMatch(/2026-12-21 {2}Corner Bakery \(\w{8}\) {2}\$0\.0270 {2}under cap {2}fact_check=1 rewrite=1 weekly_batch=1/);
    expect(text).toMatch(/Chai Stop .*OVER CAP/);
    expect(formatCostReport([])).toBe("No AI usage recorded yet.");
  });
});

describe("/dev/costs", () => {
  it("shows the report in development", async () => {
    const html = renderToString(createElement("div", null, await CostsPage()));
    expect(html).toContain("Corner Bakery");
    expect(html).toContain("Chai Stop");
    expect(html).toContain("0.0270");
  });

  it("is a 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevToolsEnabled()).toBe(false);
    await expect(CostsPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("is a 404 when VERCEL_ENV is set, whatever its value", async () => {
    for (const v of ["production", "preview", "development"]) {
      vi.stubEnv("VERCEL_ENV", v);
      await expect(CostsPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
  });
});
