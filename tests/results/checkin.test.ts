import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => jar.api,
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/results",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import ResultsPage from "@/app/(app)/results/page";
import { saveCheckinAction } from "@/app/(app)/results/actions";
import WeekPage from "@/app/(app)/week/page";
import { CheckinCard } from "@/components/results/checkin-card";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { upsertCheckin } from "@/lib/links/ops";
import { lastWeekStartFor, loadCheckinCard, saveDashboardCheckin } from "@/lib/results/checkin";
import { seedPost } from "../shortlinks/helpers";
import { seedWeeklyBrand } from "../weekly/helpers";
import { openThenPress } from "../links/helpers";
import { signLink } from "@/lib/links/tokens";
import { seedResultPost, setMinutes } from "./helpers";

let db: MockDb;
let a: { userId: string; brandId: string };
let b: { userId: string; brandId: string };

type Row = Record<string, unknown>;
const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Row>(sql, params));
const checkinRows = (brandId: string) =>
  rows("select id::text as id, brand_id::text as brand_id, week_start::text as week_start, answer::text as answer, via from public.checkins where brand_id = $1 order by week_start", [brandId]);

const TZ = "Europe/London";
const LAST_WEEK = lastWeekStartFor(new Date(), TZ);
// Monday of the week before last: never answered by the tests below unless they say so.
const NOW = new Date("2026-10-20T12:00:00Z"); // Tuesday; last week starts Monday 12 Oct

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  a = await seedWeeklyBrand(db, { name: "Brand A", timezone: TZ });
  b = await seedWeeklyBrand(db, { name: "Brand B", timezone: TZ });
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  jar.store.set(SESSION_COOKIE, await signSession({ id: a.userId, email: "a@example.com" }));
  await rows("delete from public.checkins");
});

describe("dashboard check-in: one tap, and it can be changed (AC 20)", () => {
  it("one call records the answer for last week with via = dashboard", async () => {
    expect(lastWeekStartFor(NOW, TZ)).toBe("2026-10-12");
    expect(await saveDashboardCheckin(a.userId, a.brandId, "2026-10-12", "few", NOW)).toEqual({ ok: true });
    expect(await checkinRows(a.brandId)).toEqual([
      expect.objectContaining({ brand_id: a.brandId, week_start: "2026-10-12", answer: "few", via: "dashboard" }),
    ]);
  });

  it("changing the answer updates the same row", async () => {
    await saveDashboardCheckin(a.userId, a.brandId, "2026-10-12", "none", NOW);
    const [first] = await checkinRows(a.brandId);
    await saveDashboardCheckin(a.userId, a.brandId, "2026-10-12", "many", NOW);
    const after = await checkinRows(a.brandId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: first.id, answer: "many", via: "dashboard" });
  });

  it("only a Monday that is not in the future can be answered", async () => {
    expect(await saveDashboardCheckin(a.userId, a.brandId, "2026-10-13", "few", NOW)).toEqual({ ok: false, reason: "bad_week" }); // Tuesday
    expect(await saveDashboardCheckin(a.userId, a.brandId, "2026-10-26", "few", NOW)).toEqual({ ok: false, reason: "bad_week" }); // next week
    expect(await saveDashboardCheckin(a.userId, a.brandId, "garbage", "few", NOW)).toEqual({ ok: false, reason: "bad_week" });
    expect(await checkinRows(a.brandId)).toEqual([]);
  });

  it("row-level security: a user cannot answer for another brand", async () => {
    await expect(saveDashboardCheckin(b.userId, a.brandId, "2026-10-12", "many", NOW)).rejects.toThrow();
    expect(await checkinRows(a.brandId)).toEqual([]);
  });
});

describe("the email link and the dashboard write the same row shape", () => {
  it("the email handler's row has the same columns as the dashboard's, and a later dashboard tap changes that row", async () => {
    // The email path: open the link, press the button.
    const token = await signLink({ brandId: a.brandId, act: "checkin", weekStart: "2026-10-12", extra: { answer: "few" } });
    const { posted } = await openThenPress(token);
    expect(posted.status).toBe(200);
    const [fromEmail] = await checkinRows(a.brandId);
    expect(fromEmail).toMatchObject({ brand_id: a.brandId, week_start: "2026-10-12", answer: "few", via: "email_link" });

    // The shared function behind the handler (ops.upsertCheckin) gives the same shape.
    await upsertCheckin(a.brandId, "2026-10-05", "many");
    // A dashboard tap for the same week changes the email row instead of adding one.
    await saveDashboardCheckin(a.userId, a.brandId, "2026-10-12", "none", NOW);
    await saveDashboardCheckin(a.userId, a.brandId, "2026-10-19", "many", new Date("2026-10-21T12:00:00Z"));
    const all = await checkinRows(a.brandId);
    expect(all.map((r) => [r.week_start, r.answer, r.via])).toEqual([
      ["2026-10-05", "many", "email_link"],
      ["2026-10-12", "none", "dashboard"],
      ["2026-10-19", "many", "dashboard"],
    ]);
    expect(all[1].id).toBe(fromEmail.id);
    // Every row has exactly the same set of columns.
    expect(new Set(all.map((r) => Object.keys(r).sort().join(",")))).toHaveProperty("size", 1);
  });
});

