import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import { loadCreateBrand } from "@/lib/create";
import type { MockDb } from "@/lib/db/mock";
import { FaceError } from "@/lib/faces/errors";
import {
  approveFace,
  approvePose,
  createDraftFace,
  getFace,
  getFaceState,
  listFaces,
  listPoses,
  retireFace,
  savePoseImage,
  setActiveFace,
  setFaceInPosts,
  updateFaceSettings,
} from "@/lib/faces/service";
import { FACE_POSES } from "@/lib/faces/types";
import { setMascotInPosts } from "@/lib/mascot/service";
import { setStorageForTests, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";
import { addPoses, confirmConsent, makeApprovedFace, poseFixture } from "./helpers";

let db: MockDb;
let a: Owner;
let b: Owner;
let storage: Storage;
let dir: string;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof FaceError ? e.code : e instanceof BrandAccessError ? "access" : `other:${String(e)}`;
  }
  return null;
};
const memory = async (brandId: string) =>
  (await db.withAdmin((tx) => tx.query<{ mascot_in_posts: boolean; face_in_posts: boolean; active_face_id: string | null }>("select mascot_in_posts, face_in_posts, active_face_id::text as active_face_id from public.brand_memory where brand_id = $1", [brandId])))[0];

beforeAll(async () => {
  db = await openDb();
  dir = mkdtempSync(path.join(os.tmpdir(), "pm-faces-"));
  storage = createMockStorage(dir);
  setStorageForTests(storage);
  a = await makeOwner(db, { name: "Corner Bakery" });
  b = await makeOwner(db, { name: "Other Shop" });
});
afterAll(async () => {
  setStorageForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await closeDb(db);
});

