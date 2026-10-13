import type { MockDb } from "@/lib/db/mock";
import type { SeededAccount } from "./seed";

/**
 * For each public table, the SQL conditions that tie a row to an account, found from the database
 * itself (information_schema and the catalog), so a table added later is covered without editing
 * this file. $1 = brand id, $2 = user id, $3 = email.
 *   - any column named brand_id
 *   - brands.id
 *   - any column that references auth.users (profiles.id, brand_members.user_id, created_by ...)
 *   - email_log.to_email (sign-in emails carry only the address)
 */
export async function accountRules(db: MockDb): Promise<{ rules: Map<string, string[]>; allTables: string[] }> {
  return db.withAdmin(async (tx) => {
    const tables = (
      await tx.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
      )
    ).map((r) => r.table_name);
    const rules = new Map<string, string[]>(tables.map((t) => [t, []]));
    const add = (t: string, cond: string) => {
      const list = rules.get(t);
      if (list && !list.includes(cond)) list.push(cond);
    };
    const brandCols = await tx.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'brand_id'",
    );
    for (const r of brandCols) add(r.table_name, "brand_id = $1");
    add("brands", "id = $1");
    const userCols = await tx.query<{ tbl: string; col: string }>(
      `select cl.relname as tbl, a.attname as col
         from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
         join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f' and c.confrelid = 'auth.users'::regclass`,
    );
    for (const r of userCols) add(r.tbl, `"${r.col}" = $2`);
    add("email_log", "lower(to_email) = lower($3)");
    return { rules, allTables: tables };
  });
}

/** Rows belonging to the account in every public table. */
export async function accountRowCounts(db: MockDb, a: Pick<SeededAccount, "brandId" | "userId" | "email">): Promise<Record<string, number>> {
  const { rules } = await accountRules(db);
  const out: Record<string, number> = {};
  await db.withAdmin(async (tx) => {
    for (const [table, conds] of rules) {
      if (conds.length === 0) continue;
      // Number only the parameters this table's conditions use (the driver wants an exact match).
      const values = [a.brandId, a.userId, a.email];
      const used = [1, 2, 3].filter((i) => conds.some((c) => c.includes(`$${i}`)));
      const where = conds.map((c) => c.replace(/\$(\d)/g, (_m, d: string) => `$${used.indexOf(Number(d)) + 1}`)).join(" or ");
      const [r] = await tx.query<{ n: number }>(
        `select count(*)::int as n from public."${table}" where ${where}`,
        used.map((i) => values[i - 1]),
      );
      out[table] = r.n;
    }
  });
  return out;
}

export async function authUserExists(db: MockDb, userId: string): Promise<boolean> {
  const rows = await db.withAdmin((tx) => tx.query("select 1 from auth.users where id = $1", [userId]));
  return rows.length > 0;
}

export async function newUser(db: MockDb, email: string): Promise<string> {
  return db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    await tx.query("insert into public.profiles (id, email, consent_at) values ($1, $2, now())", [u.id, email]);
    return u.id;
  });
}
