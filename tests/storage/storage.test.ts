import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { createMockStorage } from "@/lib/storage/mock";
import { serveFile } from "@/lib/storage/serve";
import { parseStoragePath } from "@/lib/storage/paths";
import { StoragePathError, type Storage } from "@/lib/storage/types";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string, outsider: string;
let brand: string;

const bytes = (s: string) => new TextEncoder().encode(s);

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-storage-"));
  storage = createMockStorage(root);
  db = await createMockDb();
  setMockDbForTests(db);

  [owner, outsider] = await db.withAdmin(async (tx) => {
    const ids: string[] = [];
    for (const phone of ["+919800000011", "+919800000012"]) {
      const [r] = await tx.query<{ id: string }>("insert into auth.users (phone) values ($1) returning id", [phone]);
      await tx.query("insert into public.profiles (id, phone, consent_at) values ($1, $2, now())", [r.id, phone]);
      ids.push(r.id);
    }
    return ids;
  });
  [{ id: brand }] = await db.withUser(owner, (tx) => tx.query<{ id: string }>("select public.create_brand('Test Brand') as id"));
});

afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await rm(root, { recursive: true, force: true });
});

const BAD_PATHS = [
  "../x.png",
  "/etc/passwd",
  "C:/Windows/win.ini",
  "..\\x.png",
  "a/../../b",
  "/abs/path.png",
  "",
  "not-a-uuid/file.png",
  "11111111-1111-4111-8111-111111111111", // brand folder only, no file
  "11111111-1111-4111-8111-111111111111/../22222222-2222-4222-8222-222222222222/x.png",
  "11111111-1111-4111-8111-111111111111//x.png",
  "11111111-1111-4111-8111-111111111111/./x.png",
  "11111111-1111-4111-8111-111111111111/x\0.png",
];

describe("storage paths", () => {
  it.each(BAD_PATHS)("rejects %j", (p) => {
    expect(() => parseStoragePath(p)).toThrow(StoragePathError);
  });

  it("accepts {brand_id}/file", () => {
    expect(parseStoragePath("11111111-1111-4111-8111-111111111111/a/b.png").brandId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it.each(BAD_PATHS)("mock put/get/remove reject %j and write nothing", async (p) => {
    await expect(storage.put("inputs", p, bytes("x"), "image/png")).rejects.toThrow(StoragePathError);
    await expect(storage.get("inputs", p)).rejects.toThrow(StoragePathError);
    await expect(storage.remove("inputs", p)).rejects.toThrow(StoragePathError);
  });

  it("rejects an unknown bucket", async () => {
    await expect(storage.put("secrets" as never, `${brand}/x.png`, bytes("x"), "image/png")).rejects.toThrow(
      StoragePathError,
    );
  });

  it("nothing is written outside the bucket directory", async () => {
    await storage.put("inputs", `${brand}/ok.txt`, bytes("hello"), "text/plain").catch(() => {});
    const top = await readdir(root);
    expect(top.every((n) => ["inputs", ".meta"].includes(n))).toBe(true);
  });

  it("round-trips bytes and content type, and removes", async () => {
    const p = `${brand}/photo.png`;
    await storage.put("renders", p, bytes("PNGDATA"), "image/png");
    const got = await storage.get("renders", p);
    expect(new TextDecoder().decode(got!.bytes)).toBe("PNGDATA");
    expect(got!.contentType).toBe("image/png");
    await storage.remove("renders", p);
    expect(await storage.get("renders", p)).toBeNull();
  });
});

describe("serveFile (GET /api/files/[bucket]/[...path])", () => {
  const seg = (name: string) => [brand, name];

  beforeAll(async () => {
    await storage.put("brand-assets", `${brand}/logo.png`, bytes("LOGO"), "image/png");
    // A file planted under another brand's folder must not be reachable by the outsider via a traversal.
    await writeFile(path.join(root, "secret.txt"), "top secret");
  });

  it("serves the file to a brand member with its content type", async () => {
    const res = await serveFile({ userId: owner, bucket: "brand-assets", segments: seg("logo.png"), storage });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("LOGO");
  });

  it("returns 401 when signed out", async () => {
    const res = await serveFile({ userId: null, bucket: "brand-assets", segments: seg("logo.png"), storage });
    expect(res.status).toBe(401);
  });

  it("returns 404 (not the file) to a signed-in non-member", async () => {
    const res = await serveFile({ userId: outsider, bucket: "brand-assets", segments: seg("logo.png"), storage });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("LOGO");
  });

  it("returns 404 for a missing file, unknown bucket and traversal attempts", async () => {
    expect((await serveFile({ userId: owner, bucket: "brand-assets", segments: seg("nope.png"), storage })).status).toBe(404);
    expect((await serveFile({ userId: owner, bucket: "secrets", segments: seg("logo.png"), storage })).status).toBe(404);
    expect((await serveFile({ userId: owner, bucket: "brand-assets", segments: [brand, "..", "..", "secret.txt"], storage })).status).toBe(404);
    expect((await serveFile({ userId: owner, bucket: "brand-assets", segments: ["not-a-uuid", "logo.png"], storage })).status).toBe(404);
  });
});