describe("creating a draft face", () => {
  it("saves a drawn character as a draft with its settings", async () => {
    const face = await createDraftFace(a.userId, a.brandId, {
      kind: "illustrated",
      name: "Mia",
      description: "A friendly baker in a green apron",
      style: "flat",
      neverSay: ["guaranteed"],
      postTypes: ["offer", "event"],
      placement: { side: "left", size: "small" },
    });
    expect(face).toMatchObject({ kind: "illustrated", name: "Mia", status: "draft", style: "flat", neverSay: ["guaranteed"], postTypes: ["offer", "event"], placement: { side: "left", size: "small" }, createdCostUsd: 0 });
    expect((await listFaces(a.userId, a.brandId)).map((f) => f.id)).toContain(face.id);
  });

  it("refuses a realistic AI person for a health brand, and a mascot for a regulated one", async () => {
    const h = await makeOwner(db, { name: "Care Clinic" });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'health' where brand_id = $1", [h.brandId]));
    expect(await code(createDraftFace(h.userId, h.brandId, { kind: "photoreal", name: "Mia", description: "A person", style: "photo" }))).toBe("kind_not_allowed");
    expect(await code(createDraftFace(h.userId, h.brandId, { kind: "mascot" }))).toBe("kind_not_allowed");
    // A drawn character or the owner's own face is still allowed.
    expect(await code(createDraftFace(h.userId, h.brandId, { kind: "illustrated", name: "Mia", description: "A calm figure" }))).toBeNull();
    expect(await code(createDraftFace(h.userId, h.brandId, { kind: "owner_photo", name: "Dr Rao" }))).toBeNull();
  });

  it("refuses a description that asks for a real or famous person", async () => {
    for (const description of ["looks like Taylor Swift", "a celebrity in a red dress", "an actor"]) {
      expect(await code(createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Mia", description }))).toBe("real_person");
    }
    expect(await code(createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Ganesh", description: "A baker" }))).toBe("blocked_name");
  });

  it("makes Tween when the owner asks for a mascot, with no name needed", async () => {
    const face = await createDraftFace(a.userId, a.brandId, { kind: "mascot" });
    expect(face).toMatchObject({ kind: "mascot", name: "Tween", description: null });
  });

  it("changes the settings of a face, not its character", async () => {
    const face = await createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Sam", description: "A cheerful grandpa" });
    const done = await updateFaceSettings(a.userId, a.brandId, face.id, { name: "Sammy", neverSay: ["cheap"], postTypes: ["offer"], placement: { size: "large" } });
    expect(done).toMatchObject({ name: "Sammy", neverSay: ["cheap"], postTypes: ["offer"], placement: { size: "large" }, description: "A cheerful grandpa" });
    expect(await code(updateFaceSettings(a.userId, a.brandId, face.id, { name: "Ganesh" }))).toBe("blocked_name");
    expect(await code(updateFaceSettings(a.userId, a.brandId, face.id, { postTypes: ["poem"] }))).toBe("bad_settings");
  });
});

describe("pose images", () => {
  it("keeps only a transparent PNG of a usable size", async () => {
    const face = await createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Pia", description: "A kind florist" });
    const base = { userId: a.userId, brandId: a.brandId, faceId: face.id, pose: "wave" as const, storage };
    const jpeg = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#cc3366" } }).jpeg().toBuffer();
    const opaque = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#cc3366" } }).png().toBuffer();
    const tiny = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    for (const png of [jpeg, opaque, tiny, Buffer.from("not an image")]) expect(await code(savePoseImage({ ...base, png }))).toBe("bad_pose");
    const saved = await savePoseImage({ ...base, png: await poseFixture() });
    expect(saved).toMatchObject({ pose: "wave", width: 320, height: 480, approvedAt: null, storagePath: `mascots/${a.brandId}/faces/${face.id}/wave.png` });
    expect((await storage.get("mascots", `${a.brandId}/faces/${face.id}/wave.png`))?.contentType).toBe("image/png");
    // A new image for a pose needs approving again.
    await approvePose(a.userId, a.brandId, face.id, "wave");
    expect((await listPoses(a.userId, a.brandId, face.id))[0].approvedAt).not.toBeNull();
    await savePoseImage({ ...base, png: await poseFixture() });
    expect((await listPoses(a.userId, a.brandId, face.id))[0].approvedAt).toBeNull();
  });
});

describe("approving a face", () => {
  it("needs all 7 poses, each approved by the owner", async () => {
    const face = await createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Ola", description: "A smiling chef" });
    expect(await code(approveFace(a.userId, a.brandId, face.id))).toBe("needs_poses");
    await addPoses(a, face, storage, 6);
    expect(await code(approveFace(a.userId, a.brandId, face.id))).toBe("needs_poses");
    // The seventh pose is there but the owner has not approved it.
    await savePoseImage({ userId: a.userId, brandId: a.brandId, faceId: face.id, pose: FACE_POSES[6], png: await poseFixture(), storage });
    expect(await code(approveFace(a.userId, a.brandId, face.id))).toBe("needs_poses");
    await approvePose(a.userId, a.brandId, face.id, FACE_POSES[6]);
    expect((await approveFace(a.userId, a.brandId, face.id)).status).toBe("approved");
    // Approved once; poses cannot be changed any more.
    expect(await code(approveFace(a.userId, a.brandId, face.id))).toBe("bad_status");
    expect(await code(savePoseImage({ userId: a.userId, brandId: a.brandId, faceId: face.id, pose: "wave", png: await poseFixture(), storage }))).toBe("bad_status");
  });

  it("Tween (a mascot) needs no pose images", async () => {
    const face = await createDraftFace(a.userId, a.brandId, { kind: "mascot" });
    expect((await approveFace(a.userId, a.brandId, face.id)).status).toBe("approved");
  });

  it("the owner's own face needs the email-confirmed consent", async () => {
    const face = await createDraftFace(a.userId, a.brandId, { kind: "owner_photo", name: "Priya" });
    await addPoses(a, face, storage);
    expect(await code(approveFace(a.userId, a.brandId, face.id))).toBe("needs_consent");
    // Consent given but not yet confirmed by email: still refused.
    await db.withAdmin((tx) => tx.query("update public.brand_faces set consent = $2::jsonb where id = $1", [face.id, JSON.stringify({ user_id: a.userId, at: "2026-10-15T09:00:00Z", text_version: "v1" })]));
    expect(await code(approveFace(a.userId, a.brandId, face.id))).toBe("needs_consent");
    await confirmConsent(db, a, face.id);
    const done = await approveFace(a.userId, a.brandId, face.id);
    expect(done.status).toBe("approved");
    expect(done.consent?.emailConfirmedAt).toBe("2026-10-15T09:05:00Z");
  });

  it("the database refuses an approved owner's face without a confirmed consent, whatever the app does", async () => {
    const face = await createDraftFace(a.userId, a.brandId, { kind: "owner_photo", name: "Ravi" });
    await db.withAdmin((tx) => tx.query("update public.brand_faces set consent = $2::jsonb where id = $1", [face.id, JSON.stringify({ user_id: a.userId, at: "2026-10-15T09:00:00Z", text_version: "v1" })]));
    await expect(db.withAdmin((tx) => tx.query("update public.brand_faces set status = 'approved' where id = $1", [face.id]))).rejects.toThrow();
  });

  it("a realistic AI person cannot be approved once the brand is health", async () => {
    const o = await makeOwner(db, { name: "Fit Studio" });
    const face = await createDraftFace(o.userId, o.brandId, { kind: "photoreal", name: "Mia", description: "A trainer", style: "photo" });
    await addPoses(o, face, storage);
    await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'health' where brand_id = $1", [o.brandId]));
    expect(await code(approveFace(o.userId, o.brandId, face.id))).toBe("kind_not_allowed");
  });
});

describe("the face in posts and the older mascot switch", () => {
  it("keeps mascot_in_posts true exactly when the active face is a mascot and on", async () => {
    const o = await makeOwner(db, { name: "Sync Shop" });
    const tween = await createDraftFace(o.userId, o.brandId, { kind: "mascot" }).then((f) => approveFace(o.userId, o.brandId, f.id));
    const mia = await makeApprovedFace(db, o, "illustrated", storage);
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: false, face_in_posts: false, active_face_id: null });

    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: tween.id });
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: true, face_in_posts: true, active_face_id: tween.id });
    await setFaceInPosts(o.userId, o.brandId, false);
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: false, face_in_posts: false, active_face_id: tween.id });
    await setFaceInPosts(o.userId, o.brandId, true);
    expect((await memory(o.brandId)).mascot_in_posts).toBe(true);

    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: mia.id });
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: false, face_in_posts: true, active_face_id: mia.id });
    expect((await getFaceState(o.userId, o.brandId)).activeFaceId).toBe(mia.id);

    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: null });
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: false, face_in_posts: false, active_face_id: null });
  });

  it("only an approved face can be used", async () => {
    const draft = await createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Zed", description: "A tall gardener" });
    expect(await code(setActiveFace({ userId: a.userId, brandId: a.brandId, faceId: draft.id }))).toBe("bad_status");
    expect(await code(setActiveFace({ userId: a.userId, brandId: a.brandId, faceId: "not-an-id" }))).toBe("not_found");
  });

  it("the older switch makes Tween's face the active one, and turning it off leaves another face alone", async () => {
    const o = await makeOwner(db, { name: "Old Switch" });
    await setMascotInPosts(o.userId, o.brandId, true, { storage });
    const tween = (await listFaces(o.userId, o.brandId)).find((f) => f.kind === "mascot")!;
    expect(tween).toMatchObject({ status: "approved", name: "Tween" });
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: true, face_in_posts: true, active_face_id: tween.id });
    await setMascotInPosts(o.userId, o.brandId, false, { storage });
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: false, face_in_posts: false, active_face_id: tween.id });
    await setMascotInPosts(o.userId, o.brandId, true, { storage });
    expect((await listFaces(o.userId, o.brandId)).filter((f) => f.kind === "mascot")).toHaveLength(1);

    const mia = await makeApprovedFace(db, o, "illustrated", storage);
    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: mia.id });
    await setMascotInPosts(o.userId, o.brandId, false, { storage });
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: false, face_in_posts: true, active_face_id: mia.id });
  });

  it("CreateBrand carries the active face: Tween as the mascot kind, an image face with its poses", async () => {
    const o = await makeOwner(db, { name: "Create Brand" });
    expect(await loadCreateBrand(o.userId, o.brandId)).toMatchObject({ face: null, mascotOn: false });

    // Code that predates faces sets the old switch alone: that still means Tween.
    await db.withAdmin((tx) => tx.query("update public.brand_memory set mascot_in_posts = true where brand_id = $1", [o.brandId]));
    expect(await loadCreateBrand(o.userId, o.brandId)).toMatchObject({ mascotOn: true, face: { kind: "mascot", name: "Tween", poses: null } });

    const mia = await makeApprovedFace(db, o, "illustrated", storage, "Mia");
    await updateFaceSettings(o.userId, o.brandId, mia.id, { placement: { size: "small" }, neverSay: ["cheap"] });
    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: mia.id });
    const brand = await loadCreateBrand(o.userId, o.brandId);
    expect(brand.mascotOn).toBe(false);
    expect(brand.face).toMatchObject({ id: mia.id, kind: "illustrated", name: "Mia", placement: { size: "small" }, neverSay: ["cheap"] });
    expect(Object.keys(brand.face!.poses!).sort()).toEqual([...FACE_POSES].sort());
    expect(brand.face!.poses!.wave).toBe(`mascots/${o.brandId}/faces/${mia.id}/wave.png`);

    // Switched off, or a pose gone: no face.
    await setFaceInPosts(o.userId, o.brandId, false);
    expect((await loadCreateBrand(o.userId, o.brandId)).face).toBeNull();
    await setFaceInPosts(o.userId, o.brandId, true);
    await db.withAdmin((tx) => tx.query("update public.brand_face_poses set approved_at = null where face_id = $1 and pose = 'idle'", [mia.id]));
    expect((await loadCreateBrand(o.userId, o.brandId)).face).toBeNull();
  });

  it("a realistic AI person stops being used when the brand becomes a health business", async () => {
    const o = await makeOwner(db, { name: "Turns Health" });
    const real = await makeApprovedFace(db, o, "photoreal", storage);
    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: real.id });
    expect((await loadCreateBrand(o.userId, o.brandId)).face?.kind).toBe("photoreal");
    await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'health' where brand_id = $1", [o.brandId]));
    expect((await loadCreateBrand(o.userId, o.brandId)).face).toBeNull();
    expect(await code(setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: real.id }))).toBe("kind_not_allowed");
  });

  it("retiring the active face clears it and deletes its pose files", async () => {
    const o = await makeOwner(db, { name: "Retire Shop" });
    const mia = await makeApprovedFace(db, o, "illustrated", storage);
    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: mia.id });
    expect(await storage.list("mascots", `${o.brandId}/faces/${mia.id}`)).toHaveLength(7);
    await retireFace(o.userId, o.brandId, mia.id, { storage });
    expect(await memory(o.brandId)).toMatchObject({ mascot_in_posts: false, face_in_posts: false, active_face_id: null });
    expect(await storage.list("mascots", `${o.brandId}/faces/${mia.id}`)).toEqual([]);
    expect(await listPoses(o.userId, o.brandId, mia.id)).toEqual([]);
    expect((await getFace(o.userId, o.brandId, mia.id)).status).toBe("retired");
    expect((await listFaces(o.userId, o.brandId)).map((f) => f.id)).not.toContain(mia.id);
    expect(await code(setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: mia.id }))).toBe("bad_status");
  });
});

