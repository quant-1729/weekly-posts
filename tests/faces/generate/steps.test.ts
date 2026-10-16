import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FACE_POSE_LINES } from "@/lib/ai/prompts/faces";
import type { MockDb } from "@/lib/db/mock";
import { FaceError } from "@/lib/faces/errors";
import { FACE_CAP_USD, stepEstimateUsd, wholeFaceEstimateUsd } from "@/lib/faces/generate/estimate";
import { FaceGenError } from "@/lib/faces/generate/errors";
import { faceMasterRel } from "@/lib/faces/generate/paths";
import { approveSheet, makeOptions, makePoses, makeSheet, setMaster, type FaceGenDeps } from "@/lib/faces/generate/steps";
import { FACE_BUCKET, facePoseStored } from "@/lib/faces/paths";
import { createDraftFace, getFace, listPoses } from "@/lib/faces/service";
import { FACE_IMAGE_USD, FACE_OPTIONS, FACE_POSES, TRIES_PER_POSE, faceCreateEstimateUsd, type BrandFace } from "@/lib/faces/types";
import { setStorageForTests, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { closeDb, makeOwner, openDb, type Owner } from "../../helpers/details";
import { fakeCheck, fakeImage, sha } from "./fixtures";

let db: MockDb;
let a: Owner;
let storage: Storage;
let dir: string;

beforeAll(async () => {
  db = await openDb();
  dir = mkdtempSync(path.join(os.tmpdir(), "pm-facegen-"));
  storage = createMockStorage(dir);
  setStorageForTests(storage);
  a = await makeOwner(db, { name: "Corner Bakery" });
});
afterAll(async () => {
  setStorageForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await closeDb(db);
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof FaceGenError ? e.code : e instanceof FaceError ? `face:${e.code}` : `other:${String(e)}`;
  }
  return null;
};

const newFace = (o: Owner = a, description = "A friendly baker in a green apron", kind: "illustrated" | "photoreal" = "illustrated") =>
  createDraftFace(o.userId, o.brandId, { kind, name: "Mia", description, style: kind === "photoreal" ? "photo" : "flat" });

const usage = (brandId: string) =>
  db.withAdmin((tx) => tx.query<{ kind: string; usd: string }>("select kind::text as kind, usd from public.usage_events where brand_id = $1 order by created_at, id", [brandId]));

const deps = (img: ReturnType<typeof fakeImage>, check?: ReturnType<typeof fakeCheck>): Partial<FaceGenDeps> => ({
  image: img.fn,
  ...(check ? { check: check.fn } : {}),
  storage,
});

const costOf = async (faceId: string) => Number((await db.withAdmin((tx) => tx.query<{ c: string }>("select created_cost_usd as c from public.brand_faces where id = $1", [faceId])))[0].c);

describe("estimates", () => {
  it("prices the steps from the constants and stays near the whole-face figure", () => {
    expect(FACE_IMAGE_USD).toBe(0.067);
    expect(stepEstimateUsd("options")).toBe(0.27); // 4 x 0.067 = 0.268
    expect(stepEstimateUsd("sheet")).toBe(0.07);
    expect(stepEstimateUsd("poses")).toBe(0.98); // 7 x 2 x (0.067 + 0.003)
    expect(stepEstimateUsd("poses", 1)).toBe(0.14);
    expect(wholeFaceEstimateUsd()).toBe(1.32);
    expect(faceCreateEstimateUsd()).toBe(wholeFaceEstimateUsd()); // the price shown to the owner includes the vision checks
    expect(wholeFaceEstimateUsd()).toBeLessThan(FACE_CAP_USD);
  });
});

describe("the owner approves the price first", () => {
  it("refuses a step with no approval, a lower approval or a bad number, and makes no image", async () => {
    const face = await newFace();
    const img = fakeImage();
    for (const approved of [undefined, 0, NaN, -1, 0.2, "1.00"]) {
      expect(await code(makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: approved as number, deps: deps(img) }))).toBe("not_approved");
    }
    expect(img.requests).toHaveLength(0);
    expect(await usage(a.brandId)).toHaveLength(0);
    expect(await costOf(face.id)).toBe(0);
  });

  it("refuses a step that would take the face past its cap", async () => {
    const face = await newFace();
    await db.withAdmin((tx) => tx.query("update public.brand_faces set created_cost_usd = 1.8 where id = $1", [face.id]));
    const img = fakeImage();
    expect(await code(makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: 5, deps: deps(img) }))).toBe("over_cap");
    expect(img.requests).toHaveLength(0);
  });

  it("stops part-way at the approved amount and keeps what was made", async () => {
    const face = await newFace();
    const img = fakeImage({ usd: 0.15 }); // the model costs more than the estimate says
    const r = await makeOptions({ userId: a.userId, brandId: a.brandId, faceId: face.id, approvedEstimateUsd: stepEstimateUsd("options"), deps: deps(img) });
    expect(r.options.length).toBeLessThan(FACE_OPTIONS);
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.failed).toBe(FACE_OPTIONS - r.options.length);
    expect(r.costUsd).toBeCloseTo(0.15 * r.options.length, 6);
  });
});

