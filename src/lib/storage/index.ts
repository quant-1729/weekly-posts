import { getEnv } from "@/lib/env";
import { createMockStorage } from "./mock";
import { createSupabaseStorage } from "./supabase";
import type { Storage } from "./types";

export { BUCKETS, StoragePathError } from "./types";
export type { Bucket, Storage, StoredFile } from "./types";
export { isBucket, parseStoragePath } from "./paths";

let testStorage: Storage | null = null;

/** Tests only: use this storage for everything that calls getStorage() (like setMockDbForTests for the database). Pass null to undo. */
export function setStorageForTests(storage: Storage | null): void {
  testStorage = storage;
}

/** Selected by DATA_BACKEND. */
export function getStorage(): Storage {
  if (testStorage) return testStorage;
  return getEnv().dataBackend === "supabase" ? createSupabaseStorage() : createMockStorage();
}
