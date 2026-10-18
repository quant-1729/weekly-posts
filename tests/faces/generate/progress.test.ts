// Live progress of the Face steps (docs/14-firebase-plan.md test 5). Fixtures only: no network, no AI, no Firestore.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/ai/client";
import type { MockDb } from "@/lib/db/mock";
import { stepEstimateUsd } from "@/lib/faces/generate/estimate";
import { FaceGenError } from "@/lib/faces/generate/errors";
import { BUSY_RETRY_PAUSE_MS, approveSheet, makeOptions, makePoses, makeSheet, setMaster, type FaceGenDeps, type FaceProgress } from "@/lib/faces/generate/steps";
import { createDraftFace, getFace } from "@/lib/faces/service";
import { FACE_OPTIONS, TRIES_PER_POSE } from "@/lib/faces/types";
import { clearLiveWritesForTests, liveWritesForTests, resetLiveForTests } from "@/lib/realtime";
import { setStorageForTests, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { closeDb, makeOwner, openDb, type Owner } from "../../helpers/details";
import { fakeCheck, fakeImage } from "./fixtures";

let db: MockDb;
let a: Owner;
let storage: Storage;
let dir: string;

beforeAll(async () => {
  db = await openDb();
  dir = mkdtempSync(path.join(os.tmpdir(), "pm-faceprogress-"));
  storage = createMockStorage(dir);
  setStorageForTests(storage);
  a = await makeOwner(db, { name: "Corner Bakery" });
});
afterAll(async () => {
  setStorageForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await closeDb(db);
});
beforeEach(() => {
  clearLiveWritesForTests();
  resetLiveForTests();
});
afterEach(() => vi.restoreAllMocks());

const newFace = () => createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Mia", description: "A friendly baker in a green apron", style: "flat" });
const err429 = () => new AiError("call_failed", '{"error":{"code":429,"message":"Resource exhausted.","status":"RESOURCE_EXHAUSTED"}}');
const caught = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return null;
};

/** A spy for `deps.progress` that also records the order against other calls. */
function spy() {
  const events: FaceProgress[] = [];
  const order: string[] = [];
  const progress = async (p: FaceProgress) => {
    events.push(p);
    order.push(p.phase ?? p.state);
  };
  return { events, order, progress };
}

/** A face with a master and an approved sheet, made with fixtures and no progress spy. */
async function readyFace() {
  const face = await newFace();
  const base = { userId: a.userId, brandId: a.brandId, faceId: face.id };
  const img = fakeImage();
  await makeOptions({ ...base, approvedEstimateUsd: stepEstimateUsd("options"), deps: { storage, image: img.fn } });
  await setMaster({ ...base, optionIndex: 0, deps: { storage } });
  await makeSheet({ ...base, approvedEstimateUsd: stepEstimateUsd("sheet"), deps: { storage, image: img.fn } });
  await approveSheet({ ...base, deps: { storage } });
  return { face, base };
}

describe("options progress", () => {
  it("emits 0 to 4 done while running, then done", async () => {
    const face = await newFace();
    const p = spy();
    const r = await makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: stepEstimateUsd("options"), deps: { storage, image: fakeImage().fn, progress: p.progress } });
    expect(r.options).toHaveLength(FACE_OPTIONS);
    expect(p.events.every((e) => e.step === "options" && e.total === FACE_OPTIONS)).toBe(true);
    expect(p.events.filter((e) => e.state === "running").map((e) => e.done)).toEqual([0, 1, 2, 3, 4]);
    expect(p.events.at(-1)).toMatchObject({ state: "done", done: FACE_OPTIONS, total: FACE_OPTIONS });
  });

  it("a 429 emits waiting before the pause, and the options still come out right", async () => {
    const face = await newFace();
    const p = spy();
    const inner = fakeImage();
    let calls = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sleeps: number[] = [];
    const r = await makeOptions({
      userId: a.userId,
      brandId: a.brandId,
      faceId: face.id,
      approvedEstimateUsd: stepEstimateUsd("options"),
      deps: {
        storage,
        progress: p.progress,
        sleep: async (ms) => {
          p.order.push("sleep");
          sleeps.push(ms);
        },
        image: async (req) => {
          if (++calls === 2) throw err429();
          return inner.fn(req);
        },
      },
    });
    expect(r.options).toHaveLength(FACE_OPTIONS);
    expect(sleeps).toEqual([BUSY_RETRY_PAUSE_MS]);
    const at = p.order.indexOf("sleep");
    expect(p.order[at - 1]).toBe("waiting");
    expect(p.events.filter((e) => e.phase === "waiting")).toHaveLength(1);
    // The wait happened while the second option was being made.
    expect(p.events.find((e) => e.phase === "waiting")).toMatchObject({ step: "options", state: "running", done: 1 });
  });

  it("every picture refused: failed is the last word and the error is the same", async () => {
    const face = await newFace();
    const p = spy();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const e = await caught(
      makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: stepEstimateUsd("options"), deps: { storage, progress: p.progress, sleep: async () => undefined, image: async () => { throw err429(); } } }),
    );
    expect((e as FaceGenError).code).toBe("busy");
    expect(p.events.at(-1)).toMatchObject({ step: "options", state: "failed" });
  });
});

