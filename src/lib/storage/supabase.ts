import type { Storage } from "./types";

/**
 * Not built yet. When it is, `list` and `removePrefix` page through
 * storage.from(bucket).list(folder) (recursing into sub-folders, 100 objects per page)
 * and delete in batches with .remove([...paths]); `removePrefix` throws on the first
 * failed batch so account deletion (Req 22) stops and keeps the database rows.
 */
export function createSupabaseStorage(): Storage {
  throw new Error("Supabase backend not configured yet");
}
