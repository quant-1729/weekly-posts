import { IT, assertSafeEnvironment, cleanupAfterAll, createNamespacedBrand, createUser, testBrandId, trackBrand } from "./helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseStorage } from "@/lib/storage/supabase";
import { BUCKETS, StoragePathError } from "@/lib/storage/types";
import { serveFile } from "@/lib/storage/serve";
import { withRawDb } from "./sweep";

/** Supabase Storage: private buckets, service role, all under a random brand-id prefix in the test namespace. */

cleanupAfterAll();

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe.skipIf(!IT)("Supabase storage", () => {
  const storage = createSupabaseStorage();
  const prefixes: string[] = [];

  beforeAll(() => assertSafeEnvironment());
  afterAll(async () => {
    for (const brandId of prefixes) for (const bucket of BUCKETS) await storage.removePrefix(bucket, brandId);
  });

  const newBrand = () => {
    const id = testBrandId();
    prefixes.push(id);
    return id;
  };

  it("put, get, list and remove work in every bucket", async () => {
    // The buckets are independent: check them side by side (each call is a network round trip).
    await Promise.all(BUCKETS.map(async (bucket) => {
      const brand = newBrand();
      expect(await storage.list(bucket, brand)).toEqual([]);

      await storage.put(bucket, `${brand}/a.txt`, bytes("hello"), "text/plain");
      await storage.put(bucket, `${brand}/sub/b.png`, bytes("png-bytes"), "image/png");
      await storage.put(bucket, `${brand}/sub/deeper/c.json`, bytes("{}"), "application/json");

      const got = await storage.get(bucket, `${brand}/a.txt`);
      expect(got && text(got.bytes)).toBe("hello");
      expect(got?.contentType).toContain("text/plain");
      const png = await storage.get(bucket, `${brand}/sub/b.png`);
      expect(png?.contentType).toBe("image/png");

      expect(await storage.list(bucket, brand)).toEqual([
        `${brand}/a.txt`,
        `${brand}/sub/b.png`,
        `${brand}/sub/deeper/c.json`,
      ]);
      expect(await storage.list(bucket, `${brand}/sub`)).toEqual([`${brand}/sub/b.png`, `${brand}/sub/deeper/c.json`]);
      expect(await storage.list(bucket, `${brand}/sub/`)).toEqual([`${brand}/sub/b.png`, `${brand}/sub/deeper/c.json`]);

      await storage.remove(bucket, `${brand}/a.txt`);
      expect(await storage.get(bucket, `${brand}/a.txt`)).toBeNull();
      await storage.remove(bucket, `${brand}/a.txt`); // removing a missing file is fine

      expect(await storage.removePrefix(bucket, brand)).toBe(2);
      expect(await storage.list(bucket, brand)).toEqual([]);
    }));
  });

  it("get of a missing file returns null (also in a missing folder)", async () => {
    const brand = newBrand();
    expect(await storage.get("renders", `${brand}/nope.png`)).toBeNull();
    expect(await storage.get("renders", `${brand}/no/such/folder/nope.png`)).toBeNull();
  });

  it("put replaces an existing file", async () => {
    const brand = newBrand();
    await storage.put("inputs", `${brand}/x.txt`, bytes("one"), "text/plain");
    await storage.put("inputs", `${brand}/x.txt`, bytes("two"), "text/plain");
    expect(text((await storage.get("inputs", `${brand}/x.txt`))!.bytes)).toBe("two");
    expect(await storage.list("inputs", brand)).toEqual([`${brand}/x.txt`]);
  });

  it("list and removePrefix page through more than 100 objects, across folders, in sorted order", async () => {
    const brand = newBrand();
    const names: string[] = [];
    for (let i = 0; i < 130; i++) names.push(`${brand}/${i % 2 === 0 ? "even" : "odd"}/f${String(i).padStart(3, "0")}.txt`);
    // Uploads in small parallel groups: each one is a network round trip.
    for (let i = 0; i < names.length; i += 15) {
      await Promise.all(names.slice(i, i + 15).map((n) => storage.put("renders", n, bytes(n), "text/plain")));
    }
    expect(await storage.list("renders", brand)).toEqual([...names].sort());
    expect(await storage.list("renders", `${brand}/even`)).toHaveLength(65);

    expect(await storage.removePrefix("renders", brand)).toBe(130);
    expect(await storage.list("renders", brand)).toEqual([]);
    // Repeating is safe and removes nothing.
    expect(await storage.removePrefix("renders", brand)).toBe(0);
  });

  it("removePrefix on a prefix that never existed removes nothing and does not throw", async () => {
    const brand = newBrand();
    for (const bucket of BUCKETS) expect(await storage.removePrefix(bucket, brand)).toBe(0);
    expect(await storage.removePrefix("mascots", `${brand}/nothing/here`)).toBe(0);
  });

  it("removePrefix of one folder leaves the rest, and another brand is untouched", async () => {
    const one = newBrand();
    const two = newBrand();
    await storage.put("photos", `${one}/keep.txt`, bytes("k"), "text/plain");
    await storage.put("photos", `${one}/drop/a.txt`, bytes("a"), "text/plain");
    await storage.put("photos", `${two}/other.txt`, bytes("o"), "text/plain");
    expect(await storage.removePrefix("photos", `${one}/drop`)).toBe(1);
    expect(await storage.list("photos", one)).toEqual([`${one}/keep.txt`]);
    expect(await storage.list("photos", two)).toEqual([`${two}/other.txt`]);
  });

  it("rejects paths outside {brand_id}/ and unknown buckets", async () => {
    await expect(storage.put("renders", "../x.txt", bytes("x"), "text/plain")).rejects.toBeInstanceOf(StoragePathError);
    await expect(storage.put("renders", "not-a-brand/x.txt", bytes("x"), "text/plain")).rejects.toBeInstanceOf(StoragePathError);
    await expect(storage.get("renders", "/abs/x.txt")).rejects.toBeInstanceOf(StoragePathError);
    await expect(storage.removePrefix("renders", "..")).rejects.toBeInstanceOf(StoragePathError);
    await expect(storage.list("nope" as never, testBrandId())).rejects.toBeInstanceOf(StoragePathError);
  });

  it("is private: an anonymous request for the object URL is refused", async () => {
    const brand = newBrand();
    await storage.put("renders", `${brand}/secret.txt`, bytes("secret"), "text/plain");
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/renders/${brand}/secret.txt`;
    const res = await fetch(url);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain("secret");
  });

  it("the database has no storage policy that lets anon or authenticated read these buckets", async () => {
    const rows = await withRawDb((c) =>
      c
        .query<{ n: number }>(
          `select count(*)::int as n from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and (roles::text ~ 'anon|public' or roles::text ~ 'authenticated')`,
        )
        .then((r) => r.rows),
    );
    expect(rows[0].n).toBe(0);
  });

  it("serveFile (GET /api/files/...) serves a member, and gives a non-member and a stranger the same 404", async () => {
    const owner = await createUser();
    const other = await createUser();
    const brand = await createNamespacedBrand(owner.id, "serve");
    trackBrand(brand);
    prefixes.push(brand);
    await storage.put("renders", `${brand}/p/post.png`, bytes("pixels"), "image/png");

    const ok = await serveFile({ userId: owner.id, bucket: "renders", segments: [brand, "p", "post.png"] });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/png");
    expect(text(new Uint8Array(await ok.arrayBuffer()))).toBe("pixels");

    const notMember = await serveFile({ userId: other.id, bucket: "renders", segments: [brand, "p", "post.png"] });
    expect(notMember.status).toBe(404);
    const missing = await serveFile({ userId: owner.id, bucket: "renders", segments: [brand, "p", "gone.png"] });
    expect(missing.status).toBe(404);
    expect((await serveFile({ userId: null, bucket: "renders", segments: [brand, "p", "post.png"] })).status).toBe(401);
  });
});
