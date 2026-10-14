// Type-only at load: PGlite (about 21 MB) is imported when a mock database is first created, so a
// production server (DATA_BACKEND=supabase) never loads it.
import type { PGlite } from "@electric-sql/pglite";
import { readdir, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Db, Tx } from "./types";

/**
 * Mock backend: the real Postgres schema on PGlite (D1). Applies
 * supabase/mock/auth_stub.sql, then every file in supabase/migrations/ in name
 * order, each once. Applied files are tracked in mock_meta.applied (a schema
 * outside public, so "every public table has RLS" stays true).
 *
 * Mock-only steps (MOCK_STEPS) run after the stub and before the migrations,
 * also tracked once. They exist for state that is not part of the Supabase
 * schema, or that an older .data/pglite (built from an older stub) lacks.
 */

export interface MockDb extends Db {
  /** Raw PGlite handle, for tests. */
  readonly raw: PGlite;
  /**
   * Mock only: runs as the database owner with no role switch. Mock auth uses
   * it to create auth.users rows, because the stub does not grant that table
   * to service_role. Not part of the Db interface.
   */
  withAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface MockDbOptions {
  /** Directory for on-disk data. Omit or null for in-memory (tests). */
  dataDir?: string | null;
  /** Directory holding mock/ and migrations/. Defaults to <cwd>/supabase. */
  supabaseDir?: string;
}

type PgTx = Parameters<Parameters<PGlite["transaction"]>[0]>[0];

function wrap(t: PgTx): Tx {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const res = await t.query<T>(sql, params);
      return res.rows;
    },
  };
}

/**
 * Mock-only SQL, applied once each and recorded in mock_meta.applied.
 * - auth_users_email: an older .data/pglite applied a stub without auth.users.email.
 */
const MOCK_STEPS: { name: string; sql: string }[] = [
  {
    name: "mock/auth_users_email",
    sql: "alter table auth.users add column if not exists email text unique;",
  },
];

async function applyAll(pg: PGlite, supabaseDir: string): Promise<void> {
  await pg.exec(`
    create schema if not exists mock_meta;
    create table if not exists mock_meta.applied (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
  const done = new Set(
    (await pg.query<{ name: string }>("select name from mock_meta.applied")).rows.map(
      (r) => r.name,
    ),
  );

  const runStep = async (name: string, getSql: () => Promise<string>) => {
    if (done.has(name)) return;
    const sql = await getSql();
    await pg.transaction(async (t) => {
      await t.exec(sql);
      await t.query("insert into mock_meta.applied (name) values ($1)", [name]);
    });
    done.add(name);
  };
  const fromFile = (file: string) => () => readFile(/*turbopackIgnore: true*/ file, "utf8");

  // Order: stub, then the mock-only steps, then the migrations.
  await runStep("mock/auth_stub.sql", fromFile(path.join(supabaseDir, "mock", "auth_stub.sql")));
  for (const step of MOCK_STEPS) await runStep(step.name, async () => step.sql);

  const migDir = path.join(supabaseDir, "migrations");
  const migrations = (await readdir(/*turbopackIgnore: true*/ migDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) {
    await runStep(`migrations/${f}`, fromFile(path.join(migDir, f)));
  }
}

export async function createMockDb(opts: MockDbOptions = {}): Promise<MockDb> {
  const supabaseDir = opts.supabaseDir ?? path.join(process.cwd(), "supabase");
  const { PGlite } = await import("@electric-sql/pglite");
  let pg: PGlite;
  if (opts.dataDir) {
    await mkdir(path.dirname(opts.dataDir), { recursive: true });
    pg = new PGlite(opts.dataDir);
  } else {
    pg = new PGlite();
  }
  await pg.waitReady;
  await applyAll(pg, supabaseDir);

  return {
    raw: pg,
    async withUser(userId, fn) {
      return pg.transaction(async (t) => {
        await t.query("set local role authenticated");
        await t.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
        return fn(wrap(t));
      });
    },
    async withService(fn) {
      return pg.transaction(async (t) => {
        await t.query("set local role service_role");
        return fn(wrap(t));
      });
    },
    async withAdmin(fn) {
      return pg.transaction(async (t) => fn(wrap(t)));
    },
    async close() {
      await pg.close();
    },
  };
}

// One instance per process, kept on globalThis so Next dev hot reload does not
// open a second PGlite on the same directory.
const g = globalThis as unknown as { __postmitraMockDb?: Promise<MockDb> };

export function getMockDb(): Promise<MockDb> {
  if (!g.__postmitraMockDb) {
    const p = createMockDb({ dataDir: path.join(process.cwd(), ".data", "pglite") });
    g.__postmitraMockDb = p;
    // A failed start must not be cached forever.
    p.catch(() => {
      if (g.__postmitraMockDb === p) g.__postmitraMockDb = undefined;
    });
  }
  return g.__postmitraMockDb;
}

/** Tests only: use this instance as the process-wide mock database. */
export function setMockDbForTests(db: MockDb | null): void {
  g.__postmitraMockDb = db ? Promise.resolve(db) : undefined;
}
