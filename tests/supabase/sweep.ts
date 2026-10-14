import "./env";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseStorage } from "@/lib/storage/supabase";
import { BUCKETS } from "@/lib/storage/types";

/**
 * Cleanup for the integration tests. Everything the tests create is recognisable:
 *   - auth users: it-<random>@example.com
 *   - brands: name starts with "it-"
 *   - stored files: the first path segment (the brand id) starts with NS
 * so a sweep can also remove what a crashed earlier run left behind.
 */

/** Hex-looking prefix that marks a test brand id, e.g. 17e57007-xxxx-... */
export const NS = "17e57007";
export const IT_EMAIL = /^it-[a-z0-9]+@example\.com$/i;

export const randomId = () => randomUUID().replace(/-/g, "").slice(0, 12);
export const itEmail = () => `it-${randomId()}@example.com`;
/** A brand id inside the test namespace. */
export const testBrandId = () => randomUUID().replace(/^[0-9a-f]{8}/, NS);

// One connection for all the cleanup queries (opening one over the pooler takes seconds).
let raw: pg.Client | null = null;

export async function withRawDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  if (!raw) {
    const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    raw = c;
  }
  const c = raw;
  try {
    return await fn(c);
  } catch (e) {
    await c.query("rollback").catch(() => undefined); // never leave the shared connection in an aborted transaction
    throw e;
  }
}

export async function closeRawDb(): Promise<void> {
  const c = raw;
  raw = null;
  if (c) await c.end();
}

export async function listItUsers(): Promise<{ id: string; email: string }[]> {
  const admin = getSupabaseAdmin();
  const out: { id: string; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) if (u.email && IT_EMAIL.test(u.email)) out.push({ id: u.id, email: u.email.toLowerCase() });
    if (data.users.length < 200) return out;
  }
}

export interface PurgeTargets {
  userIds?: string[];
  emails?: string[];
  brandIds?: string[];
}

/** Removes the named test users, their brands, files and rows. Safe to repeat. */
export async function purge(t: PurgeTargets): Promise<void> {
  const emails = [...new Set((t.emails ?? []).map((e) => e.toLowerCase()))];
  const brandIds = new Set(t.brandIds ?? []);
  const ids = new Set(t.userIds ?? []);
  // Users made by the sign-in flow are found by address.
  if (emails.length > 0) {
    await withRawDb(async (c) => {
      await c.query("begin");
      await c.query("set local role service_role");
      const r = await c.query<{ id: string | null }>("select public.auth_user_id_by_email(e) as id from unnest($1::text[]) as e", [emails]);
      for (const row of r.rows) if (row.id) ids.add(row.id);
      await c.query("commit");
    });
  }
  const userIds = [...ids];

  await withRawDb(async (c) => {
    await c.query("begin");
    await c.query("set local role service_role");
    const found = await c.query<{ id: string }>(
      "select id from public.brands where created_by = any($1::uuid[]) or id in (select brand_id from public.brand_members where user_id = any($1::uuid[]))",
      [userIds],
    );
    for (const r of found.rows) brandIds.add(r.id);
    await c.query("commit");
  });

  const storage = createSupabaseStorage();
  for (const brandId of brandIds) for (const bucket of BUCKETS) await storage.removePrefix(bucket, brandId);

  await withRawDb(async (c) => {
    await c.query("begin");
    await c.query("set local role service_role");
    await c.query("delete from public.magic_links where lower(email) = any($1::text[])", [emails]);
    await c.query("delete from public.email_log where lower(to_email) = any($1::text[]) or user_id = any($2::uuid[])", [emails, userIds]);
    // The brand rows (every brand table cascades). Not the brands of other, real users.
    await c.query("delete from public.brands where id = any($1::uuid[])", [[...brandIds]]);
    await c.query("commit");
  });

  const admin = getSupabaseAdmin();
  for (const id of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && error.status !== 404) throw new Error(`deleteUser failed: ${error.message}`);
  }
}

/** Removes everything the tests could have left, including leftovers from a crashed run. */
export async function sweepAll(): Promise<void> {
  const users = await listItUsers();
  const named = await withRawDb((c) =>
    c.query<{ id: string }>("select id from public.brands where name like 'it-%'").then((r) => r.rows.map((x) => x.id)),
  );
  await purge({ userIds: users.map((u) => u.id), emails: users.map((u) => u.email), brandIds: named });

  // Files under test-namespace brand ids whose brand row never existed (storage-only tests).
  const storage = createSupabaseStorage();
  const names = await withRawDb((c) =>
    c.query<{ b: string; id: string }>(
      "select bucket_id as b, split_part(name, '/', 1) as id from storage.objects where name like $1 group by 1, 2",
      [`${NS}-%`],
    ).then((r) => r.rows),
  );
  for (const { b, id } of names) await storage.removePrefix(b as (typeof BUCKETS)[number], id);
  // Magic links of leftover test addresses.
  await withRawDb((c) => c.query("delete from public.magic_links where email ~* '^it-[a-z0-9]+@example\.com$'"));
}

export interface Leftovers {
  authUsers: number;
  brands: number;
  magicLinks: number;
  storageObjects: number;
}

export async function leftovers(): Promise<Leftovers> {
  const authUsers = (await listItUsers()).length;
  const rows = await withRawDb(async (c) => {
    const brands = await c.query("select count(*)::int as n from public.brands where name like 'it-%'");
    const links = await c.query("select count(*)::int as n from public.magic_links where email ~* '^it-[a-z0-9]+@example\.com$'");
    const objs = await c.query("select count(*)::int as n from storage.objects where name like $1", [`${NS}-%`]);
    return { brands: brands.rows[0].n, magicLinks: links.rows[0].n, storageObjects: objs.rows[0].n };
  });
  return { authUsers, ...rows };
}
