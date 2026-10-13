import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveInBucket, resolvePrefixInBucket } from "./paths";
import type { Storage, StoredFile } from "./types";

/**
 * Mock storage: files under `<root>/{bucket}/{brand_id}/...`. Content types are
 * kept in a separate tree, `<root>/.meta/{bucket}/...json`, so they never show
 * up as bucket files.
 */
export function createMockStorage(root: string = path.join(process.cwd(), ".data", "storage")): Storage {
  const metaFile = (bucket: string, p: string) => `${resolveInBucket(path.join(root, ".meta"), bucket, p)}.json`;

  return {
    async put(bucket, p, bytes, contentType) {
      const file = resolveInBucket(root, bucket, p);
      const meta = metaFile(bucket, p);
      await mkdir(path.dirname(file), { recursive: true });
      await mkdir(path.dirname(meta), { recursive: true });
      await writeFile(file, bytes);
      await writeFile(meta, JSON.stringify({ contentType }));
    },

    async get(bucket, p): Promise<StoredFile | null> {
      const file = resolveInBucket(root, bucket, p);
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "EISDIR") {
          return null;
        }
        throw e;
      }
      let contentType = "application/octet-stream";
      try {
        const meta = JSON.parse(await readFile(metaFile(bucket, p), "utf8")) as { contentType?: string };
        if (meta.contentType) contentType = meta.contentType;
      } catch {
        // No metadata: serve as opaque bytes.
      }
      return { bytes: new Uint8Array(bytes), contentType };
    },

    async remove(bucket, p) {
      await rm(resolveInBucket(root, bucket, p), { force: true });
      await rm(metaFile(bucket, p), { force: true });
    },

    async list(bucket, prefix) {
      return listFiles(path.resolve(root, bucket), resolvePrefixInBucket(root, bucket, prefix));
    },

    async removePrefix(bucket, prefix) {
      const dir = resolvePrefixInBucket(root, bucket, prefix);
      const count = (await listFiles(path.resolve(root, bucket), dir)).length;
      await rm(dir, { recursive: true, force: true });
      await rm(resolvePrefixInBucket(path.join(root, ".meta"), bucket, prefix), { recursive: true, force: true });
      return count;
    },
  };
}

/** Every file under `dir` as a path relative to `bucketDir` (forward slashes), sorted. */
async function listFiles(bucketDir: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw e;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(path.relative(bucketDir, full).split(path.sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}
