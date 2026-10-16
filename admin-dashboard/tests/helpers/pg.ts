import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Executor, Tx } from "@/lib/db";

// The real schema: the main app's mock auth stub plus every migration, applied on PGlite.
const SUPABASE_DIR = path.resolve(__dirname, "..", "..", "..", "supabase");

/** PGlite hands back bigint columns as BigInt; node-postgres (configured in src/lib/db.ts) hands back numbers. */
function normalise<T>(rows: unknown[]): T[] {
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) o[k] = typeof v === "bigint" ? Number(v) : v;
    return o as T;
  });
}

export interface TestDb {
  pg: PGlite;
  executor: Executor;
  /** Every SQL text sent through the executor, in order. */
  seen: string[];
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(await readFile(path.join(SUPABASE_DIR, "mock", "auth_stub.sql"), "utf8"));
  const migDir = path.join(SUPABASE_DIR, "migrations");
  for (const f of (await readdir(migDir)).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.exec(await readFile(path.join(migDir, f), "utf8"));
  }
  const seen: string[] = [];
  const wrap = (q: { query: PGlite["query"] }): Tx => ({
    async query<T>(sql: string, params?: unknown[]) {
      seen.push(sql);
      const res = await q.query(sql, params);
      return normalise<T>(res.rows);
    },
  });
  const executor: Executor = {
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t as unknown as { query: PGlite["query"] }))),
  };
  return { pg, executor, seen, close: () => pg.close() };
}

export interface Seed {
  userA: string;
  userB: string;
  brandA: string;
  sessionA1: string;
  sessionA2: string;
  sessionB1: string;
}

/** A small world with deliberately sensitive text in the columns the dashboard must never read. */
export const SECRETS = {
  notes: "SECRET-NOTES-owner-wrote-this",
  caption: "SECRET-CAPTION-text-of-the-post",
  description: "SECRET-DESCRIPTION-of-the-face",
  subject: "SECRET-EMAIL-SUBJECT",
  userAgent: "SECRET-UA Mozilla/5.0",
  ipHash: "SECRET-IPHASH",
  phone: "+919999900000",
  payment: "secret-upi@bank",
  focus: "SECRET-RESEARCH-FOCUS",
};

export async function seed(pg: PGlite): Promise<Seed> {
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
  const [a] = await q<{ id: string }>("insert into auth.users (email) values ('alice@gmail.com') returning id");
  const [b] = await q<{ id: string }>("insert into auth.users (email) values ('bob@example.org') returning id");
  await q("insert into public.profiles (id, email, phone, display_name, consent_at) values ($1, 'alice@gmail.com', $2, 'Alice', now())", [a.id, SECRETS.phone]);
  await q("insert into public.profiles (id, email, consent_at) values ($1, 'bob@example.org', now())", [b.id]);
  const [brand] = await q<{ id: string }>("insert into public.brands (name, created_by) values ('Alice Bakery', $1) returning id", [a.id]);
  await q("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'owner')", [brand.id, a.id]);
  await q("update public.profiles set last_brand_id = $1 where id = $2", [brand.id, a.id]);

  const sess = async (user: string, device: string, lastSeen: string, country: string, revoked = false) =>
    (
      await q<{ id: string }>(
        `insert into public.user_sessions (user_id, device_type, browser, os, country, city, user_agent, ip_hash, last_seen_at, revoked_at, revoked_by)
         values ($1, $2, 'Chrome', 'Windows', $3, 'Pune', $4, $5, $6::timestamptz, $7, $8) returning id`,
        [user, device, country, SECRETS.userAgent, SECRETS.ipHash, lastSeen, revoked ? new Date().toISOString() : null, revoked ? "user" : null],
      )
    )[0].id;
  const sessionA1 = await sess(a.id, "desktop", new Date().toISOString(), "IN");
  const sessionA2 = await sess(a.id, "mobile", "2026-01-01T10:00:00Z", "IN", true);
  const sessionB1 = await sess(b.id, "tablet", "2026-02-01T10:00:00Z", "GB");

  await q("insert into public.app_events (user_id, brand_id, kind, ok, detail) values ($1, $2, 'auth.sign_in', true, '{\"via\":\"link\"}')", [a.id, brand.id]);
  await q("insert into public.app_events (user_id, brand_id, kind, ok, detail) values ($1, $2, 'design.generated', false, '{\"caption\":\"SECRET-DETAIL\",\"code\":\"E42\"}')", [a.id, brand.id]);
  await q("insert into public.usage_events (brand_id, user_id, kind, usd, model) values ($1, $2, 'generate', 0.0123, 'gemini-test')", [brand.id, a.id]);
  await q("insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, 'image', 0.04)", [brand.id, a.id]); // an older row: model is null
  await q("insert into public.usage_events (brand_id, user_id, kind, usd, model, ok) values ($1, $2, 'generate', 0, 'gemini-test', false)", [brand.id, a.id]);

  const [brief] = await q<{ id: string }>(
    "insert into public.post_briefs (brand_id, post_type, extra_post_types, notes, created_by) values ($1, 'offer', '{event,hiring}', $2, $3) returning id",
    [brand.id, SECRETS.notes, a.id],
  );
  const [post] = await q<{ id: string }>(
    "insert into public.posts (brand_id, created_by, brief_id, input_type, status, post_code, channel, caption, approved_at) values ($1, $2, $3, 'text', 'draft', 'abc123', 'instagram', $4, now()) returning id",
    [brand.id, a.id, brief.id, SECRETS.caption],
  );
  await q(
    "insert into public.queue_items (post_id, brand_id, channel, slot_at, status, mode, attempts, last_error, permalink) values ($1, $2, 'instagram', now(), 'failed', 'publish', 2, 'Graph error for https://graph.facebook.com/v1?access_token=EAAB1234567890123456789012345678901234', 'https://instagram.com/p/xyz')",
    [post.id, brand.id],
  );
  await q("insert into public.research_runs (brand_id, trigger, status, window_start, window_end, focus) values ($1, 'manual', 'done', current_date - 7, current_date, $2)", [brand.id, SECRETS.focus]);
  await q("insert into public.brand_faces (brand_id, kind, name, description, status, created_cost_usd, created_by) values ($1, 'mascot', 'Mochi', $2, 'approved', 0.2, $3)", [brand.id, SECRETS.description, a.id]);
  await q("insert into public.email_log (brand_id, user_id, kind, to_email, subject, status) values ($1, $2, 'weekly', 'alice@gmail.com', $3, 'sent')", [brand.id, a.id, SECRETS.subject]);
  return { userA: a.id, userB: b.id, brandA: brand.id, sessionA1, sessionA2, sessionB1 };
}