describe("the whole flow with fixtures", () => {
  let face: BrandFace;
  const img = fakeImage();
  const owner = () => ({ userId: a.userId, brandId: a.brandId, faceId: face.id });

  it("makes the options as draft files, records usage and provenance", async () => {
    face = await newFace();
    const before = (await usage(a.brandId)).length;
    const r = await makeOptions({ ...owner(), approvedEstimateUsd: stepEstimateUsd("options"), deps: deps(img) });
    expect(r.options.map((o) => o.index)).toEqual([0, 1, 2, 3]);
    expect(r.failed).toBe(0);
    expect(r.costUsd).toBeCloseTo(FACE_OPTIONS * FACE_IMAGE_USD, 6);
    for (const o of r.options) expect(await storage.get(FACE_BUCKET, o.stored.slice(FACE_BUCKET.length + 1))).not.toBeNull();
    // No references for the options, adults only is the client's job; the four prompts differ.
    expect(img.requests.every((q) => !q.references || q.references.length === 0)).toBe(true);
    expect(new Set(img.requests.map((q) => q.prompt)).size).toBe(FACE_OPTIONS);
    const events = (await usage(a.brandId)).slice(before);
    expect(events).toHaveLength(FACE_OPTIONS);
    expect(events.every((e) => e.kind === "face_create" && Math.abs(Number(e.usd) - FACE_IMAGE_USD) < 1e-9)).toBe(true);
    expect(await costOf(face.id)).toBeCloseTo(FACE_OPTIONS * FACE_IMAGE_USD, 4);
    const f = await getFace(a.userId, a.brandId, face.id);
    const opts = f.provenance.options as Record<string, unknown>[];
    expect(opts).toHaveLength(FACE_OPTIONS);
    expect(opts[0]).toMatchObject({ model: "gemini-test-image", modelVersion: "test-001", c2pa: false, synthid: true, aiGenerated: true });
    expect(String(opts[0].promptHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(opts[0].createdAt)).toMatch(/^2\d{3}-/);
    expect(f.status).toBe("draft");
    expect(f.masterPath).toBeNull();
  });

  it("the sheet needs a master; the owner's pick freezes the unmodified option as the master", async () => {
    expect(await code(makeSheet({ ...owner(), approvedEstimateUsd: 1, deps: deps(img) }))).toBe("needs_master");
    expect(await code(setMaster({ ...owner(), optionIndex: 9, deps: deps(img) }))).toBe("no_option");
    const f = await setMaster({ ...owner(), optionIndex: 2, deps: deps(img) });
    expect(f.masterPath).toBe(`${FACE_BUCKET}/${faceMasterRel(a.brandId, face.id)}`);
    const master = await storage.get(FACE_BUCKET, faceMasterRel(a.brandId, face.id));
    const option = await storage.get(FACE_BUCKET, `${a.brandId}/faces/${face.id}/options/2.png`);
    expect(sha(Buffer.from(master!.bytes))).toBe(sha(Buffer.from(option!.bytes)));
    expect(f.provenance).toMatchObject({ model: "gemini-test-image", master: { option: 2 } });
  });

  it("makes the sheet from the master as the only reference, and it counts only once approved", async () => {
    expect(await code(makePoses({ ...owner(), approvedEstimateUsd: 2, deps: deps(img) }))).toBe("needs_sheet");
    const before = img.requests.length;
    const r = await makeSheet({ ...owner(), approvedEstimateUsd: stepEstimateUsd("sheet"), deps: deps(img) });
    expect(img.requests).toHaveLength(before + 1);
    expect(img.requests.at(-1)!.references).toHaveLength(1);
    expect(r.costUsd).toBeCloseTo(FACE_IMAGE_USD, 6);
    expect((await getFace(a.userId, a.brandId, face.id)).sheetPath).toBeNull();
    expect(await code(makePoses({ ...owner(), approvedEstimateUsd: 2, deps: deps(img) }))).toBe("needs_sheet");
    const f = await approveSheet({ ...owner(), deps: deps(img) });
    expect(f.sheetPath).toBe(`${FACE_BUCKET}/${a.brandId}/faces/${face.id}/sheet.png`);
    expect(f.provenance.sheet).toMatchObject({ aiGenerated: true });
    expect(f.provenance.sheetDraft).toBeUndefined();
  });

  it("makes the poses: tries with master + sheet, best passing try kept, the rest flagged, all unapproved", async () => {
    const before = (await usage(a.brandId)).length;
    const costBefore = await costOf(face.id);
    const requestsBefore = img.requests.length;
    const check = fakeCheck(
      img,
      (pose, tryNo) => {
        if (pose === "wave") return tryNo === 0 ? { hasText: true, notes: "letters on the shirt" } : {};
        if (pose === "talk") return tryNo === 0 ? { hasLogo: true, notes: "a logo on the apron" } : { sameCharacter: false, credentialCues: true, notes: "a white coat" };
        return {};
      },
      0.002,
    );
    const r = await makePoses({ ...owner(), approvedEstimateUsd: stepEstimateUsd("poses"), deps: deps(img, check) });

    expect(img.requests.length - requestsBefore).toBe(FACE_POSES.length * TRIES_PER_POSE);
    expect(img.requests.slice(requestsBefore).every((q) => q.references?.length === 2)).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.saved.map((s) => s.pose).sort()).toEqual([...FACE_POSES].sort());
    const byPose = Object.fromEntries(r.saved.map((s) => [s.pose, s]));
    expect(byPose.wave).toMatchObject({ passed: true });
    expect(byPose.wave.check.hasText).toBe(false); // the second try won
    expect(byPose.talk.passed).toBe(false); // none passed: the try with fewer problems (the logo one) is kept, with a note
    expect(byPose.talk.check.hasLogo).toBe(true);
    expect(byPose.talk.check.credentialCues).toBe(false);
    expect(byPose.talk.check.notes).toMatch(/^No try passed every check\. a logo on the apron/);
    expect(byPose.idle.passed).toBe(true);

    // Saved as unapproved transparent poses at the F-1 path with a size.
    const poses = await listPoses(a.userId, a.brandId, face.id);
    expect(poses).toHaveLength(FACE_POSES.length);
    for (const p of poses) {
      expect(p.approvedAt).toBeNull();
      expect(p.storagePath).toBe(facePoseStored(a.brandId, face.id, p.pose));
      expect(p.width).toBeGreaterThanOrEqual(256);
      expect(p.height).toBeGreaterThanOrEqual(256);
      const file = await storage.get(FACE_BUCKET, p.storagePath.slice(FACE_BUCKET.length + 1));
      const meta = await sharp(Buffer.from(file!.bytes)).metadata();
      expect(meta.hasAlpha).toBe(true);
      expect({ w: meta.width, h: meta.height }).toEqual({ w: p.width, h: p.height });
    }

    // One face_create event per image: the image price plus its check.
    const events = (await usage(a.brandId)).slice(before);
    expect(events).toHaveLength(FACE_POSES.length * TRIES_PER_POSE);
    expect(events.every((e) => e.kind === "face_create" && Math.abs(Number(e.usd) - (FACE_IMAGE_USD + 0.002)) < 1e-9)).toBe(true);
    expect(r.costUsd).toBeCloseTo(FACE_POSES.length * TRIES_PER_POSE * (FACE_IMAGE_USD + 0.002), 6);
    expect(await costOf(face.id)).toBeCloseTo(costBefore + r.costUsd, 3);
    expect(r.costUsd).toBeLessThanOrEqual(stepEstimateUsd("poses"));

    const f = await getFace(a.userId, a.brandId, face.id);
    expect(Object.keys(f.provenance.poses as object).sort()).toEqual([...FACE_POSES].sort());
    expect((f.provenance.poses as Record<string, { passed: boolean }>).talk.passed).toBe(false);
    expect(f.status).toBe("draft");
  });

  it("redoes one pose for its own price", async () => {
    const before = img.requests.length;
    const r = await makePoses({ ...owner(), poses: ["wave"], approvedEstimateUsd: stepEstimateUsd("poses", 1), deps: deps(img, fakeCheck(img)) });
    expect(r.saved.map((s) => s.pose)).toEqual(["wave"]);
    expect(img.requests.length - before).toBe(TRIES_PER_POSE);
    expect(await code(makePoses({ ...owner(), poses: ["wave", "talk"], approvedEstimateUsd: stepEstimateUsd("poses", 1), deps: deps(img, fakeCheck(img)) }))).toBe("not_approved");
  });

  it("a pose whose every try fails the cut-out is listed as failed, not saved", async () => {
    const g = await newFace();
    const ownerG = { userId: a.userId, brandId: a.brandId, faceId: g.id };
    const i2 = fakeImage();
    await makeOptions({ ...ownerG, approvedEstimateUsd: 2, deps: deps(i2) });
    await setMaster({ ...ownerG, optionIndex: 0, deps: deps(i2) });
    await makeSheet({ ...ownerG, approvedEstimateUsd: 2, deps: deps(i2) });
    await approveSheet({ ...ownerG, deps: deps(i2) });
    const r = await makePoses({
      ...ownerG,
      poses: ["idle"],
      approvedEstimateUsd: 2,
      deps: { ...deps(i2, fakeCheck(i2)), cutout: async () => { throw new FaceGenError("cutout_failed", "test"); } },
    });
    expect(r.saved).toEqual([]);
    expect(r.failed).toEqual([{ pose: "idle", reason: "cutout_failed" }]);
    expect(await listPoses(a.userId, a.brandId, g.id)).toHaveLength(0);
  });
});

