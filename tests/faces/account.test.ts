import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildExport } from "@/lib/account/export";
import { deleteAccount } from "@/lib/account/delete";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { FACE_POSES } from "@/lib/faces/types";
import type { Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { accountRowCounts } from "../account/helpers";
import { filesUnder, seedAccount } from "../account/seed";
import { collect, parseZip } from "../account/zip-read";
import { makeApprovedFace } from "./helpers";

let db: MockDb;
let root: string;
let storage: Storage;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-faces-account-"));
  storage = createMockStorage(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const text = (z: Map<string, Uint8Array>, name: string) => new TextDecoder().decode(z.get(name));

describe("account export and deletion include faces", () => {
  it("the export holds each face, its poses and the pose images", async () => {
    const a = await seedAccount(db, storage);
    const b = await seedAccount(db, storage);
    const mia = await makeApprovedFace(db, a, "illustrated", storage, "Mia");
    const other = await makeApprovedFace(db, b, "illustrated", storage, "Other Brand Face");

    const zip = parseZip(await collect(await buildExport(a.userId, { storage, now: new Date("2026-10-15T09:00:00Z") })));
    const brand = JSON.parse(text(zip.files, "brand.json"));
    expect(brand.faces.map((f: { name: string }) => f.name)).toEqual(["Mia"]);
    expect(brand.faces[0]).toMatchObject({ id: mia.id, kind: "illustrated", status: "approved" });
    expect(brand.face_poses.map((p: { pose: string }) => p.pose).sort()).toEqual([...FACE_POSES].sort());
    for (const pose of FACE_POSES) {
      const name = `mascots/faces/${mia.id}/${pose}.png`;
      expect(zip.names, name).toContain(name);
      const stored = await storage.get("mascots", `${a.brandId}/faces/${mia.id}/${pose}.png`);
      expect(Buffer.from(zip.files.get(name)!).equals(Buffer.from(stored!.bytes))).toBe(true);
    }
    // Nothing of the other account.
    expect(zip.names.some((n) => n.includes(other.id))).toBe(false);
    expect(JSON.stringify(brand)).not.toContain(other.id);
    expect(text(zip.files, "README.txt")).toContain("faces");
  });

  it("deleting the account removes the faces, their poses and their image files, and leaves another account's alone", async () => {
    const a = await seedAccount(db, storage);
    const b = await seedAccount(db, storage);
    const mia = await makeApprovedFace(db, a, "illustrated", storage, "Mia");
    const keep = await makeApprovedFace(db, b, "photoreal", storage, "Keep");
    const before = await accountRowCounts(db, a);
    expect(before.brand_faces).toBe(1);
    expect(before.brand_face_poses).toBe(7);
    const beforeB = await accountRowCounts(db, b);
    expect(await storage.list("mascots", `${a.brandId}/faces/${mia.id}`)).toHaveLength(7);

    const result = await deleteAccount(a.userId, { storage });
    expect(result.deleted).toBe(true);

    const after = await accountRowCounts(db, a);
    expect(after.brand_faces).toBe(0);
    expect(after.brand_face_poses).toBe(0);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(await storage.list("mascots", a.brandId)).toEqual([]);
    expect(await filesUnder(storage, a.brandId)).toEqual([]);

    expect(await accountRowCounts(db, b)).toEqual(beforeB);
    expect(await storage.list("mascots", `${b.brandId}/faces/${keep.id}`)).toHaveLength(7);
  });
});
