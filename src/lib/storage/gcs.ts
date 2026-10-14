import { Storage as GcsClient } from "@google-cloud/storage";
import { serviceAccountCredentials } from "@/lib/ai/client";
import { isBucket, parseStoragePath, parseStoragePrefix } from "./paths";
import { StoragePathError, type Storage, type StoredFile } from "./types";

/**
 * Google Cloud Storage (C-32): one private bucket per app bucket, named
 * `${GCS_BUCKET_PREFIX}-${bucket}` (GCS bucket names are global, so the prefix keeps ours unique,
 * e.g. `weeklyposts-prod-renders`). Buckets are created once with uniform bucket-level access and
 * public access prevention (docs/deploy.md); the app never makes an object public.
 *
 * Files are never linked directly: GET /api/files/[bucket]/[...path] (serve.ts) checks brand
 * membership and then calls `get`. Publishing (phase 3) needs public, expiring image URLs, which
 * `signedUrl` provides (V4 signed URLs, up to 7 days).
 *
 * Staleness: GCS reads are strongly consistent (a read right after a write or delete sees it), and
 * authenticated API downloads are not served from a shared cache, so unlike Supabase there is no
 * cache-buster. Objects are still written with `Cache-Control: no-cache` so a signed URL fetched by
 * another service (Meta) is revalidated rather than reused after a replace.
 *
 * `list` and `removePrefix` page through the bucket 1000 objects at a time. `removePrefix` deletes
 * in batches and throws on the first failed batch, so account deletion (Req 22) stops and keeps the
 * database rows.
 */

const PAGE = 1000;
const DELETE_BATCH = 100;
/** V4 signed URLs cannot last longer than 7 days. */
export const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

/** The slice of the @google-cloud/storage client used here; tests pass a fake. */
export interface GcsFileLike {
  save(
    data: Buffer,
    options: { contentType: string; resumable: boolean; metadata: { cacheControl: string } },
  ): Promise<unknown>;
  download(): Promise<[Buffer]>;
  getMetadata(): Promise<[{ contentType?: string }]>;
  delete(options: { ignoreNotFound: boolean }): Promise<unknown>;
  getSignedUrl(config: { version: "v4"; action: "read"; expires: number }): Promise<[string]>;
}
export interface GcsBucketLike {
  file(name: string): GcsFileLike;
  getFiles(options: {
    prefix: string;
    autoPaginate: false;
    maxResults: number;
    pageToken?: string;
  }): Promise<[Array<{ name: string }>, { pageToken?: string } | null | undefined, unknown?]>;
}
export interface GcsClientLike {
  bucket(name: string): GcsBucketLike;
}

export interface GcsOptions {
  /** Bucket name prefix. Default: GCS_BUCKET_PREFIX. */
  prefix?: string;
  /** Default: a real client with GOOGLE_SERVICE_ACCOUNT_JSON, or Application Default Credentials when unset. */
  client?: GcsClientLike;
}

let sharedClient: GcsClientLike | null = null;

function realClient(): GcsClientLike {
  if (sharedClient) return sharedClient;
  const credentials = serviceAccountCredentials();
  const projectId =
    (typeof credentials?.project_id === "string" ? credentials.project_id : undefined) ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    undefined;
  sharedClient = new GcsClient({
    ...(projectId ? { projectId } : {}),
    ...(credentials ? { credentials } : {}),
  }) as unknown as GcsClientLike;
  return sharedClient;
}

/** Tests only: forget the cached client so the next call reads the environment again. */
export function resetGcsClientForTests(): void {
  sharedClient = null;
}

function codeOf(e: unknown): number | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : typeof code === "string" && /^\d+$/.test(code) ? Number(code) : undefined;
}

/** A missing bucket answers 404 "The specified bucket does not exist": a setup mistake, not a missing file. */
function isMissingBucket(e: unknown): boolean {
  const message = (e as Error | null)?.message ?? "";
  return codeOf(e) === 404 && /bucket/i.test(message) && !/no such object/i.test(message);
}
/** A missing object answers 404 "No such object". */
function isMissingObject(e: unknown): boolean {
  return codeOf(e) === 404 && !isMissingBucket(e);
}

