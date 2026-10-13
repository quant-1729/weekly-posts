export const BUCKETS = ["brand-assets", "inputs", "renders", "mascots", "photos"] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface StoredFile {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * File storage. Every path starts with `{brand_id}/`. Paths with "..", absolute
 * paths and anything resolving outside the bucket are rejected.
 */
export interface Storage {
  put(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Returns null when the file does not exist. */
  get(bucket: Bucket, path: string): Promise<StoredFile | null>;
  remove(bucket: Bucket, path: string): Promise<void>;
  /**
   * Every object under `prefix` ("{brand_id}" or "{brand_id}/sub/folder"), as paths
   * relative to the bucket, sorted. Empty when there are none. Used by account export.
   */
  list(bucket: Bucket, prefix: string): Promise<string[]>;
  /**
   * Deletes every object under `prefix` and returns how many were removed. Safe to
   * repeat: an empty or missing prefix removes nothing and does not throw. Used by
   * account deletion (Req 22).
   */
  removePrefix(bucket: Bucket, prefix: string): Promise<number>;
}

export class StoragePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoragePathError";
  }
}
