import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { listOutbox } from "@/lib/email/outbox";
import { saveQueueSettings } from "@/lib/queue";
import { sendPostingReminders } from "@/lib/reminders/posting";
import { freshWeek, setPost } from "../approvals/helpers";
import { tempStorage } from "../weekly/helpers";

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

describe("S-6: the queue's pause switch also stops the posting reminders", () => {
  it("no reminder while the queue is paused; the one reminder comes when it is switched back on", async () => {
    const w = await freshWeek(db, store.storage);
    const approvedAt = new Date("2026-12-22T09:00:00Z");
    await setPost(db, w.postIds[0], "status = 'approved', approved_at = $2::timestamptz", [approvedAt.toISOString()]);
    await saveQueueSettings(w.userId, w.brandId, { paused: true });
    const later = new Date(approvedAt.getTime() + 80 * 3600 * 1000);
    const mine = async () => (await listOutbox(1000)).filter((m) => m.brandId === w.brandId && m.kind === "reminder");

    const paused = await sendPostingReminders({ now: later });
    expect(paused.items.filter((i) => i.brandId === w.brandId)).toEqual([]);
    expect(await mine()).toHaveLength(0);

    await saveQueueSettings(w.userId, w.brandId, { paused: false });
    const resumed = await sendPostingReminders({ now: later });
    expect(resumed.items.filter((i) => i.brandId === w.brandId)).toMatchObject([{ outcome: "sent" }]);
    expect(await mine()).toHaveLength(1);
  });
});