describe("sheet progress", () => {
  it("emits running, then done", async () => {
    const face = await newFace();
    const base = { userId: a.userId, brandId: a.brandId, faceId: face.id };
    const img = fakeImage();
    await makeOptions({ ...base, approvedEstimateUsd: stepEstimateUsd("options"), deps: { storage, image: img.fn } });
    await setMaster({ ...base, optionIndex: 0, deps: { storage } });
    const p = spy();
    await makeSheet({ ...base, approvedEstimateUsd: stepEstimateUsd("sheet"), deps: { storage, image: img.fn, progress: p.progress } });
    expect(p.events.map((e) => [e.step, e.state])).toEqual([["sheet", "running"], ["sheet", "done"]]);
  });

  it("emits failed when the picture cannot be made", async () => {
    const face = await newFace();
    const base = { userId: a.userId, brandId: a.brandId, faceId: face.id };
    await makeOptions({ ...base, approvedEstimateUsd: stepEstimateUsd("options"), deps: { storage, image: fakeImage().fn } });
    await setMaster({ ...base, optionIndex: 0, deps: { storage } });
    const p = spy();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const e = await caught(makeSheet({ ...base, approvedEstimateUsd: 1, deps: { storage, progress: p.progress, image: async () => { throw new Error("model said no"); } } }));
    expect((e as FaceGenError).code).toBe("image_failed");
    expect(p.events.map((x) => x.state)).toEqual(["running", "failed"]);
  });
});

