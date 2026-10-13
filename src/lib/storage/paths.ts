import path from "node:path";
import { BUCKETS, StoragePathError, type Bucket } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBucket(name: string): name is Bucket {
  return (BUCKETS as readonly string[]).includes(name);
}

/**
 * Checks a storage path and returns its segments. The first segment must be a
 * brand id (uuid). Rejects "..", ".", empty segments, backslashes, drive
 * letters, absolute paths and control characters.
 */
export function parseStoragePath(p: string): { brandId: string; segments: string[] } {
  if (typeof p !== "string" || p.length === 0 || p.length > 512) {
    throw new StoragePathError("Invalid path");
  }
  if (/[\x00-\x1f\\:]/.test(p)) throw new StoragePathError("Invalid path");
  if (p.startsWith("/")) throw new StoragePathError("Absolute paths are not allowed");
  const segments = p.split("/");
  if (segments.length < 2) throw new StoragePathError("Path must be {brand_id}/...");
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") throw new StoragePathError("Invalid path segment");
  }
  if (!UUID_RE.test(segments[0])) throw new StoragePathError("Path must start with a brand id");
  return { brandId: segments[0].toLowerCase(), segments };
}

/**
 * Checks a folder prefix for list and removePrefix: "{brand_id}" or "{brand_id}/a/b"
 * (a trailing slash is allowed). Same rules as parseStoragePath, but one segment is enough.
 */
export function parseStoragePrefix(p: string): { brandId: string; segments: string[] } {
  if (typeof p !== "string" || p.length === 0) throw new StoragePathError("Invalid path");
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  if (/[\x00-\x1f\\:]/.test(trimmed) || trimmed.startsWith("/") || trimmed.length > 512) {
    throw new StoragePathError("Invalid path");
  }
  const segments = trimmed.split("/");
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") throw new StoragePathError("Invalid path segment");
  }
  if (!UUID_RE.test(segments[0])) throw new StoragePathError("Path must start with a brand id");
  return { brandId: segments[0].toLowerCase(), segments };
}

/** Absolute folder path for a prefix inside `root/bucket`, guaranteed not to escape it. */
export function resolvePrefixInBucket(root: string, bucket: string, prefix: string): string {
  if (!isBucket(bucket)) throw new StoragePathError("Unknown bucket");
  const { segments } = parseStoragePrefix(prefix);
  const bucketDir = path.resolve(root, bucket);
  const full = path.resolve(bucketDir, ...segments);
  const rel = path.relative(bucketDir, full);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new StoragePathError("Path escapes the bucket");
  }
  return full;
}

/** Absolute file path inside `root/bucket`, guaranteed not to escape it. */
export function resolveInBucket(root: string, bucket: string, p: string): string {
  if (!isBucket(bucket)) throw new StoragePathError("Unknown bucket");
  const { segments } = parseStoragePath(p);
  const bucketDir = path.resolve(root, bucket);
  const full = path.resolve(bucketDir, ...segments);
  const rel = path.relative(bucketDir, full);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new StoragePathError("Path escapes the bucket");
  }
  return full;
}
