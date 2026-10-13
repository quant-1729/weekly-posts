import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { listOutbox } from "@/lib/email/outbox";
import { buildWeeklyEmail, type WeeklyEmailPost } from "@/lib/email/weekly";
import { emailSummaryLine, loadEmailSummary } from "@/lib/results/email";
import { generateWeek } from "@/lib/weekly/generate";
import { lintEmailHtml } from "../email/lint";
import { seedWeeklyBrand, tempStorage } from "../weekly/helpers";
import { seedResultPost, setMinutes } from "./helpers";

const NOW = new Date("2026-10-20T12:00:00Z");
const NOT_MEASURED = "Not counted here: messages, calls and walk-ins. Your weekly check-in is how we track those.";
const BRAND = "11111111-1111-4111-8111-111111111111";
const posts: WeeklyEmailPost[] = [
  { id: "22222222-2222-4222-8222-000000000001", suggestedDay: "2026-10-20", channel: "instagram", caption: "Fresh sourdough.", flagCount: 0, hasImage: true },
];

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});
afterEach(() => vi.unstubAllEnvs());

const build = (o: Partial<Parameters<typeof buildWeeklyEmail>[0]> = {}) =>
  buildWeeklyEmail({
    brand: { id: BRAND, name: "Corner Bakery" },
    batch: { id: "33333333-3333-4333-8333-333333333333", weekStart: "2026-10-19" },
    posts,
    lastWeekStart: "2026-10-12",
    variant: "normal",
    now: NOW,
    ...o,
  });

describe("the email summary line (Req 21)", () => {
  it("reads like a sentence and leaves out parts with nothing to say", () => {
    expect(emailSummaryLine({ posts: 9, clicks: 23, minutesSaved: 180 })).toBe("Last 4 weeks: 9 posts shared, at least 23 clicks, about 3 hours saved.");
    expect(emailSummaryLine({ posts: 1, clicks: 1, minutesSaved: 20 })).toBe("Last 4 weeks: 1 post shared, at least 1 click, about 20 minutes saved.");
    expect(emailSummaryLine({ posts: 2, clicks: 0, minutesSaved: null })).toBe("Last 4 weeks: 2 posts shared.");
    expect(emailSummaryLine({ posts: 0, clicks: 4, minutesSaved: null })).toBe("Last 4 weeks: at least 4 clicks.");
  });

  it("loadEmailSummary: counts the last 4 weeks for this brand only, and is null with no data", async () => {
    const a = await seedWeeklyBrand(db, { name: "A", timezone: "Europe/London" });
    const other = await seedWeeklyBrand(db, { name: "B", timezone: "Europe/London" });
    expect(await loadEmailSummary(a.brandId, NOW)).toBeNull();
    await setMinutes(db, a.brandId, 20);
    await seedResultPost(db, a.brandId, a.userId, { postedAt: "2026-10-10T10:00:00Z", shares: ["2026-10-10T10:05:00Z"], clicks: ["2026-10-11T10:00:00Z"] }); // once
    await seedResultPost(db, a.brandId, a.userId, { shares: ["2026-10-15T10:00:00Z"] });
    await seedResultPost(db, a.brandId, a.userId, { postedAt: "2026-09-01T10:00:00Z", clicks: ["2026-09-02T10:00:00Z"] }); // older than 4 weeks
    await seedResultPost(db, other.brandId, other.userId, { postedAt: "2026-10-10T10:00:00Z", clicks: ["2026-10-11T10:00:00Z", "2026-10-12T10:00:00Z"] });
    expect(await loadEmailSummary(a.brandId, NOW)).toEqual({ posts: 2, clicks: 1, minutesSaved: 40 });
    await setMinutes(db, a.brandId, null);
    expect(await loadEmailSummary(a.brandId, NOW)).toEqual({ posts: 2, clicks: 1, minutesSaved: null });
    // A click alone is enough data.
    const clickOnly = await seedWeeklyBrand(db, { name: "C" });
    await seedResultPost(db, clickOnly.brandId, clickOnly.userId, { clicks: ["2026-10-18T10:00:00Z"] });
    expect(await loadEmailSummary(clickOnly.brandId, NOW)).toEqual({ posts: 0, clicks: 1, minutesSaved: null });
  });

  it("is in the email above the footer, with the not-measured line, in HTML and text; the check-in row stays", async () => {
    const m = await build({ summary: { posts: 9, clicks: 23, minutesSaved: 180 } });
    const line = "Last 4 weeks: 9 posts shared, at least 23 clicks, about 3 hours saved.";
    expect(m.html).toContain(line);
    expect(m.html).toContain(NOT_MEASURED);
    expect(m.text).toContain(line);
    expect(m.text).toContain(NOT_MEASURED);
    expect(m.html.indexOf(line)).toBeGreaterThan(m.html.indexOf("bring enquiries"));
    expect(m.html.indexOf(NOT_MEASURED)).toBeLessThan(m.html.indexOf("You get this email because"));
    expect(m.text.indexOf(NOT_MEASURED)).toBeLessThan(m.text.indexOf("Pause for 2 weeks"));
    expect(m.html).toContain("A few"); // the check-in row is still there
    expect(lintEmailHtml(m.html)).toEqual([]);
  });

  it("is left out when there is no data, and the HTML still passes the lint", async () => {
    for (const summary of [undefined, null]) {
      const m = await build({ summary });
      expect(m.html).not.toContain("Last 4 weeks");
      expect(m.html).not.toContain(NOT_MEASURED);
      expect(m.text).not.toContain("Last 4 weeks");
      expect(lintEmailHtml(m.html)).toEqual([]);
    }
  });

  it("the sender adds it only for a brand with data (end to end)", async () => {
    const withData = await seedWeeklyBrand(db, { name: "Data Bakery", photos: 1, storage: store.storage });
    await setMinutes(db, withData.brandId, 30);
    // The sender uses the real clock for the 4-week window, so seed relative to it.
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    await seedResultPost(db, withData.brandId, withData.userId, { postedAt: ago(3), clicks: [ago(2), ago(1)] });
    const without = await seedWeeklyBrand(db, { name: "Fresh Bakery", photos: 1, storage: store.storage });
    const now = new Date("2026-12-21T08:00:00Z");
    for (const brandId of [withData.brandId, without.brandId]) {
      const res = await generateWeek({ brandId, weekStart: "2026-12-21", trigger: "cron" }, { now, storage: store.storage });
      expect(res.status).toBe("ready");
    }
    const mails = (await listOutbox(500)).filter((m) => m.kind === "weekly");
    const mailFor = (brandId: string) => mails.find((m) => m.brandId === brandId)!;
    const yes = mailFor(withData.brandId);
    expect(yes.html).toContain("Last 4 weeks: 1 post shared, at least 2 clicks, about 30 minutes saved.");
    expect(yes.text).toContain(NOT_MEASURED);
    expect(lintEmailHtml(yes.html)).toEqual([]);
    const no = mailFor(without.brandId);
    expect(no.html).not.toContain("Last 4 weeks");
    expect(no.text).not.toContain(NOT_MEASURED);
  }, 120_000);
});
