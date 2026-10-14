import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGcsStorage,
  MAX_SIGNED_URL_SECONDS,
  type GcsBucketLike,
  type GcsClientLike,
  type GcsFileLike,
} from "@/lib/storage/gcs";
import { StoragePathError } from "@/lib/storage/types";
import { getStorage } from "@/lib/storage";
import { getEnv } from "@/lib/env";
import { createMockStorage } from "@/lib/storage/mock";

const BRAND = "17e57007-0000-4000-8000-000000000001";
const OTHER = "17e57007-0000-4000-8000-000000000002";
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function gcsError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** In-memory stand-in for @google-cloud/storage: buckets by name, objects by path. */
function fakeClient(opts: { pageSize?: number; failDeleteOn?: string } = {}) {
  const buckets = new Map<string, Map<string, { data: Buffer; contentType: string; cacheControl?: string }>>();
  const calls = { getFiles: 0, signed: [] as Array<{ name: string; expires: number }> };
  const pageSize = opts.pageSize ?? 1000;

  const bucket = (name: string): GcsBucketLike => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const objects = buckets.get(name)!;
    return {
      file(path): GcsFileLike {
        return {
          async save(data, options) {
            objects.set(path, { data, contentType: options.contentType, cacheControl: options.metadata.cacheControl });
          },
          async download() {
            const o = objects.get(path);
            if (!o) throw gcsError(404, `No such object: ${name}/${path}`);
            return [o.data];
          },
          async getMetadata() {
            const o = objects.get(path);
            if (!o) throw gcsError(404, `No such object: ${name}/${path}`);
            return [{ contentType: o.contentType }];
          },
          async delete(options) {
            if (opts.failDeleteOn === path) throw gcsError(500, "backend error");
            if (!objects.delete(path) && !options.ignoreNotFound) throw gcsError(404, `No such object: ${name}/${path}`);
          },
          async getSignedUrl(config) {
            calls.signed.push({ name: `${name}/${path}`, expires: config.expires });
            return [`https://storage.googleapis.com/${name}/${path}?X-Goog-Signature=abc`];
          },
        };
      },
      async getFiles(options) {
        calls.getFiles++;
        const names = [...objects.keys()].filter((n) => n.startsWith(options.prefix)).sort();
        const start = options.pageToken ? Number(options.pageToken) : 0;
        const page = names.slice(start, start + Math.min(pageSize, options.maxResults));
        const next = start + page.length < names.length ? { pageToken: String(start + page.length) } : null;
        return [page.map((n) => ({ name: n })), next];
      },
    };
  };
  const client: GcsClientLike = { bucket };
  return { client, buckets, calls };
}

afterEach(() => vi.unstubAllEnvs());