describe("what never reaches a model", () => {
  it("keeps a payment ID typed into the description out of every prompt", async () => {
    const face = await newFace(a, "A friendly baker. Pay me at shopowner@okaxis or upi://pay?pa=shopowner@okaxis&pn=Shop");
    const img = fakeImage();
    const o = { userId: a.userId, brandId: a.brandId, faceId: face.id };
    await makeOptions({ ...o, approvedEstimateUsd: 2, deps: deps(img) });
    await setMaster({ ...o, optionIndex: 1, deps: deps(img) });
    await makeSheet({ ...o, approvedEstimateUsd: 2, deps: deps(img) });
    await approveSheet({ ...o, deps: deps(img) });
    await makePoses({ ...o, poses: ["point"], approvedEstimateUsd: 2, deps: deps(img, fakeCheck(img)) });
    expect(img.requests.length).toBeGreaterThanOrEqual(FACE_OPTIONS + 1 + TRIES_PER_POSE);
    for (const q of img.requests) {
      expect(q.prompt).not.toMatch(/shopowner|okaxis|upi:\/\//i);
      expect(q.prompt).toContain("[payment ID removed]");
    }
  });

  it("states the framing rules and the pose in every pose prompt", async () => {
    const face = await newFace();
    const img = fakeImage();
    const o = { userId: a.userId, brandId: a.brandId, faceId: face.id };
    await makeOptions({ ...o, approvedEstimateUsd: 2, deps: deps(img) });
    await setMaster({ ...o, optionIndex: 0, deps: deps(img) });
    await makeSheet({ ...o, approvedEstimateUsd: 2, deps: deps(img) });
    await approveSheet({ ...o, deps: deps(img) });
    await makePoses({ ...o, poses: ["present"], approvedEstimateUsd: 2, deps: deps(img, fakeCheck(img)) });
    for (const q of img.requests) {
      expect(q.prompt).toContain("plain flat pure green #00FF00 background");
      expect(q.prompt).toContain("no text, no letters, no logos");
    }
    expect(img.requests.at(-1)!.prompt).toContain(FACE_POSE_LINES.present);
  });
});

describe("rules before any money is spent", () => {
  it("a regulated brand cannot generate a realistic AI person", async () => {
    const h = await makeOwner(db, { name: "Care Clinic" });
    const face = await newFace(h, "A friendly adult", "photoreal");
    await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'health' where brand_id = $1", [h.brandId]));
    const img = fakeImage();
    expect(await code(makeOptions({ userId: h.userId, brandId: h.brandId, faceId: face.id, approvedEstimateUsd: 2, deps: deps(img) }))).toBe("face:kind_not_allowed");
    expect(img.requests).toHaveLength(0);
    expect(await usage(h.brandId)).toHaveLength(0);
  });

  it("a drawn character is fine for the same brand", async () => {
    const h = await makeOwner(db, { name: "Care Clinic 2" });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'health' where brand_id = $1", [h.brandId]));
    const face = await newFace(h, "A friendly cartoon helper in a plain blue top");
    const img = fakeImage();
    const r = await makeOptions({ userId: h.userId, brandId: h.brandId, faceId: face.id, approvedEstimateUsd: 2, deps: deps(img) });
    expect(r.options).toHaveLength(FACE_OPTIONS);
  });

  it("only draft AI faces are generated; another brand's face is not found", async () => {
    const owner = await newFace();
    const stranger = await makeOwner(db, { name: "Other Shop" });
    const img = fakeImage();
    expect(await code(makeOptions({ userId: stranger.userId, brandId: stranger.brandId, faceId: owner.id, approvedEstimateUsd: 2, deps: deps(img) }))).toBe("face:not_found");
    const photo = await createDraftFace(a.userId, a.brandId, { kind: "owner_photo", name: "Me" });
    expect(await code(makeOptions({ userId: a.userId, brandId: a.brandId, faceId: photo.id, approvedEstimateUsd: 2, deps: deps(img) }))).toBe("not_ai_face");
    expect(img.requests).toHaveLength(0);
  });
});