describe("row-level security", () => {
  it("another brand cannot read, change or add faces", async () => {
    const mia = await makeApprovedFace(db, a, "illustrated", storage, "Secret");
    // The service for a brand that is not theirs.
    expect(await code(createDraftFace(b.userId, a.brandId, { kind: "mascot" }))).toBe("access");
    expect(await code(approveFace(b.userId, a.brandId, mia.id))).toBe("access");
    expect(await listFaces(b.userId, a.brandId)).toEqual([]);
    expect(await code(getFace(b.userId, a.brandId, mia.id))).toBe("not_found");
    expect(await code(setActiveFace({ userId: b.userId, brandId: a.brandId, faceId: mia.id }))).toBe("access");
    // The database itself.
    expect(await db.withUser(b.userId, (tx) => tx.query("select id from public.brand_faces where brand_id = $1", [a.brandId]))).toEqual([]);
    expect(await db.withUser(b.userId, (tx) => tx.query("select id from public.brand_face_poses where brand_id = $1", [a.brandId]))).toEqual([]);
    await expect(db.withUser(b.userId, (tx) => tx.query("insert into public.brand_faces (brand_id, kind, name) values ($1, 'mascot', 'Evil')", [a.brandId]))).rejects.toThrow();
    expect(await db.withUser(b.userId, (tx) => tx.query("update public.brand_faces set name = 'Hacked' where id = $1 returning id", [mia.id]))).toEqual([]);
    expect(await db.withUser(b.userId, (tx) => tx.query("delete from public.brand_faces where id = $1 returning id", [mia.id]))).toEqual([]);
    expect((await getFace(a.userId, a.brandId, mia.id)).name).toBe("Secret");
    // A pose row cannot point at another brand's face.
    await expect(
      db.withUser(b.userId, (tx) => tx.query("insert into public.brand_face_poses (brand_id, face_id, pose, storage_path, width, height) values ($1, $2, 'wave', 'x', 1, 1)", [b.brandId, mia.id])),
    ).rejects.toThrow();
  });
});