describe("gcs storage", () => {
  it("names buckets prefix-bucket and puts, gets and removes a file", async () => {
    const { client, buckets } = fakeClient();
    const s = createGcsStorage({ client, prefix: "Weekly-Test" });
    await s.put("renders", `${BRAND}/a/b.png`, bytes("png!"), "image/png");
    expect(buckets.has("weekly-test-renders")).toBe(true);
    expect(buckets.get("weekly-test-renders")!.get(`${BRAND}/a/b.png`)!.cacheControl).toBe("no-cache");

    const got = await s.get("renders", `${BRAND}/a/b.png`);
    expect(got?.contentType).toBe("image/png");
    expect(text(got!.bytes)).toBe("png!");

    // Replacing a file is visible at once (no cache-buster needed on GCS).
    await s.put("renders", `${BRAND}/a/b.png`, bytes("newer"), "image/webp");
    const again = await s.get("renders", `${BRAND}/a/b.png`);
    expect(text(again!.bytes)).toBe("newer");
    expect(again?.contentType).toBe("image/webp");

    await s.remove("renders", `${BRAND}/a/b.png`);
    expect(await s.get("renders", `${BRAND}/a/b.png`)).toBeNull();
    await expect(s.remove("renders", `${BRAND}/a/b.png`)).resolves.toBeUndefined();
  });

  it("get returns null for a missing file but throws for a missing bucket", async () => {
    const { client } = fakeClient();
    const s = createGcsStorage({ client, prefix: "p" });
    expect(await s.get("inputs", `${BRAND}/nope.jpg`)).toBeNull();

    const broken: GcsClientLike = {
      bucket: () => ({
        file: () => ({
          download: async () => {
            throw gcsError(404, "The specified bucket does not exist.");
          },
          getMetadata: async () => {
            throw gcsError(404, "The specified bucket does not exist.");
          },
        }) as unknown as GcsFileLike,
        getFiles: async () => [[], null],
      }),
    };
    await expect(createGcsStorage({ client: broken, prefix: "p" }).get("inputs", `${BRAND}/x.jpg`)).rejects.toThrow(
      /bucket does not exist/,
    );
  });

  it("rejects bad paths and unknown buckets like the other backends", async () => {
    const { client } = fakeClient();
    const s = createGcsStorage({ client, prefix: "p" });
    await expect(s.put("renders", "../x", bytes("x"), "text/plain")).rejects.toBeInstanceOf(StoragePathError);
    await expect(s.get("renders", "not-a-uuid/x.png")).rejects.toBeInstanceOf(StoragePathError);
    await expect(s.get("renders", `/${BRAND}/x.png`)).rejects.toBeInstanceOf(StoragePathError);
    await expect(s.get("nope" as never, `${BRAND}/x.png`)).rejects.toBeInstanceOf(StoragePathError);
    await expect(s.list("renders", `${BRAND}/../${OTHER}`)).rejects.toBeInstanceOf(StoragePathError);
    await expect(s.removePrefix("renders", "..")).rejects.toBeInstanceOf(StoragePathError);
    await expect(s.signedUrl!("renders", "../x", 60)).rejects.toBeInstanceOf(StoragePathError);
  });

  it("needs GCS_BUCKET_PREFIX", async () => {
    vi.stubEnv("GCS_BUCKET_PREFIX", "");
    const { client } = fakeClient();
    await expect(createGcsStorage({ client }).get("renders", `${BRAND}/x.png`)).rejects.toThrow(/GCS_BUCKET_PREFIX/);
  });

  it("list pages through every object, sorted, and stays inside the prefix", async () => {
    const { client, calls, buckets } = fakeClient({ pageSize: 2 });
    const s = createGcsStorage({ client, prefix: "p" });
    for (const f of ["e.png", "a.png", "sub/c.png", "sub/b.png", "d.png"]) {
      await s.put("renders", `${BRAND}/${f}`, bytes(f), "image/png");
    }
    await s.put("renders", `${OTHER}/z.png`, bytes("z"), "image/png");
    // A folder placeholder made in the console is not a file.
    buckets.get("p-renders")!.set(`${BRAND}/sub/`, { data: Buffer.alloc(0), contentType: "application/x-directory" });

    expect(await s.list("renders", BRAND)).toEqual(
      ["a.png", "d.png", "e.png", "sub/b.png", "sub/c.png"].map((f) => `${BRAND}/${f}`),
    );
    expect(calls.getFiles).toBeGreaterThanOrEqual(3);
    expect(await s.list("renders", `${BRAND}/sub/`)).toEqual([`${BRAND}/sub/b.png`, `${BRAND}/sub/c.png`]);
    expect(await s.list("renders", OTHER)).toEqual([`${OTHER}/z.png`]);
  }, 20000);

  it("list of an empty prefix is empty", async () => {
    const { client } = fakeClient();
    expect(await createGcsStorage({ client, prefix: "p" }).list("photos", BRAND)).toEqual([]);
  });

  it("removePrefix deletes in batches of 100 and returns the count; repeating removes nothing", async () => {
    const { client, buckets } = fakeClient({ pageSize: 50 });
    const s = createGcsStorage({ client, prefix: "p" });
    // Seed straight into the fake: 250 objects for BRAND, 1 for OTHER.
    const store = new Map<string, { data: Buffer; contentType: string }>();
    buckets.set("p-inputs", store);
    for (let i = 0; i < 250; i++) store.set(`${BRAND}/f${String(i).padStart(3, "0")}.jpg`, { data: Buffer.from("x"), contentType: "image/jpeg" });
    store.set(`${OTHER}/keep.jpg`, { data: Buffer.from("x"), contentType: "image/jpeg" });

    // Count deletes running at the same time: batches of 100 means never more than 100.
    const original = client.bucket.bind(client);
    let inFlight = 0;
    let maxInFlight = 0;
    (client as { bucket: GcsClientLike["bucket"] }).bucket = (name) => {
      const b = original(name);
      return {
        getFiles: b.getFiles.bind(b),
        file: (path) => {
          const f = b.file(path);
          return {
            ...f,
            delete: async (o) => {
              inFlight++;
              maxInFlight = Math.max(maxInFlight, inFlight);
              await Promise.resolve();
              await f.delete(o);
              inFlight--;
            },
          } as GcsFileLike;
        },
      };
    };

    expect(await s.removePrefix("inputs", BRAND)).toBe(250);
    expect(maxInFlight).toBe(100);
    expect(store.size).toBe(1);
    expect(await s.removePrefix("inputs", BRAND)).toBe(0);
    expect(await s.get("inputs", `${OTHER}/keep.jpg`)).not.toBeNull();
  });

  it("removePrefix stops and throws on the first failed batch", async () => {
    const failing = `${BRAND}/f150.jpg`;
    const { client, buckets } = fakeClient({ failDeleteOn: failing });
    const s = createGcsStorage({ client, prefix: "p" });
    const store = new Map<string, { data: Buffer; contentType: string }>();
    buckets.set("p-inputs", store);
    for (let i = 0; i < 250; i++) store.set(`${BRAND}/f${String(i).padStart(3, "0")}.jpg`, { data: Buffer.from("x"), contentType: "image/jpeg" });

    await expect(s.removePrefix("inputs", BRAND)).rejects.toThrow(/Storage delete failed: backend error/);
    // Batch 1 (f000-f099) went through; the failing batch (f100-f199) did not reach batch 3.
    expect(store.has(`${BRAND}/f000.jpg`)).toBe(false);
    expect(store.has(`${BRAND}/f249.jpg`)).toBe(true);
    expect(store.has(failing)).toBe(true);
  });

  it("signedUrl returns a V4 read URL that expires after the ttl", async () => {
    const { client, calls } = fakeClient();
    const s = createGcsStorage({ client, prefix: "p" });
    const before = Date.now();
    const url = await s.signedUrl!("renders", `${BRAND}/post.png`, 3600);
    expect(url).toMatch(/^https:\/\/storage\.googleapis\.com\/p-renders\//);
    expect(calls.signed).toHaveLength(1);
    expect(calls.signed[0].name).toBe(`p-renders/${BRAND}/post.png`);
    expect(calls.signed[0].expires).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(calls.signed[0].expires).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it("signedUrl refuses a ttl of zero or more than 7 days", async () => {
    const { client } = fakeClient();
    const s = createGcsStorage({ client, prefix: "p" });
    await expect(s.signedUrl!("renders", `${BRAND}/post.png`, 0)).rejects.toThrow(RangeError);
    await expect(s.signedUrl!("renders", `${BRAND}/post.png`, MAX_SIGNED_URL_SECONDS + 1)).rejects.toThrow(RangeError);
    await expect(s.signedUrl!("renders", `${BRAND}/post.png`, MAX_SIGNED_URL_SECONDS)).resolves.toContain("https://");
  });
});

describe("backend selection and the other signedUrl implementations", () => {
  it("STORAGE_BACKEND defaults to DATA_BACKEND and can be set separately", () => {
    vi.stubEnv("STORAGE_BACKEND", "");
    vi.stubEnv("DATA_BACKEND", "mock");
    expect(getEnv().storageBackend).toBe("mock");
    vi.stubEnv("STORAGE_BACKEND", "gcs");
    expect(getEnv().storageBackend).toBe("gcs");
    vi.stubEnv("STORAGE_BACKEND", "nope");
    expect(() => getEnv()).toThrow();
  });

  it("getStorage returns the gcs backend when STORAGE_BACKEND=gcs", () => {
    vi.stubEnv("STORAGE_BACKEND", "gcs");
    vi.stubEnv("DATA_BACKEND", "mock");
    vi.stubEnv("GCS_BUCKET_PREFIX", "x");
    const s = getStorage();
    expect(typeof s.signedUrl).toBe("function");
    // The mock backend has no GCS client: using it with an unknown bucket never reaches the network.
    return expect(s.get("nope" as never, `${BRAND}/x.png`)).rejects.toBeInstanceOf(StoragePathError);
  });

  it("the mock signedUrl is an app URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    const s = createMockStorage("/tmp/unused-pm-root");
    expect(await s.signedUrl!("renders", `${BRAND}/a b.png`, 60)).toBe(
      `https://app.example.com/api/files/renders/${BRAND}/a%20b.png`,
    );
  });
});
