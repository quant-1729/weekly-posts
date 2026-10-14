import { Pool, types, type PoolClient } from "pg";
import { getEnv } from "@/lib/env";
import type { Db, Tx } from "./types";

/**
 * Supabase backend (D1, D8): plain SQL over the transaction pooler with `pg`. Every call
 * is one transaction that first switches role, exactly like the mock, so row-level
 * security applies the same way in both:
 *
 *   begin; set local role authenticated;
 *   select set_config('request.jwt.claim.sub', <id>, true) ...
 *
 * Supabase's auth.uid() reads request.jwt.claim.sub (or request.jwt.claims ->> 'sub').
 * Both are set, so either spelling works.
 */

const g = globalThis as unknown as { __postmitraPgPool?: Pool };

// The mock (PGlite) returns bigint as a number and date/timestamp as UTC Dates. Match it,
// so the same code reads the same values on both backends.
const typeParsers = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === 20) {
      return (x: string) => {
        const n = BigInt(x);
        return n < Number.MIN_SAFE_INTEGER || n > Number.MAX_SAFE_INTEGER ? n : Number(n);
      };
    }
    if (oid === 1082 || oid === 1114) return (x: string) => new Date(x);
    return types.getTypeParser(oid, format);
  },
};

function pool(): Pool {
  if (!g.__postmitraPgPool) {
    const url = getEnv().supabaseDbUrl;
    if (!url) throw new Error("SUPABASE_DB_URL is required when DATA_BACKEND is supabase.");
    const p = new Pool({
      connectionString: url,
      // The pooler's certificate chain is not in Node's store; the link is still encrypted.
      ssl: { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      types: typeParsers,
    });
    // An idle client can be dropped by the pooler; that must not crash the process.
    p.on("error", (e) => console.error("[db] idle client error:", e.message));
    g.__postmitraPgPool = p;
  }
  return g.__postmitraPgPool;
}

/** Tests only: closes the shared pool so the process can exit. */
export async function closeSupabasePool(): Promise<void> {
  const p = g.__postmitraPgPool;
  g.__postmitraPgPool = undefined;
  if (p) await p.end();
}

function wrap(client: PoolClient): Tx {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const res = await client.query(sql, params);
      return res.rows as T[];
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in one transaction. `setupSql` (begin, role, claims, timeout) goes out as ONE
 * multi-statement message, because every round trip to the pooler costs a network hop.
 */
async function inTransaction<T>(setupSql: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  let broken = false;
  try {
    await client.query(setupSql);
    const result = await fn(wrap(client));
    await client.query("commit");
    return result;
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      broken = true; // the connection is unusable: drop it instead of returning it to the pool
    }
    throw e;
  } finally {
    client.release(broken ? true : undefined);
  }
}

const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function createSupabaseDb(): Db {
  return {
    withUser(userId, fn) {
      // Interpolated into SQL, so it must be a uuid (it always is: it comes from a verified session).
      if (!UUID_RE.test(userId)) return Promise.reject(new Error("Invalid user id"));
      const claims = JSON.stringify({ sub: userId, role: "authenticated" });
      return inTransaction(
        `begin; set local role authenticated;
         select set_config('request.jwt.claim.sub', ${literal(userId)}, true),
                set_config('request.jwt.claims', ${literal(claims)}, true);
         set local statement_timeout = '30s'`,
        fn,
      );
    },
    withService(fn) {
      const claims = JSON.stringify({ role: "service_role" });
      return inTransaction(
        `begin; set local role service_role;
         select set_config('request.jwt.claims', ${literal(claims)}, true);
         set local statement_timeout = '30s'`,
        fn,
      );
    },
  };
}