describe("the check-in card on the page", () => {
  it("highlights the saved answer, and only that one", () => {
    const html = renderToString(createElement(CheckinCard, { weekStart: "2026-10-12", initial: "few" }));
    expect(html).toContain("For the week of 12 Oct");
    const pressed = [...html.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[1]]);
    expect(pressed).toEqual([
      ["None", "false"],
      ["A few", "true"],
      ["Many", "false"],
    ]);
    const none = renderToString(createElement(CheckinCard, { weekStart: "2026-10-12", initial: null }));
    expect(none).not.toContain('aria-pressed="true"');
  });

  it("the server action records one tap for the signed-in owner's brand", async () => {
    expect(await saveCheckinAction(LAST_WEEK, "many")).toEqual({ ok: true });
    expect(await checkinRows(a.brandId)).toEqual([expect.objectContaining({ week_start: LAST_WEEK, answer: "many", via: "dashboard" })]);
    expect(await saveCheckinAction(LAST_WEEK, "few")).toEqual({ ok: true });
    expect(await checkinRows(a.brandId)).toHaveLength(1);
    expect(await checkinRows(b.brandId)).toEqual([]);
  });

  it("the server action refuses a made-up answer, a bad week, or no session", async () => {
    expect(await saveCheckinAction(LAST_WEEK, "lots")).toMatchObject({ ok: false });
    expect(await saveCheckinAction("2020-01-02", "few")).toMatchObject({ ok: false });
    jar.store.delete(SESSION_COOKIE);
    expect(await saveCheckinAction(LAST_WEEK, "few")).toMatchObject({ ok: false });
    expect(await checkinRows(a.brandId)).toEqual([]);
  });

  it("/week shows the card when last week had posts and no check-in, and hides it once answered", async () => {
    // No posts last week: no card.
    expect(renderToString((await WeekPage()) as ReactElement)).not.toContain("bring enquiries");
    await seedPost(db, a.brandId, a.userId, { withBatch: true, weekStart: LAST_WEEK });
    const html = renderToString((await WeekPage()) as ReactElement);
    expect(html).toContain("Did last week&#x27;s posts bring enquiries?");
    expect(html.indexOf("bring enquiries")).toBeLessThan(html.indexOf("Generate this week")); // above the week view
    expect((await loadCheckinCard(a.userId, a.brandId)).answer).toBeNull();
    await saveDashboardCheckin(a.userId, a.brandId, LAST_WEEK, "few");
    expect(renderToString((await WeekPage()) as ReactElement)).not.toContain("bring enquiries");
    // The results page still shows it, with the answer highlighted.
    const results = renderToString((await ResultsPage()) as ReactElement);
    expect(results).toMatch(/aria-pressed="true"[^>]*>A few</);
  });
});

describe("/results page", () => {
  it("shows the empty state and the not-measured line for a new owner", async () => {
    jar.store.set(SESSION_COOKIE, await signSession({ id: b.userId, email: "b@example.com" }));
    const html = renderToString((await ResultsPage()) as ReactElement);
    expect(html).toContain("Your results will show here after your first week of posts.");
    expect(html).toContain("Not counted here: messages, calls and walk-ins. Your weekly check-in is how we track those.");
  });

  it("shows the summary: months, time saved, clicks (at least), check-ins and the not-measured line", async () => {
    const c = await seedWeeklyBrand(db, { name: "Brand C", timezone: TZ });
    await setMinutes(db, c.brandId, 30);
    const day = (offset: number) => new Date(Date.now() - offset * 3600_000).toISOString();
    await seedResultPost(db, c.brandId, c.userId, { topic: "Spring menu", postedAt: day(1), clicks: [day(1), day(1)] });
    jar.store.set(SESSION_COOKIE, await signSession({ id: c.userId, email: "c@example.com" }));
    const html = renderToString((await ResultsPage()) as ReactElement);
    expect(html).toContain("Spring menu");
    expect(html).toContain("at least 2 clicks");
    expect(html).toContain("Instagram captions have no clickable links");
    expect(html).toContain("Enquiries, from your check-ins");
    expect(html).toContain("Not counted here: messages, calls and walk-ins.");
    expect(html).not.toContain("Tell us how long a post takes you");
    await setMinutes(db, c.brandId, null);
    const nomin = renderToString((await ResultsPage()) as ReactElement);
    expect(nomin).toContain("Tell us how long a post takes you to see time saved");
    expect(nomin).toContain('href="/brand#settings"');
  });
});
