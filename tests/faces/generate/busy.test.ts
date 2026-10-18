// Rate limits (429) and the one-line log of a failed image call. Fixtures only: no network, no AI.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/ai/client";
import type { MockDb } from "@/lib/db/mock";
import { FaceError } from "@/lib/faces/errors";
import { stepEstimateUsd } from "@/lib/faces/generate/estimate";
import { FaceGenError, isRateLimited } from "@/lib/faces/generate/errors";
import { makeOptions, makeSheet, type FaceGenDeps } from "@/lib/faces/generate/steps";
import { createDraftFace } from "@/lib/faces/service";
import { FACE_OPTIONS } from "@/lib/faces/types";
import { describeFaceError } from "@/lib/faces/describe";
import { s } from "@/lib/i18n/strings";
import { setStorageForTests, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { closeDb, makeOwner, openDb, type Owner } from "../../helpers/details";
import { fakeImage } from "./fixtures";

let db: MockDb;
let a: Owner;
let storage: Storage;
let dir: string;

const SECRET_DESCRIPTION = "A smiling pelican with a purple scarf";

beforeAll(async () => {
  db = await openDb();
  dir = mkdtempSync(path.join(os.tmpdir(), "pm-facebusy-"));
  storage = createMockStorage(dir);
  setStorageForTests(storage);
  a = await makeOwner(db, { name: "Corner Bakery" });
});
afterAll(async () => {
  setStorageForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await closeDb(db);
});
afterEach(() => vi.restoreAllMocks());

const newFace = (description = SECRET_DESCRIPTION) => createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Mia", description, style: "flat" });
const err429 = () => new AiError("call_failed", '{"error":{"code":429,"message":"Resource exhausted.","status":"RESOURCE_EXHAUSTED"}}');
const caught = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return null;
};