describe("migration 0021 backfill", () => {
  it("gives a brand that had mascot_in_posts on an approved Tween face that is active", async () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase", "migrations", "0021_ideas_and_faces.sql"), "utf8");
    const from = sql.indexOf("insert into public.brand_faces (brand_id, kind, name, status)");
    const to = sql.indexOf("-- ---", from);
    expect(from).toBeGreaterThan(0);
    const statements = sql
      .slice(from, to)
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith("--"));
    expect(statements).toHaveLength(2);

    // A brand as it was before the migration: the mascot switch on, no face rows, no active face.
    const on = await makeOwner(db, { name: "Had Mascot" });
    const off = await makeOwner(db, { name: "Had None" });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set mascot_in_posts = true where brand_id = $1", [on.brandId]));
    await db.withAdmin((tx) => tx.query("delete from public.brand_faces where brand_id = any($1::uuid[])", [[on.brandId, off.brandId]]));
    await db.withAdmin((tx) => tx.query("update public.brand_memory set face_in_posts = false, active_face_id = null where brand_id = any($1::uuid[])", [[on.brandId, off.brandId]]));
    await db.withAdmin(async (tx) => {
      for (const st of statements) await tx.query(st);
    });

    const faces = await listFaces(on.userId, on.brandId);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({ kind: "mascot", name: "Tween", status: "approved" });
    expect(await memory(on.brandId)).toMatchObject({ mascot_in_posts: true, face_in_posts: true, active_face_id: faces[0].id });
    expect(await listFaces(off.userId, off.brandId)).toEqual([]);
    expect(await memory(off.brandId)).toMatchObject({ mascot_in_posts: false, face_in_posts: false, active_face_id: null });
    expect(await loadCreateBrand(on.userId, on.brandId)).toMatchObject({ mascotOn: true, face: { kind: "mascot", id: faces[0].id } });
  });
});
