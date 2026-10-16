// CH-3: the mascot's character. Service validation (unknown and Laltain refused, null reads as Tween), choosing a character
// (the action the gallery calls), and the character reaching the post pipeline. No AI call.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), getCurrentUser: async () => (session.userId ? { id: session.userId, email: "x@example.com" } : null) }));

import { characterPosesAction, chooseMascotCharacterAction } from "@/app/(app)/brand/face-actions";
import { BrandAccessError } from "@/lib/brand/current";
import { CHARACTER_IDS, CHARACTER_LABELS } from "@/lib/characters/types";
import { loadCreateBrand } from "@/lib/create";
import type { MockDb } from "@/lib/db/mock";
import { loadFaceCard } from "@/lib/faces/card";
import { FaceError } from "@/lib/faces/errors";
import { approveFace, createDraftFace, getFace, listFaces, setActiveFace } from "@/lib/faces/service";
import { setMascotInPosts } from "@/lib/mascot/service";
import { setStorageForTests, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";
import { makeApprovedFace } from "./helpers";

let db: MockDb;
let a: Owner;
let storage: Storage;
let dir: string;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof FaceError ? e.code : e instanceof BrandAccessError ? "access" : `other:${(e as Error)?.name ?? String(e)}`;
  }
  return null;
};
const mascots = async (o: Owner) => (await listFaces(o.userId, o.brandId)).filter((f) => f.kind === "mascot");

beforeAll(async () => {
  db = await openDb();
  dir = mkdtempSync(path.join(os.tmpdir(), "pm-characters-"));
  storage = createMockStorage(dir);
  setStorageForTests(storage);
  a = await makeOwner(db, { name: "Corner Bakery" });
  session.userId = a.userId;
});
afterAll(async () => {
  setStorageForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await closeDb(db);
});

describe("a mascot face names its character", () => {
  it("defaults to Tween, named Tween", async () => {
    const o = await makeOwner(db, { name: "Default Shop" });
    const face = await createDraftFace(o.userId, o.brandId, { kind: "mascot" });
    expect(face).toMatchObject({ kind: "mascot", character: "tween", name: "Tween" });
  });

  it("accepts every offered character and names it after its object when the owner gives no name", async () => {
    const o = await makeOwner(db, { name: "Every Shop" });
    for (const id of CHARACTER_IDS) {
      const face = await createDraftFace(o.userId, o.brandId, { kind: "mascot", character: id });
      expect(face.character).toBe(id);
      expect(face.name).toBe(CHARACTER_LABELS[id]);
    }
  });

  it("keeps the owner's own name for it", async () => {
    const face = await createDraftFace(a.userId, a.brandId, { kind: "mascot", character: "dabba", name: "Ruby" });
    expect(face).toMatchObject({ character: "dabba", name: "Ruby" });
  });

  it("refuses an unknown character, Laltain and a non-string", async () => {
    for (const bad of ["laltain", "Laltain", "robot", 7, {}, "nudge "]) {
      expect(await code(createDraftFace(a.userId, a.brandId, { kind: "mascot", character: bad })), String(bad)).toBe("bad_character");
    }
  });

  it("reads a mascot face with no saved character as Tween, and gives other kinds none", async () => {
    const o = await makeOwner(db, { name: "Old Shop" });
    const [row] = await db.withAdmin((tx) =>
      tx.query<{ id: string }>("insert into public.brand_faces (brand_id, kind, name, status, created_by) values ($1, 'mascot', 'Tween', 'approved', $2) returning id::text as id", [o.brandId, o.userId]),
    );
    expect((await getFace(o.userId, o.brandId, row.id)).character).toBe("tween");
    const mia = await makeApprovedFace(db, o, "illustrated", storage);
    expect(mia.character).toBeNull();
    expect((await getFace(o.userId, o.brandId, mia.id)).character).toBeNull();
  });

  it("the database refuses a character outside the list", async () => {
    const o = await makeOwner(db, { name: "Check Shop" });
    await expect(
      db.withAdmin((tx) => tx.query("insert into public.brand_faces (brand_id, kind, name, character, created_by) values ($1, 'mascot', 'X', 'laltain', $2)", [o.brandId, o.userId])),
    ).rejects.toThrow();
  });
});

