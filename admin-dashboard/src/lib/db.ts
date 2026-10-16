import pg from "pg";

/**
 * The only door to the database. Server-only (never imported by a client component).
 *
 * `Executor` is a tiny interface so tests can run the real SQL on PGlite instead of a network database.
 * In production it is a `pg` Pool aimed at ADMIN_DATABASE_URL (Supabase transaction pooler).
 */
export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Executor extends Tx {
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

// Dates and counts are cast in SQL, but never let pg hand back a surprise type for bigint/numeric.
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric

function fromPool(pool: pg.Pool): Executor {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    async tx<T>(fn: (tx: Tx) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn({
          async query<R>(sql: string, params?: unknown[]) {
            const res = await client.query(sql, params as unknown[]);
            return res.rows as R[];
          },
        });
        await client.query("commit");
        return out;
      } catch (e) {
        try {
          await client.query("rollback");
        } catch {
          /* the connection is already gone */
        }
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

const g = globalThis as unknown as { __adminExecutor?: Executor; __adminPool?: pg.Pool };

/** Tests install their own executor here. */
export function setExecutor(e: Executor | null): void {
  g.__adminExecutor = e ?? undefined;
}

export function db(): Executor {
  if (g.__adminExecutor) return g.__adminExecutor;
  const url = (process.env.ADMIN_DATABASE_URL ?? "").trim();
  if (!url) throw new Error("Missing environment variable ADMIN_DATABASE_URL");
  const ca = (process.env.ADMIN_DATABASE_CA ?? "").trim();
  const u = new URL(url);
  // Connection options are set here, not taken from the URL: the URL's own sslmode is removed so that `pg` does not
  // override the ssl object below.
  u.searchParams.delete("sslmode");
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  g.__adminPool ??= new pg.Pool({
    connectionString: u.toString(),
    ssl: local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: 3, // serverless: a handful of connections per instance; the pooler does the real pooling
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    query_timeout: 15_000,
  });
  g.__adminExecutor = fromPool(g.__adminPool);
  return g.__adminExecutor;
}