export function createGcsStorage(opts: GcsOptions = {}): Storage {
  const prefix = (opts.prefix ?? process.env.GCS_BUCKET_PREFIX ?? "").trim().toLowerCase();

  function bucketName(bucket: string): string {
    if (!isBucket(bucket)) throw new StoragePathError("Unknown bucket");
    if (!prefix) throw new Error("GCS_BUCKET_PREFIX is required when STORAGE_BACKEND=gcs.");
    return `${prefix}-${bucket}`;
  }
  const bucketOf = (bucket: string) => (opts.client ?? realClient()).bucket(bucketName(bucket));

  /** Every object under the folder as full paths, sorted. */
  async function listAll(bucket: string, folder: string): Promise<string[]> {
    const b = bucketOf(bucket);
    const out: string[] = [];
    let pageToken: string | undefined;
    do {
      let files: Array<{ name: string }>;
      let next: { pageToken?: string } | null | undefined;
      try {
        [files, next] = await b.getFiles({
          prefix: `${folder}/`,
          autoPaginate: false,
          maxResults: PAGE,
          ...(pageToken ? { pageToken } : {}),
        });
      } catch (e) {
        throw new Error(`Storage list failed: ${(e as Error).message}`);
      }
      // Console-made "folders" are zero-byte objects ending in "/"; they hold nothing.
      for (const f of files) if (!f.name.endsWith("/")) out.push(f.name);
      pageToken = next?.pageToken || undefined;
    } while (pageToken);
    return out.sort();
  }

  return {
    async put(bucket, p, bytes, contentType) {
      parseStoragePath(p);
      try {
        await bucketOf(bucket)
          .file(p)
          .save(Buffer.from(bytes), { contentType, resumable: false, metadata: { cacheControl: "no-cache" } });
      } catch (e) {
        throw new Error(`Storage upload failed: ${(e as Error).message}`);
      }
    },

    async get(bucket, p): Promise<StoredFile | null> {
      parseStoragePath(p);
      const file = bucketOf(bucket).file(p);
      try {
        const [[data], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
        return { bytes: new Uint8Array(data), contentType: meta.contentType || "application/octet-stream" };
      } catch (e) {
        if (isMissingObject(e)) return null;
        throw new Error(`Storage download failed: ${(e as Error).message}`);
      }
    },

    async remove(bucket, p) {
      parseStoragePath(p);
      try {
        await bucketOf(bucket).file(p).delete({ ignoreNotFound: true });
      } catch (e) {
        if (!isMissingObject(e)) throw new Error(`Storage delete failed: ${(e as Error).message}`);
      }
    },

    async list(bucket, prefixPath) {
      const { segments } = parseStoragePrefix(prefixPath);
      return listAll(bucket, segments.join("/"));
    },

    async removePrefix(bucket, prefixPath) {
      const { segments } = parseStoragePrefix(prefixPath);
      const paths = await listAll(bucket, segments.join("/"));
      const b = bucketOf(bucket);
      let removed = 0;
      for (let i = 0; i < paths.length; i += DELETE_BATCH) {
        const batch = paths.slice(i, i + DELETE_BATCH);
        try {
          await Promise.all(batch.map((name) => b.file(name).delete({ ignoreNotFound: true })));
        } catch (e) {
          throw new Error(`Storage delete failed: ${(e as Error).message}`);
        }
        removed += batch.length;
      }
      return removed;
    },

    async signedUrl(bucket, p, ttlSeconds) {
      parseStoragePath(p);
      if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_SIGNED_URL_SECONDS) {
        throw new RangeError(`ttlSeconds must be between 1 and ${MAX_SIGNED_URL_SECONDS}`);
      }
      try {
        const [url] = await bucketOf(bucket)
          .file(p)
          .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + Math.floor(ttlSeconds) * 1000 });
        return url;
      } catch (e) {
        throw new Error(`Storage signed URL failed: ${(e as Error).message}`);
      }
    },
  };
}