describe("making a character the active face", () => {
  it("setActiveFace saves the character and the owner's name on a mascot face, and the pipeline sees it", async () => {
    const o = await makeOwner(db, { name: "Active Shop" });
    const tween = await createDraftFace(o.userId, o.brandId, { kind: "mascot" }).then((f) => approveFace(o.userId, o.brandId, f.id));
    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: tween.id, character: "disha", name: "Navi" });
    expect(await getFace(o.userId, o.brandId, tween.id)).toMatchObject({ character: "disha", name: "Navi" });
    expect(await loadCreateBrand(o.userId, o.brandId)).toMatchObject({ mascotOn: true, face: { kind: "mascot", character: "disha", name: "Navi" } });
  });

  it("an empty name goes back to the object name, and no name keeps what the owner wrote", async () => {
    const o = await makeOwner(db, { name: "Name Shop" });
    const f = await createDraftFace(o.userId, o.brandId, { kind: "mascot", character: "yaadu", name: "Bholu" }).then((x) => approveFace(o.userId, o.brandId, x.id));
    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: f.id, character: "mynu" });
    expect((await getFace(o.userId, o.brandId, f.id)).name).toBe("Bholu");
    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: f.id, character: "mynu", name: "" });
    expect((await getFace(o.userId, o.brandId, f.id)).name).toBe("Myna bird");
    // A name that is still the old object's name follows the new character.
    await setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: f.id, character: "tiko" });
    expect((await getFace(o.userId, o.brandId, f.id)).name).toBe("Capsule");
  });

  it("refuses an unknown character, a blocked name, and a character on a face that is not a mascot", async () => {
    const o = await makeOwner(db, { name: "Refuse Shop" });
    const f = await createDraftFace(o.userId, o.brandId, { kind: "mascot" }).then((x) => approveFace(o.userId, o.brandId, x.id));
    expect(await code(setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: f.id, character: "laltain" }))).toBe("bad_character");
    expect(await code(setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: f.id, character: "parchi", name: "Hanuman" }))).toBe("blocked_name");
    expect((await getFace(o.userId, o.brandId, f.id)).character).toBe("tween");
    const mia = await makeApprovedFace(db, o, "illustrated", storage);
    expect(await code(setActiveFace({ userId: o.userId, brandId: o.brandId, faceId: mia.id, character: "parchi" }))).toBe("bad_character");
  });

  it("a regulated business gets no mascot character, as before", async () => {
    const h = await makeOwner(db, { name: "Care Clinic" });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'health' where brand_id = $1", [h.brandId]));
    expect(await code(createDraftFace(h.userId, h.brandId, { kind: "mascot", character: "parchi" }))).toBe("kind_not_allowed");
    session.userId = h.userId;
    expect(await chooseMascotCharacterAction("parchi", "")).toMatchObject({ ok: false });
    session.userId = a.userId;
    expect(await mascots(h)).toHaveLength(0);
  });
});

describe("the gallery's save (chooseMascotCharacterAction)", () => {
  it("selecting a character saves it, turns the mascot on in posts, and makes one face only", async () => {
    const o = await makeOwner(db, { name: "Gallery Shop" });
    session.userId = o.userId;
    expect((await chooseMascotCharacterAction("dabba", "")).ok).toBe(true);
    const faces = await mascots(o);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({ character: "dabba", name: "Tiffin box", status: "approved" });
    const [m] = await db.withAdmin((tx) =>
      tx.query<{ mascot_in_posts: boolean; face_in_posts: boolean; active_face_id: string }>(
        "select mascot_in_posts, face_in_posts, active_face_id::text as active_face_id from public.brand_memory where brand_id = $1",
        [o.brandId],
      ),
    );
    expect(m).toMatchObject({ mascot_in_posts: true, face_in_posts: true, active_face_id: faces[0].id });

    // Another pick changes the same face, with the owner's own name.
    expect((await chooseMascotCharacterAction("disha", "Navi")).ok).toBe(true);
    const again = await mascots(o);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: faces[0].id, character: "disha", name: "Navi" });
    expect((await loadFaceCard(o.userId, o.brandId)).faces.find((f) => f.id === faces[0].id)).toMatchObject({ character: "disha", name: "Navi" });
    expect(await loadCreateBrand(o.userId, o.brandId)).toMatchObject({ face: { kind: "mascot", character: "disha" } });
  });

  it("works after the older mascot switch made Tween", async () => {
    const o = await makeOwner(db, { name: "Switch Shop" });
    session.userId = o.userId;
    await setMascotInPosts(o.userId, o.brandId, true);
    expect((await mascots(o))[0].character).toBe("tween");
    expect((await chooseMascotCharacterAction("tiko", "")).ok).toBe(true);
    expect(await mascots(o)).toHaveLength(1);
    expect((await mascots(o))[0].character).toBe("tiko");
  });

  it("refuses Laltain and unknown characters without making anything", async () => {
    const o = await makeOwner(db, { name: "Bad Pick Shop" });
    session.userId = o.userId;
    for (const bad of ["laltain", "nope"]) {
      expect(await chooseMascotCharacterAction(bad, "")).toMatchObject({ ok: false, code: "bad_character" });
    }
    expect(await mascots(o)).toHaveLength(0);
  });

  it("refuses a blocked name and a signed-out caller", async () => {
    const o = await makeOwner(db, { name: "Blocked Shop" });
    session.userId = o.userId;
    expect(await chooseMascotCharacterAction("parchi", "Hanuman")).toMatchObject({ ok: false, code: "blocked_name" });
    session.userId = "";
    expect(await chooseMascotCharacterAction("parchi", "")).toMatchObject({ ok: false });
    session.userId = a.userId;
  });

  it("gives the four poses of a character for the preview row, and refuses an unknown one", async () => {
    session.userId = a.userId;
    const r = await characterPosesAction("nudge");
    if (!r.ok) throw new Error(r.message);
    expect(r.poses.map((p) => p.action)).toEqual(["wave", "present", "hold-sign", "celebrate"]);
    for (const p of r.poses) expect(p.svg).toContain("<svg");
    expect(await characterPosesAction("laltain")).toMatchObject({ ok: false, code: "bad_character" });
  });
});
