import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isBucket, parseStoragePath, parseStoragePrefix } from "./paths";
import { StoragePathError, type Bucket, type Storage, type StoredFile } from "./types";

/**
 * Supabase Storage (D8): private buckets, reached with the service role key from the
 * server only. Files are never linked directly: GET /api/files/[bucket]/[...path]
 * (serve.ts) checks brand membership and then calls `get`.
 *
 * `list` and `removePrefix` page through storage.from(bucket).list(folder) 100 objects at
 * a time, recursing into sub-folders. `removePrefix` deletes in batches and throws on the
 * first failed batch, so account deletion (Req 22) stops and keeps the database rows.
 */

const PAGE = 100;
const DELETE_BATCH = 100;

function bucketName(bucket: string): Bucket {
  if (!isBucket(bucket)) throw new StoragePathError("Unknown bucket");
  return bucket;
}

/** Storage answers a missing object with 404 (older versions: 400 with "not found"). */
function isNotFound(e: { message?: string; status?: number; statusCode?: string | number } | null | undefined): boolean {
  if (!e) return false;
  return (
    e.status === 404 ||
    String(e.statusCode) === "404" ||
    /not.?found|does not exist/i.test(e.message ?? "")
  );
}

export function createSupabaseStorage(): Storage {
  const files = (bucket: string) => getSupabaseAdmin().storage.from(bucketName(bucket));

  /** Every object under `folder` as full paths, sorted. */
  async function listAll(bucket: string, folder: string): Promise<string[]> {
    const api = files(bucket);
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await api.list(dir, {
          limit: PAGE,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (error) {
          if (isNotFound(error)) return;
          throw new Error(`Storage list failed: ${error.message}`);
        }
        for (const entry of data ?? []) {
          // Folders come back without an id; they have no object of their own.
          if (entry.id === null || entry.id === undefined) await walk(`${dir}/${entry.name}`);
          else out.push(`${dir}/${entry.name}`);
        }
        if (!data || data.length < PAGE) return;
      }
    };
    await walk(folder);
    return out.sort();
  }

  return {
    async put(bucket, p, bytes, contentType) {
      parseStoragePath(p);
      const { error } = await files(bucket).upload(p, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
    },

    async get(bucket, p): Promise<StoredFile | null> {
      parseStoragePath(p);
      // Supabase fronts storage with a CDN that can keep serving an object for a while after it was
      // replaced or deleted. A fresh nonce per read bypasses that cache, so a deleted file (Req 22) is
      // really gone and a replaced one is never stale. Reads are behind our own sign-in check anyway.
      const { data, error } = await files(bucket).download(p, { cacheNonce: crypto.randomUUID() });
      if (error) {
        if (isNotFound(error)) return null;
        throw new Error(`Storage download failed: ${error.message}`);
      }
      if (!data) return null;
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
    },

    async remove(bucket, p) {
      parseStoragePath(p);
      const { error } = await files(bucket).remove([p]);
      if (error && !isNotFound(error)) throw new Error(`Storage delete failed: ${error.message}`);
    },

    async signedUrl(bucket, p, ttlSeconds) {
      parseStoragePath(p);
      if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) throw new RangeError("ttlSeconds must be at least 1");
      const { data, error } = await files(bucket).createSignedUrl(p, Math.floor(ttlSeconds));
      if (error || !data?.signedUrl) throw new Error(`Storage signed URL failed: ${error?.message ?? "no URL returned"}`);
      return data.signedUrl;
    },

    async list(bucket, prefix) {
      const { segments } = parseStoragePrefix(prefix);
      return listAll(bucket, segments.join("/"));
    },

    async removePrefix(bucket, prefix) {
      const { segments } = parseStoragePrefix(prefix);
      const paths = await listAll(bucket, segments.join("/"));
      let removed = 0;
      for (let i = 0; i < paths.length; i += DELETE_BATCH) {
        const batch = paths.slice(i, i + DELETE_BATCH);
        const { data, error } = await files(bucket).remove(batch);
        if (error) throw new Error(`Storage delete failed: ${error.message}`);
        removed += data?.length ?? batch.length;
      }
      return removed;
    },
  };
}