describe("429 from the image service", () => {
  it("is recognised from the error message", () => {
    expect(isRateLimited(err429())).toBe(true);
    expect(isRateLimited(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimited(new Error("Quota exceeded for aiplatform.googleapis.com"))).toBe(true);
    expect(isRateLimited(new FaceGenError("busy"))).toBe(true);
    expect(isRateLimited(new Error("model said no"))).toBe(false);
    expect(isRateLimited(new FaceGenError("image_blocked", "SAFETY"))).toBe(false);
  });

  it("has the owner-facing words", () => {
    const m = describeFaceError(new FaceGenError("busy"));
    expect(m.code).toBe("busy");
    expect(m.message).toBe("Google is busy right now (too many pictures at once). Wait a minute and try again — nothing was charged.");
    expect(s.faces.generate.errors.busy).toBe(m.message);
  });

  it("options: makes the pictures one at a time, retries a 429 once after a pause, and charges only for pictures made", async () => {
    const face = await newFace();
    const inner = fakeImage();
    let calls = 0;
    let running = 0;
    let maxRunning = 0;
    const sleeps: number[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps: Partial<FaceGenDeps> = {
      storage,
      sleep: async (ms) => void sleeps.push(ms),
      image: async (req) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        try {
          calls++;
          if (calls === 2) throw err429(); // the second picture is rate-limited once
          return await inner.fn(req);
        } finally {
          running--;
        }
      },
    };
    const r = await makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: stepEstimateUsd("options"), deps });
    expect(r.options).toHaveLength(FACE_OPTIONS);
    expect(r.failed).toBe(0);
    expect(maxRunning).toBe(1);
    expect(calls).toBe(FACE_OPTIONS + 1);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it("options: still busy after the retry gives 'busy', with nothing charged", async () => {
    const face = await newFace();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let calls = 0;
    const e = await caught(
      makeOptions({
        userId: a.userId,
        brandId: a.brandId,
        faceId: face.id,
        approvedEstimateUsd: stepEstimateUsd("options"),
        deps: {
          storage,
          sleep: async () => undefined,
          image: async () => {
            calls++;
            throw err429();
          },
        },
      }),
    );
    expect(e).toBeInstanceOf(FaceGenError);
    expect((e as FaceGenError).code).toBe("busy");
    expect(calls).toBe(FACE_OPTIONS * 2); // each picture tried twice
    const cost = await db.withAdmin((tx) => tx.query<{ c: string }>("select created_cost_usd as c from public.brand_faces where id = $1", [face.id]));
    expect(Number(cost[0].c)).toBe(0);
  });

  it("sheet: a 429 that stays gives 'busy'", async () => {
    const face = await newFace();
    // A master is needed first: use the fixture image for the options and keep the first.
    const inner = fakeImage();
    const base = { userId: a.userId, brandId: a.brandId, faceId: face.id };
    await makeOptions({ ...base, approvedEstimateUsd: stepEstimateUsd("options"), deps: { storage, image: inner.fn } });
    const { setMaster } = await import("@/lib/faces/generate/steps");
    await setMaster({ ...base, optionIndex: 0, deps: { storage } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const e = await caught(makeSheet({ ...base, approvedEstimateUsd: 1, deps: { storage, sleep: async () => undefined, image: async () => { throw err429(); } } }));
    expect((e as FaceGenError).code).toBe("busy");
  });
});

describe("the log line of a failed image call", () => {
  it("has the step, the code and a short reason, and never the description", async () => {
    const face = await newFace();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let n = 0;
    const e = await caught(
      makeOptions({
        userId: a.userId,
        brandId: a.brandId,
        faceId: face.id,
        approvedEstimateUsd: stepEstimateUsd("options"),
        deps: {
          storage,
          sleep: async () => undefined,
          image: async () => {
            n++;
            if (n % 2 === 1) throw new FaceGenError("image_blocked", "IMAGE_SAFETY");
            throw new AiError("call_failed", "gemini-x returned no image (finish reason: OTHER)");
          },
        },
      }),
    );
    expect(e).toBeInstanceOf(FaceGenError);
    expect((e as FaceGenError).code).toBe("image_blocked");
    const lines = warn.mock.calls.filter((c) => c[0] === "[faces] image call failed");
    expect(lines).toHaveLength(FACE_OPTIONS);
    expect(lines[0][1]).toEqual({ step: "options", code: "image_blocked", reason: "IMAGE_SAFETY" });
    expect(lines[1][1]).toEqual({ step: "options", code: "call_failed", reason: "gemini-x returned no image (finish reason: OTHER)" });
    const all = JSON.stringify(warn.mock.calls);
    expect(all).not.toContain("pelican");
    expect(all).not.toContain(SECRET_DESCRIPTION);
  });

  it("logs a 429 with its reason so the cause is visible", async () => {
    const face = await newFace();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await caught(
      makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: stepEstimateUsd("options"), deps: { storage, sleep: async () => undefined, image: async () => { throw err429(); } } }),
    );
    const first = warn.mock.calls.find((c) => c[0] === "[faces] image call failed")![1] as { step: string; code: string; reason: string };
    expect(first.step).toBe("options");
    expect(first.code).toBe("call_failed");
    expect(first.reason).toMatch(/429|RESOURCE_EXHAUSTED/);
    expect(first.reason.length).toBeLessThanOrEqual(160);
  });
});

describe("a copied character is refused before anything is paid for", () => {
  it("makeOptions refuses a franchise description with 'copied_character' and calls no image", async () => {
    const face = await newFace();
    await db.withAdmin((tx) => tx.query("update public.brand_faces set description = $2 where id = $1", [face.id, "inspired from animation style of Dora the explorer"]));
    const img = fakeImage();
    const e = await caught(makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: 5, deps: { storage, image: img.fn } }));
    expect(e).toBeInstanceOf(FaceError);
    expect((e as FaceError).code).toBe("copied_character");
    expect(img.requests).toHaveLength(0);
  });
});

describe("the Face card carries the suggestions", () => {
  it("loads them from what setup stored about the brand", async () => {
    const { loadFaceCard } = await import("@/lib/faces/card");
    await db.withAdmin((tx) =>
      tx.query(`update public.brand_memory set category = 'Bakery', colors = '{"primary":"#0E8C8C","accent":"#FF6F61"}'::jsonb where brand_id = $1`, [a.brandId]),
    );
    const card = await loadFaceCard(a.userId, a.brandId);
    expect(card.suggestions.illustrated).toHaveLength(3);
    expect(card.suggestions.illustrated[0]).toContain("bread loaf");
    expect(card.suggestions.illustrated[0]).toContain("teal and coral");
    expect(card.suggestions.photoreal).toHaveLength(2);
  });
});
