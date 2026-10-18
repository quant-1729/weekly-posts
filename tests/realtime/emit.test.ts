import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// firebase-admin must never load in mock mode or under vitest: importing it would fail these tests.
vi.mock("firebase-admin/app", () => {
  throw new Error("firebase-admin/app was loaded");
});
vi.mock("firebase-admin/firestore", () => {
  throw new Error("firebase-admin/firestore was loaded");
});

import {
  clearLiveWritesForTests,
  emitFaceProgress,
  emitLive,
  emitQueueItem,
  emitQueueTouch,
  liveWritesForTests,
  resetLiveForTests,
  sanitize,
  setLiveSinkForTests,
  LIVE_TTL_MS,
} from "@/lib/realtime";

const BRAND = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const ITEM = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

beforeEach(() => {
  clearLiveWritesForTests();
  resetLiveForTests();
});
afterEach(() => {
  setLiveSinkForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const queueData = { itemId: ITEM, postId: "post-1", channel: "instagram", status: "published", mode: "publish", attempts: 1, slotAt: "2026-10-19T09:00:00.000Z" };

describe("the allow-list", () => {
  it("drops fields that are not on the list for the kind", () => {
    const clean = sanitize("queue", { ...queueData, lastError: "token expired for a@b.com", caption: "50% off", permalink: "https://instagram.com/p/x", email: "a@b.com", upiId: "me@upi" });
    expect(clean).toEqual(queueData);
    expect(Object.keys(clean)).not.toEqual(expect.arrayContaining(["lastError"]));
  });

  it("drops values of the wrong type or outside their set", () => {
    const clean = sanitize("queue", { ...queueData, status: "<script>", attempts: -1, slotAt: "not a date", channel: "tiktok", postId: "has space" });
    expect(clean).toEqual({ itemId: ITEM, mode: "publish" });
  });

  it("keeps only seq (added by the writer) for queue_touch", () => {
    expect(sanitize("queue_touch", { caption: "x", status: "failed" })).toEqual({});
  });

  it("covers the face, research and weekly kinds", () => {
    expect(sanitize("face", { faceId: "f1", step: "poses", state: "running", pose: "waving", tryNo: 1, tries: 2, phase: "checking", done: 2, total: 7, prompt: "a woman" })).toEqual({
      faceId: "f1", step: "poses", state: "running", pose: "waving", tryNo: 1, tries: 2, phase: "checking", done: 2, total: 7,
    });
    expect(sanitize("research", { runId: "r1", state: "capped", cards: 4, note: "x" })).toEqual({ runId: "r1", state: "capped", cards: 4 });
    expect(sanitize("weekly", { weekStart: "2026-10-19", state: "ready", title: "x" })).toEqual({ weekStart: "2026-10-19", state: "ready" });
    expect(sanitize("weekly", { weekStart: "next week", state: "ready" })).toEqual({ state: "ready" });
  });

  it("writes only allow-listed fields through emitLive", async () => {
    await emitLive(BRAND, `q_${ITEM}`, "queue", { ...queueData, lastError: "boom", caption: "hello", permalink: "https://x.test" });
    const [w] = liveWritesForTests();
    expect(Object.keys(w.data).sort()).toEqual(Object.keys(queueData).sort());
  });
});

describe("emitLive", () => {
  it("writes to brands/{brandId}/live/{docId} with version, seq and kind", async () => {
    await emitLive(BRAND, `q_${ITEM}`, "queue", queueData);
    const writes = liveWritesForTests();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ path: `brands/${BRAND}/live/q_${ITEM}`, brandId: BRAND, docId: `q_${ITEM}`, kind: "queue", v: 1 });
  });

  it("makes seq rise for each write", async () => {
    await emitLive(BRAND, "queue_touch", "queue_touch", {});
    await emitLive(BRAND, "queue_touch", "queue_touch", {});
    const [a, b] = liveWritesForTests();
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it("refuses a brand id that is not a uuid, and a bad doc id or kind", async () => {
    await emitLive("brands/evil", "queue_touch", "queue_touch", {});
    await emitLive("../" + BRAND, "queue_touch", "queue_touch", {});
    await emitLive(BRAND, "a/b", "queue_touch", {});
    await emitLive(BRAND, "Q_UPPER", "queue_touch", {});
    await emitLive(BRAND, "", "queue_touch", {});
    await emitLive(BRAND, "x".repeat(81), "queue_touch", {});
    await emitLive(BRAND, "q_1", "payment" as never, {});
    expect(liveWritesForTests()).toHaveLength(0);
  });

  it("sets expireAt to now plus the kind's TTL, or the TTL given", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T09:00:00.000Z"));
    const now = Date.now();
    await emitLive(BRAND, `q_${ITEM}`, "queue", queueData);
    await emitLive(BRAND, "face_f1", "face", { faceId: "f1", step: "poses", state: "running", done: 0, total: 7 });
    await emitLive(BRAND, "queue_touch", "queue_touch", {}, 5000);
    const [q, f, t] = liveWritesForTests();
    expect(q.expireAtMs).toBe(now + 24 * 3600_000);
    expect(f.expireAtMs).toBe(now + 2 * 3600_000);
    expect(f.expireAtMs).toBe(now + LIVE_TTL_MS.face);
    expect(t.expireAtMs).toBe(now + 5000);
  });

  it("does not throw when the sink throws, and logs once a minute at most", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setLiveSinkForTests(() => {
      throw new Error("firestore down");
    });
    await expect(emitLive(BRAND, "queue_touch", "queue_touch", {})).resolves.toBeUndefined();
    await expect(emitLive(BRAND, "queue_touch", "queue_touch", {})).resolves.toBeUndefined();
    await expect(emitLive(BRAND, "queue_touch", "queue_touch", {})).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toBe("[live] write failed");
  });

  it("does not throw when the sink rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setLiveSinkForTests(() => Promise.reject(new Error("nope")));
    await expect(emitLive(BRAND, "queue_touch", "queue_touch", {})).resolves.toBeUndefined();
  });

  it("logs again after a minute", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setLiveSinkForTests(() => Promise.reject(new Error("nope")));
    await emitLive(BRAND, "queue_touch", "queue_touch", {});
    vi.setSystemTime(Date.now() + 61_000);
    await emitLive(BRAND, "queue_touch", "queue_touch", {});
    expect(err).toHaveBeenCalledTimes(2);
  });

  it("gives up on a slow sink at 1.5 s", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let finished = false;
    setLiveSinkForTests(() => new Promise<void>((resolve) => setTimeout(() => { finished = true; resolve(); }, 10_000)));
    let done = false;
    const p = emitLive(BRAND, "queue_touch", "queue_touch", {}).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1400);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(done).toBe(true);
    await p;
    expect(finished).toBe(false);
    expect(err).toHaveBeenCalledWith("[live] write failed", expect.stringContaining("1500"));
  });

  it("never loads firebase-admin in mock mode", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await emitLive(BRAND, "queue_touch", "queue_touch", {});
    expect(liveWritesForTests()).toHaveLength(1);
    expect(err).not.toHaveBeenCalled();
  });

  it("helpers write the documents the plan names", async () => {
    await emitQueueItem(BRAND, { id: ITEM, postId: "post-1", channel: "facebook", status: "publishing", mode: "publish", attempts: 0, slotAt: "2026-10-19T09:00:00.000Z" });
    await emitQueueTouch(BRAND);
    await emitFaceProgress(BRAND, { faceId: "f1", step: "poses", state: "running", pose: "waving", tryNo: 1, tries: 2, phase: "drawing", done: 0, total: 7 });
    const [q, t, f] = liveWritesForTests();
    expect(q).toMatchObject({ docId: `q_${ITEM}`, kind: "queue", data: { itemId: ITEM, status: "publishing" } });
    expect(t).toMatchObject({ docId: "queue_touch", kind: "queue_touch", data: {} });
    expect(f).toMatchObject({ docId: "face_f1", kind: "face", data: { phase: "drawing", pose: "waving" } });
  });
});