describe("pose progress", () => {
  it("per try: drawing, checking, cutting; then saved with done 1; then done", async () => {
    const { base } = await readyFace();
    const p = spy();
    const img = fakeImage();
    await makePoses({ ...base, poses: ["wave"], approvedEstimateUsd: stepEstimateUsd("poses", 1), deps: { storage, image: img.fn, check: fakeCheck(img).fn, progress: p.progress } });
    const seq = p.events.filter((e) => e.phase).map((e) => `${e.tryNo ?? "-"}:${e.phase}`);
    expect(seq).toEqual(["1:drawing", "1:checking", "1:cutting", "2:drawing", "2:checking", "2:cutting", "-:saved"]);
    expect(p.events.filter((e) => e.phase && e.phase !== "saved").every((e) => e.pose === "wave" && e.tries === TRIES_PER_POSE && e.done === 0 && e.total === 1)).toBe(true);
    expect(p.events.find((e) => e.phase === "saved")).toMatchObject({ step: "poses", state: "running", pose: "wave", done: 1, total: 1 });
    expect(p.events.at(-1)).toMatchObject({ step: "poses", state: "done", done: 1, total: 1 });
  });

  it("checking is announced before the check runs, and cutting before the cutout", async () => {
    const { base } = await readyFace();
    const p = spy();
    const img = fakeImage();
    const real = fakeCheck(img);
    await makePoses({
      ...base,
      poses: ["wave"],
      approvedEstimateUsd: stepEstimateUsd("poses", 1),
      deps: {
        storage,
        image: img.fn,
        progress: p.progress,
        check: async (x) => {
          p.order.push("check-call");
          return real.fn(x);
        },
        cutout: async (png, mode) => {
          p.order.push("cutout-call");
          return (await import("@/lib/faces/generate/cutout")).cutout(png, mode);
        },
      },
    });
    const first = p.order.slice(0, 6);
    expect(first).toEqual(["running", "drawing", "checking", "check-call", "cutting", "cutout-call"]);
  });

  it("two poses count up: saved with done 1, then 2", async () => {
    const { base } = await readyFace();
    const p = spy();
    const img = fakeImage();
    await makePoses({ ...base, poses: ["wave", "talk"], approvedEstimateUsd: stepEstimateUsd("poses", 2), deps: { storage, image: img.fn, check: fakeCheck(img).fn, progress: p.progress } });
    expect(p.events.filter((e) => e.phase === "saved").map((e) => [e.pose, e.done, e.total])).toEqual([["wave", 1, 2], ["talk", 2, 2]]);
    expect(p.events.at(-1)).toMatchObject({ state: "done", done: 2, total: 2 });
  });

  it("a 429 on a try emits waiting for that pose and try, before the pause", async () => {
    const { base } = await readyFace();
    const p = spy();
    const img = fakeImage();
    let n = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await makePoses({
      ...base,
      poses: ["wave"],
      approvedEstimateUsd: stepEstimateUsd("poses", 1),
      deps: {
        storage,
        check: fakeCheck(img).fn,
        progress: p.progress,
        sleep: async () => void p.order.push("sleep"),
        image: async (req) => {
          if (++n === 1) throw err429();
          return img.fn(req);
        },
      },
    });
    const w = p.events.find((e) => e.phase === "waiting");
    expect(w).toMatchObject({ step: "poses", pose: "wave", tryNo: 1, tries: TRIES_PER_POSE, state: "running" });
    expect(p.order[p.order.indexOf("sleep") - 1]).toBe("waiting");
  });

  it("when no pose could be made the last word is failed", async () => {
    const { base } = await readyFace();
    const p = spy();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await makePoses({ ...base, poses: ["wave"], approvedEstimateUsd: stepEstimateUsd("poses", 1), deps: { storage, progress: p.progress, image: async () => { throw new Error("model said no"); } } });
    expect(r.saved).toHaveLength(0);
    expect(p.events.at(-1)).toMatchObject({ state: "failed", done: 0 });
  });
});

describe("progress never changes the result", () => {
  it("a progress function that throws changes neither the outcome nor the cost", async () => {
    const { base } = await readyFace();
    const img = fakeImage();
    const withSpy = await makePoses({ ...base, poses: ["wave"], approvedEstimateUsd: stepEstimateUsd("poses", 1), deps: { storage, image: img.fn, check: fakeCheck(img).fn } });
    const { base: base2 } = await readyFace();
    const img2 = fakeImage();
    const thrower = await makePoses({
      ...base2,
      poses: ["wave"],
      approvedEstimateUsd: stepEstimateUsd("poses", 1),
      deps: {
        storage,
        image: img2.fn,
        check: fakeCheck(img2).fn,
        progress: async () => {
          throw new Error("firestore is down");
        },
      },
    });
    expect(thrower.saved.map((s) => s.pose)).toEqual(withSpy.saved.map((s) => s.pose));
    expect(thrower.failed).toEqual(withSpy.failed);
    expect(thrower.costUsd).toBeCloseTo(withSpy.costUsd, 9);
    const row = await getFace(a.userId, a.brandId, base2.faceId);
    expect(row.createdCostUsd).toBeGreaterThan(0);
  });

  it("without a progress dep, the default writes the safe fields to brands/{brand}/live/face_{id}", async () => {
    const face = await newFace();
    const deps: Partial<FaceGenDeps> = { storage, image: fakeImage().fn };
    await makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: stepEstimateUsd("options"), deps });
    const writes = liveWritesForTests().filter((w) => w.kind === "face");
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes.map((w) => w.path))).toEqual(new Set([`brands/${a.brandId}/live/face_${face.id}`]));
    const last = writes.at(-1)!;
    expect(last.data).toEqual({ faceId: face.id, step: "options", state: "done", done: FACE_OPTIONS, total: FACE_OPTIONS });
    // seq only goes up
    expect(writes.map((w) => w.seq)).toEqual([...writes.map((w) => w.seq)].sort((x, y) => x - y));
  });
});
