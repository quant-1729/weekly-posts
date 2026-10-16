import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ResearchPanel } from "@/components/admin/panels";
import type { AdminUser } from "@/lib/admin/access";
import { getAdminMetrics } from "@/lib/admin/metrics";
import type { MockDb } from "@/lib/db/mock";
import { NOW, closeDb, makeShop, openDb } from "./helpers";
import { seedCard, seedRun } from "./seed";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});

describe("the admin Research panel (R-10)", () => {
  const admin: AdminUser = { id: "admin", email: "boss@example.com", isAdmin: true };
  const SECRET_FOCUS = "SECRET-FOCUS-wedding cakes for Jane";
  const TOKEN = "EAAGm0PX4ZCpsBAKzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

  it("counts this week's runs by status, the cost, failures with cleaned errors and the top capped reasons, with no owner text", async () => {
    const a = await makeShop(db, { name: "Admin Bakery A" });
    const b = await makeShop(db, { name: "Admin Chai B" });
    // NOW is Thu 15 Oct 2026; the UTC week starts Mon 12 Oct 00:00.
    const at = (iso: string) => new Date(iso);
    await seedRun(db, a.brandId, { status: "done", trigger: "weekly", costUsd: 0.34, startedAt: at("2026-10-12T06:00:00Z"), focus: SECRET_FOCUS });
    await seedRun(db, b.brandId, { status: "done", trigger: "manual", costUsd: 0.2, startedAt: at("2026-10-14T09:00:00Z"), focus: SECRET_FOCUS });
    await seedRun(db, b.brandId, { status: "failed", trigger: "manual", costUsd: 0.05, startedAt: at("2026-10-15T08:00:00Z"), error: `Gemini said no: token ${TOKEN} rejected. ${"x ".repeat(150)}` });
    await seedRun(db, a.brandId, { status: "capped", trigger: "manual", costUsd: 0, startedAt: at("2026-10-15T09:00:00Z"), error: "manual_limit" });
    await seedRun(db, b.brandId, { status: "capped", trigger: "weekly", costUsd: 0, startedAt: at("2026-10-13T09:00:00Z"), error: "research_cap" });
    await seedRun(db, a.brandId, { status: "capped", trigger: "manual", costUsd: 0, startedAt: at("2026-10-13T10:00:00Z"), error: "research_cap" });
    // Last week and long ago: out of "this week" but in the total; the old failure is outside 14 days.
    await seedRun(db, a.brandId, { status: "done", trigger: "weekly", costUsd: 0.4, startedAt: at("2026-10-05T06:00:00Z") });
    await seedRun(db, a.brandId, { status: "failed", trigger: "weekly", costUsd: 0.01, startedAt: at("2026-08-01T06:00:00Z"), error: "old failure" });
    // Cards with owner-looking text must not appear.
    const cardRun = await seedRun(db, a.brandId, { status: "done", trigger: "manual", costUsd: 0.1, startedAt: at("2026-10-15T07:00:00Z") });
    await seedCard(db, a.brandId, cardRun, { title: "CARD-TITLE-OWNER-TEXT" });

    const m = (await getAdminMetrics(admin, NOW)).research;
    expect(m.weekStart).toBe("2026-10-12");
    expect(m.runsThisWeek).toBe(7);
    expect(Object.fromEntries(m.byStatus.map((r) => [r.key, r.n]))).toEqual({ done: 3, failed: 1, capped: 3 });
    expect(m.costThisWeekUsd).toBeCloseTo(0.34 + 0.2 + 0.05 + 0.1, 4);
    expect(m.costTotalUsd).toBeCloseTo(0.34 + 0.2 + 0.05 + 0.4 + 0.01 + 0.1, 4);
    expect(m.failures).toHaveLength(1);
    expect(m.failures[0]).toMatchObject({ brandName: "Admin Chai B", trigger: "manual", at: "2026-10-15T08:00:00Z" });
    expect(m.failures[0].error).not.toContain(TOKEN);
    expect(m.failures[0].error).toContain("[hidden]");
    expect(m.failures[0].error.length).toBeLessThanOrEqual(200);
    expect(m.cappedReasons).toEqual([
      { key: "research_cap", n: 2 },
      { key: "manual_limit", n: 1 },
    ]);

    const html = renderToString(createElement(ResearchPanel, { m: await getAdminMetrics(admin, NOW) }));
    expect(html).toContain("Research (Ideas)");
    expect(html).toContain("Runs this week");
    expect(html).toContain("research cap");
    expect(html).toContain("Admin Chai B");
    for (const secret of [SECRET_FOCUS, "CARD-TITLE-OWNER-TEXT", TOKEN]) {
      expect(html).not.toContain(secret);
      expect(JSON.stringify(m)).not.toContain(secret);
    }
  });

  it("shows empty states when nothing ran", async () => {
    const m = await getAdminMetrics(admin, new Date("2027-03-01T10:00:00Z"));
    expect(m.research.runsThisWeek).toBe(0);
    expect(m.research.failures).toEqual([]);
    expect(m.research.cappedReasons).toEqual([]);
    const html = renderToString(createElement(ResearchPanel, { m }));
    expect(html).toContain("No research runs this week.");
    expect(html).toContain("No failed runs.");
    expect(html).toContain("No capped runs.");
  });
});
