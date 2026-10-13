import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendWeeklyEmail: vi.fn(),
  sendLateNotice: vi.fn(),
}));
vi.mock("@/lib/email/weekly", () => mocks);

import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { generateWeek } from "@/lib/weekly/generate";
import { seedWeeklyBrand, tempStorage } from "./helpers";

const WEEK = "2026-12-21";
const NOW = new Date("2026-12-21T08:00:00Z");

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
beforeEach(() => {
  mocks.sendWeeklyEmail.mockReset();
  mocks.sendLateNotice.mockReset();
});

const brand = () => seedWeeklyBrand(db, { photos: 1, storage: store.storage });
const run = (brandId: string, extra: Parameters<typeof generateWeek>[1] = {}) =>
  generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage, ...extra });
const failing = { fixtures: { weekly: () => { throw new Error("model is down"); } } };
const status = async (batchId: string) =>
  (await db.withAdmin((tx) => tx.query<{ status: string }>("select status::text as status from public.weekly_batches where id = $1", [batchId])))[0].status;

describe("V-15 generation hook", () => {
  it("emails the week once the batch is ready", async () => {
    mocks.sendWeeklyEmail.mockResolvedValue({ status: "sent" });
    const { brandId } = await brand();
    const res = await run(brandId);
    expect(res.status).toBe("ready");
    expect(mocks.sendWeeklyEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendWeeklyEmail).toHaveBeenCalledWith(res.batchId);
    expect(mocks.sendLateNotice).not.toHaveBeenCalled();
  });

  it("does not email a batch that failed", async () => {
    const { brandId } = await brand();
    expect((await run(brandId, failing)).status).toBe("failed");
    expect(mocks.sendWeeklyEmail).not.toHaveBeenCalled();
    expect(mocks.sendLateNotice).not.toHaveBeenCalled(); // retries are left
  });

  it("an email that throws does not fail the generation", async () => {
    mocks.sendWeeklyEmail.mockRejectedValue(new Error("mail server down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { brandId } = await brand();
      const res = await run(brandId);
      expect(res.status).toBe("ready");
      expect(res.status === "ready" && res.posts).toHaveLength(4);
      expect(await status(res.batchId!)).toBe("ready");
      expect(error.mock.calls.flat().join(" ")).toContain("mail server down");
    } finally {
      error.mockRestore();
    }
  });

  it("sends the late notice only after the last automatic retry", async () => {
    mocks.sendLateNotice.mockResolvedValue({ status: "sent" });
    const { brandId } = await brand();
    await run(brandId, failing);
    await run(brandId, failing);
    expect(mocks.sendLateNotice).not.toHaveBeenCalled();
    const third = await run(brandId, failing);
    expect(third.status).toBe("failed");
    expect(mocks.sendLateNotice).toHaveBeenCalledTimes(1);
    expect(mocks.sendLateNotice).toHaveBeenCalledWith(third.batchId);
  });

  it("a late notice that throws does not change the failed result", async () => {
    mocks.sendLateNotice.mockRejectedValue(new Error("mail server down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { brandId } = await brand();
      await run(brandId, failing);
      await run(brandId, failing);
      const third = await run(brandId, failing);
      expect(third).toMatchObject({ status: "failed", error: expect.stringContaining("model is down") });
      expect(await status(third.batchId!)).toBe("failed");
    } finally {
      error.mockRestore();
    }
  });

  it("a failed regeneration that kept the old drafts sends no late notice", async () => {
    mocks.sendWeeklyEmail.mockResolvedValue({ status: "sent" });
    const { brandId, userId } = await brand();
    expect((await run(brandId)).status).toBe("ready");
    mocks.sendLateNotice.mockReset();
    for (let i = 0; i < 3; i++) {
      const r = await generateWeek({ brandId, weekStart: WEEK, trigger: "button", userId }, { now: NOW, storage: store.storage, ...failing });
      expect(r).toMatchObject({ status: "failed", keptPrevious: true });
    }
    expect(mocks.sendLateNotice).not.toHaveBeenCalled();
  });
});
