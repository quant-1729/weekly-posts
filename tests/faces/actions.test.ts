// The Face card's server actions (F-4): nothing generating runs without the owner's approved price, and the owner walks a
// drawn face from options to "Use this face" one approval at a time. Generation itself runs with fixtures (no AI call).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), getCurrentUser: async () => (session.userId ? { id: session.userId, email: "x@example.com" } : null) }));

import {
  approveFaceSheetAction,
  approvePoseAction,
  createFaceAction,
  loadFaceCardAction,
  makeFaceOptionsAction,
  makeFacePosesAction,
  makeFaceSheetAction,
  pickFaceOptionAction,
  retireFaceAction,
  setFaceInPostsAction,
  updateFaceSettingsAction,
  adoptFaceAction,
} from "@/app/(app)/brand/face-actions";
import type { FaceCardData } from "@/lib/faces/card-types";
import { stepEstimateUsd } from "@/lib/faces/generate/estimate";
import { makeOptions, makePoses, makeSheet, type FaceGenDeps } from "@/lib/faces/generate/steps";
import { FACE_POSES } from "@/lib/faces/types";
import type { MockDb } from "@/lib/db/mock";
import { setStorageForTests, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";
import { fakeCheck, fakeImage } from "./generate/fixtures";

let db: MockDb;
let a: Owner;
let health: Owner;
let storage: Storage;
let dir: string;

beforeAll(async () => {
  db = await openDb();
  dir = mkdtempSync(path.join(os.tmpdir(), "pm-face-actions-"));
  storage = createMockStorage(dir);
  setStorageForTests(storage);
  a = await makeOwner(db, { name: "Corner Bakery" });
  health = await makeOwner(db, { name: "Green Clinic" });
  await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'health' where brand_id = $1", [health.brandId]));
  session.userId = a.userId;
});
afterAll(async () => {
  setStorageForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await closeDb(db);
});

const card = async (): Promise<FaceCardData> => {
  const r = await loadFaceCardAction();
  if (!r.ok) throw new Error(r.message);
  return r.data;
};
const usageCount = async (brandId: string) => (await db.withAdmin((tx) => tx.query("select 1 from public.usage_events where brand_id = $1 and kind = 'face_create'", [brandId]))).length;
const cost = async (id: string) => Number((await db.withAdmin((tx) => tx.query<{ c: string }>("select created_cost_usd as c from public.brand_faces where id = $1", [id])))[0].c);

describe("the Face card actions", () => {
  it("refuse to make anything without a signed-in user", async () => {
    session.userId = "";
    expect(await loadFaceCardAction()).toMatchObject({ ok: false });
    expect(await makeFaceOptionsAction("x", 1)).toMatchObject({ ok: false });
    session.userId = a.userId;
  });

  it("walk an illustrated face from describing it to using it, one approval at a time", async () => {
    const created = await createFaceAction({ kind: "illustrated", name: "Mia", description: "A friendly baker in a green apron", style: "flat" });
    if (!created.ok) throw new Error(created.message);
    const id = created.face.id;
    const img = fakeImage();
    const deps: Partial<FaceGenDeps> = { image: img.fn, check: fakeCheck(img).fn, storage };
    const base = { userId: a.userId, brandId: a.brandId, faceId: id };

    // Nothing is made, and nothing is charged, without the price the owner approved.
    for (const bad of [undefined, 0, -1, 0.01, Number.NaN, "0.27" as unknown as number]) {
      const r = await makeFaceOptionsAction(id, bad as number);
      expect(r, String(bad)).toMatchObject({ ok: false, code: "not_approved" });
    }
    expect(await makeFaceSheetAction(id, stepEstimateUsd("sheet"))).toMatchObject({ ok: false, code: "needs_master" });
    expect(await makeFacePosesAction(id, [...FACE_POSES], stepEstimateUsd("poses"))).toMatchObject({ ok: false });
    expect(img.requests).toHaveLength(0);
    expect(await usageCount(a.brandId)).toBe(0);
    expect(await cost(id)).toBe(0);
    expect((await card()).faces[0]).toMatchObject({ id, status: "draft", optionUrls: [null, null, null, null], masterUrl: null, spentUsd: 0 });

    // a. options (the price approved is the estimate shown)
    const options = await makeOptions({ ...base, approvedEstimateUsd: stepEstimateUsd("options"), deps });
    expect(options.options).toHaveLength(4);
    let c = (await card()).faces[0];
    expect(c.optionUrls.every((u) => u && u.startsWith(`/api/files/mascots/${a.brandId}/faces/${id}/options/`))).toBe(true);
    expect(c.spentUsd).toBeCloseTo(0.268, 3);
    expect(await pickFaceOptionAction(id, 9)).toMatchObject({ ok: false, code: "no_option" });
    expect(await pickFaceOptionAction(id, 1)).toEqual({ ok: true });
    c = (await card()).faces[0];
    expect(c.masterUrl).toContain(`/api/files/mascots/${a.brandId}/faces/${id}/master.png`);

    // b. sheet
    expect(await makeFaceSheetAction(id, undefined as unknown as number)).toMatchObject({ ok: false, code: "not_approved" });
    expect(await approveFaceSheetAction(id)).toMatchObject({ ok: false, code: "needs_sheet" });
    await makeSheet({ ...base, approvedEstimateUsd: stepEstimateUsd("sheet"), deps });
    expect((await card()).faces[0].sheetDraftUrl).toContain("sheet-draft.png");
    expect((await card()).faces[0].sheetUrl).toBeNull();
    expect(await approveFaceSheetAction(id)).toEqual({ ok: true });
    expect((await card()).faces[0].sheetUrl).toContain("sheet.png");

    // c. poses: refused without approval, then made two at a time as the card does
    expect(await makeFacePosesAction(id, ["wave", "talk"], undefined as unknown as number)).toMatchObject({ ok: false, code: "not_approved" });
    expect(await makeFacePosesAction(id, ["wave", "talk"], stepEstimateUsd("poses", 1))).toMatchObject({ ok: false, code: "not_approved" }); // the price of one pose is not the price of two
    const costBefore = await cost(id);
    for (let i = 0; i < FACE_POSES.length; i += 2) {
      const group = FACE_POSES.slice(i, i + 2);
      const r = await makePoses({ ...base, poses: group, approvedEstimateUsd: stepEstimateUsd("poses", group.length), deps });
      expect(r.saved.map((o) => o.pose)).toEqual(group);
    }
    expect(await cost(id)).toBeGreaterThan(costBefore);
    c = (await card()).faces[0];
    expect(c.poses.map((p) => p.pose)).toEqual([...FACE_POSES]);
    expect(c.poses.every((p) => !p.approved && p.passed && p.url.startsWith(`/api/files/mascots/${a.brandId}/faces/${id}/`))).toBe(true);

    // The face cannot be used before every pose is approved.
    expect(await adoptFaceAction(id)).toMatchObject({ ok: false, code: "needs_poses" });
    for (const pose of FACE_POSES) expect(await approvePoseAction(id, pose)).toEqual({ ok: true });
    expect(await approvePoseAction(id, "moonwalk")).toMatchObject({ ok: false });
    expect((await card()).faces[0].poses.every((p) => p.approved)).toBe(true);

    // Redo one pose: it needs its own approved price, comes back unapproved, the others stay approved.
    expect(await makeFacePosesAction(id, ["point"], 0.01)).toMatchObject({ ok: false, code: "not_approved" });
    const spentBeforeRedo = await cost(id);
    const redo = await makePoses({ ...base, poses: ["point"], approvedEstimateUsd: stepEstimateUsd("poses", 1), deps });
    expect(redo.saved.map((o) => o.pose)).toEqual(["point"]);
    expect(await cost(id)).toBeGreaterThan(spentBeforeRedo);
    expect(await cost(id) - spentBeforeRedo).toBeLessThanOrEqual(stepEstimateUsd("poses", 1) + 1e-9);
    c = (await card()).faces[0];
    expect(c.poses.find((p) => p.pose === "point")!.approved).toBe(false);
    expect(c.poses.filter((p) => p.approved)).toHaveLength(6);
    expect(await adoptFaceAction(id)).toMatchObject({ ok: false, code: "needs_poses" });
    expect(await approvePoseAction(id, "point")).toEqual({ ok: true });

    // Use this face: approved, active and on in posts.
    const used = await adoptFaceAction(id);
    expect(used).toMatchObject({ ok: true, face: { id, status: "approved" } });
    let d = await card();
    expect(d).toMatchObject({ activeFaceId: id, inPosts: true });
    expect(d.faces[0].status).toBe("approved");

    // The active face's settings.
    expect(await setFaceInPostsAction(false)).toMatchObject({ ok: true, state: { inPosts: false } });
    expect(await updateFaceSettingsAction(id, { postTypes: ["offer", "event"], placement: { size: "large" } })).toMatchObject({ ok: true });
    d = await card();
    expect(d.inPosts).toBe(false);
    expect(d.faces[0]).toMatchObject({ postTypes: ["offer", "event"], placement: { size: "large" } });
    expect(await updateFaceSettingsAction(id, { postTypes: [] })).toMatchObject({ ok: true });
    expect((await card()).faces[0].postTypes).toBeNull();
    expect(await updateFaceSettingsAction(id, { placement: { size: "huge" } })).toMatchObject({ ok: false, code: "bad_settings" });

    // Retire deletes the poses and the face is no longer the brand's.
    expect(await retireFaceAction(id)).toEqual({ ok: true });
    d = await card();
    expect(d.faces).toHaveLength(0);
    expect(d.activeFaceId).toBeNull();
    expect(await storage.list("mascots", `${a.brandId}/faces/${id}`)).toEqual([]);
  });

  it("show a real or famous person's name as a refusal on the description, and nothing is saved", async () => {
    const r = await createFaceAction({ kind: "illustrated", name: "Mia", description: "Looks like Taylor Swift", style: "flat" });
    expect(r).toMatchObject({ ok: false, code: "real_person" });
    if (!r.ok) expect(r.message).toContain("not a real or famous person");
    expect((await card()).faces).toHaveLength(0);
  });

  it("refuse a realistic AI person for a health business, and the card says it is not available", async () => {
    session.userId = health.userId;
    const r = await createFaceAction({ kind: "photoreal", name: "Dr Mia", description: "A friendly person", style: "photo" });
    expect(r).toMatchObject({ ok: false, code: "kind_not_allowed" });
    expect((await card()).regulated).toBe("health");
    expect((await card()).faces).toHaveLength(0);
    // Even a draft made some other way cannot be paid for.
    await db.withAdmin((tx) => tx.query("insert into public.brand_faces (brand_id, kind, name, description, style) values ($1, 'photoreal', 'Mia', 'A friendly person', 'photo')", [health.brandId]));
    const id = (await card()).faces[0].id;
    const img = fakeImage();
    expect(await makeFaceOptionsAction(id, stepEstimateUsd("options"))).toMatchObject({ ok: false, code: "kind_not_allowed" });
    expect(img.requests).toHaveLength(0);
    expect(await usageCount(health.brandId)).toBe(0);
    session.userId = a.userId;
  });

  it("never touch another brand's face", async () => {
    session.userId = a.userId;
    const created = await createFaceAction({ kind: "illustrated", name: "Zed", description: "A tall robot baker", style: "flat" });
    if (!created.ok) throw new Error(created.message);
    session.userId = health.userId;
    expect(await makeFaceOptionsAction(created.face.id, stepEstimateUsd("options"))).toMatchObject({ ok: false, code: "not_found" });
    expect(await retireFaceAction(created.face.id)).toMatchObject({ ok: false });
    expect(await approvePoseAction(created.face.id, "wave")).toMatchObject({ ok: false });
    session.userId = a.userId;
    expect((await card()).faces.map((f) => f.id)).toContain(created.face.id);
  });
});
