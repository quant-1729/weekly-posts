import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createMockDb, type MockDb } from "@/lib/db/mock";

const dirs: string[] = [];
const dbs: MockDb[] = [];
// Cleanup must never fail a test (H-4): PGlite can still hold files under load, so retry, then give up quietly.
async function removeDir(d: string) {
  try {
    await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(`[mock-steps] temp dir left behind: ${d} (${(err as Error).message})`);
  }
}
afterEach(async () => {
  for (const d of dbs.splice(0)) {
    try {
      await d.close();
    } catch (err) {
      console.warn(`[mock-steps] close failed: ${(err as Error).message}`);
    }
  }
  for (const d of dirs.splice(0)) await removeDir(d);
});

describe("mock-only steps", () => {
  // Runs applying every migration under full-suite load can exceed the 30 s default (H-4).
  it("add auth.users.email to a database that applied the older stub, once, without losing data", { timeout: 90_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pglite-"));
    dirs.push(root);
    const dataDir = path.join(root, "pglite");

    // Build a database the way the old runner did: the stub WITHOUT the email column,
    // recorded as applied, and every migration up to 0004 (before 0005 needs email).
    const supabaseDir = path.join(process.cwd(), "supabase");
    const stub = (await readFile(path.join(supabaseDir, "mock", "auth_stub.sql"), "utf8")).replace(
      /^\s*email\s+text unique,\r?\n/m,
      "",
    );
    expect(stub).not.toMatch(/email\s+text/);
    const old = new PGlite(dataDir);
    await old.waitReady;
    await old.exec(`create schema mock_meta; create table mock_meta.applied (name text primary key, applied_at timestamptz not null default now());`);
    await old.exec(stub);
    await old.query("insert into mock_meta.applied (name) values ('mock/auth_stub.sql')");
    await old.exec("insert into auth.users (phone) values ('+919876543210')");
    await old.close();

    const db = await createMockDb({ dataDir });
    dbs.push(db);
    const cols = await db.withAdmin((tx) =>
      tx.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users'",
      ),
    );
    expect(cols.map((c) => c.column_name)).toContain("email");
    // The old row survived, and email is unique.
    expect(await db.withAdmin((tx) => tx.query("select id from auth.users where phone = '+919876543210'"))).toHaveLength(1);
    await db.withAdmin((tx) => tx.query("insert into auth.users (email) values ('x@example.com')"));
    await expect(
      db.withAdmin((tx) => tx.query("insert into auth.users (email) values ('x@example.com')")),
    ).rejects.toThrow();

    const applied = await db.withAdmin((tx) =>
      tx.query<{ name: string }>("select name from mock_meta.applied order by name"),
    );
    expect(applied.map((a) => a.name)).toEqual(
      expect.arrayContaining(["mock/auth_users_email", "migrations/0012_magic_links.sql"]),
    );

    // Opening it again applies nothing twice.
    await db.close();
    dbs.pop();
    const again = await createMockDb({ dataDir });
    dbs.push(again);
    const n = await again.withAdmin((tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from mock_meta.applied where name like 'mock/%'"),
    );
    expect(n[0].n).toBe(2); // the stub and mock/auth_users_email (magic_links is a normal migration now)
  });

  it("a fresh database has the magic_links table in public only (no mock-only copy)", async () => {
    const db = await createMockDb();
    dbs.push(db);
    const rows = await db.withAdmin((tx) =>
      tx.query<{ table_schema: string; table_name: string }>(
        "select table_schema, table_name from information_schema.tables where table_name = 'magic_links'",
      ),
    );
    expect(rows).toEqual([{ table_schema: "public", table_name: "magic_links" }]);
  });
});
