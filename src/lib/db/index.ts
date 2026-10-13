import { getEnv } from "@/lib/env";
import { getMockDb } from "./mock";
import { createSupabaseDb } from "./supabase";
import type { Db, Tx } from "./types";

export type { Db, Tx };

/** Selected by DATA_BACKEND. */
export function getDb(): Db {
  if (getEnv().dataBackend === "supabase") return createSupabaseDb();
  return {
    async withUser(userId, fn) {
      return (await getMockDb()).withUser(userId, fn);
    },
    async withService(fn) {
      return (await getMockDb()).withService(fn);
    },
  };
}
