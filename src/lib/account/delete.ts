import { createHmac } from "node:crypto";
import { getDb } from "@/lib/db";
import { getMockDb } from "@/lib/db/mock";
import { getEnv } from "@/lib/env";
import { BUCKETS, getStorage, type Storage } from "@/lib/storage";

/**
 * Account deletion (Req 22, AC 22): removes every row and every stored file of the account.
 *
 * Order, so that a failure never leaves files that nothing points to:
 *   1. find the brands where this user is the only member (and brands nobody belongs to that they made);
 *   2. delete every storage object under `{brand_id}/` in every bucket. If this fails, stop: the
 *      rows are still there, so a retry finds the same brands and finishes;
 *   3. in one transaction: delete those brand rows (this cascades every brand table), take the
 *      user out of brands shared with others (and hand those brands' `created_by` to another
 *      member), clear the remaining references to the user, delete email_log rows for the user;
 *   4. delete the auth user (the profile cascades).
 * Every step is safe to repeat, so a failed delete is finished by running it again.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export class AccountDeleteError extends Error {
  constructor(
    public readonly stage: "storage" | "database" | "user",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AccountDeleteError";
  }
}

export interface DeleteAccountResult {
  /** True when the auth user existed and was deleted by this call. False on a re-run that found nothing. */
  deleted: boolean;
  brandsDeleted: number;
  membershipsRemoved: number;
  objectsRemoved: number;
}

/** A short, one-way id for the audit line. Not the user id, and not reversible without AUTH_SECRET. */
export function auditId(userId: string): string {
  return createHmac("sha256", getEnv().authSecret).update(`account-delete:${userId}`).digest("hex").slice(0, 16);
}

/** Deletes the auth user. Mock: the owner connection (the stub does not grant auth.users to service_role). */
async function deleteAuthUser(userId: string): Promise<boolean> {
  if (getEnv().dataBackend === "mock") {
    const mock = await getMockDb();
    const gone = await mock.withAdmin((tx) =>
      tx.query("delete from auth.users where id = $1 returning id", [userId]),
    );
    return gone.length > 0;
  }
  // Supabase: will call the Auth admin API (auth.admin.deleteUser) with the service role key.
  throw new Error("Supabase admin API not configured yet");
}

export async function deleteAccount(
  userId: string,
  opts: { storage?: Storage } = {},
): Promise<DeleteAccountResult> {
  if (!UUID_RE.test(userId)) throw new Error("Invalid user id");
  const db = getDb();

  // 1. Which brands go, which are only left.
  const plan = await db.withService(async (tx) => {
    const [profile] = await tx.query<{ email: string | null }>("select email from public.profiles where id = $1", [userId]);
    const mine = await tx.query<{ brand_id: string; others: number }>(
      `select bm.brand_id,
              (select count(*)::int from public.brand_members o where o.brand_id = bm.brand_id and o.user_id <> $1) as others
         from public.brand_members bm
        where bm.user_id = $1`,
      [userId],
    );
    // A brand this user made that nobody belongs to any more would also block deleting the user.
    const orphans = await tx.query<{ id: string }>(
      `select b.id from public.brands b
        where b.created_by = $1 and not exists (select 1 from public.brand_members m where m.brand_id = b.id)`,
      [userId],
    );
    const sole = [...mine.filter((m) => m.others === 0).map((m) => m.brand_id), ...orphans.map((o) => o.id)];
    const shared = mine.filter((m) => m.others > 0).map((m) => m.brand_id);
    return { email: profile?.email ?? null, sole: [...new Set(sole)], shared };
  });

  // 2. Files first. A failure stops here and keeps every row.
  const storage = opts.storage ?? getStorage();
  let objectsRemoved = 0;
  for (const brandId of plan.sole) {
    for (const bucket of BUCKETS) {
      try {
        objectsRemoved += await storage.removePrefix(bucket, brandId);
      } catch (e) {
        console.error(`[account] storage delete failed for user ${auditId(userId)} in bucket ${bucket}; rows kept for a retry`);
        throw new AccountDeleteError("storage", `Could not delete files in ${bucket}`, { cause: e });
      }
    }
  }

  // 3. Rows.
  let membershipsRemoved = 0;
  try {
    await db.withService(async (tx) => {
      if (plan.sole.length > 0) {
        await tx.query("delete from public.brands where id = any($1::uuid[])", [plan.sole]);
      }

      // Brands shared with other people stay. Give `created_by` (no cascade, NOT NULL) to another member first.
      await tx.query(
        `update public.brands b
            set created_by = (
              select m.user_id from public.brand_members m
               where m.brand_id = b.id and m.user_id <> $1
               order by (m.role = 'owner') desc, m.created_at, m.user_id
               limit 1)
          where b.created_by = $1
            and exists (select 1 from public.brand_members m where m.brand_id = b.id and m.user_id <> $1)`,
        [userId],
      );
      const removed = await tx.query("delete from public.brand_members where user_id = $1 returning brand_id", [userId]);
      membershipsRemoved = removed.length;

      // Rows left behind in shared brands that name the user: keep the row, drop the name.
      const refs = await tx.query<{ tbl: string; col: string; notnull: boolean }>(
        `select cl.relname as tbl, a.attname as col, a.attnotnull as notnull
           from pg_constraint c
           join pg_class cl on cl.oid = c.conrelid
           join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
          where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype in ('a', 'r')`,
      );
      for (const r of refs) {
        if (r.notnull) continue; // brands.created_by was handled above
        if (!IDENT_RE.test(r.tbl) || !IDENT_RE.test(r.col)) throw new Error("Unexpected table or column name");
        await tx.query(`update public.${r.tbl} set ${r.col} = null where ${r.col} = $1`, [userId]);
      }

      // Emails: rows with the user id (and no brand) go when the user is deleted (on delete cascade; the tests prove it).
      // Sign-in emails carry only the address, so they are matched by it.
      if (plan.email) {
        await tx.query("delete from public.email_log where lower(to_email) = lower($1)", [plan.email]);
      }
    });
  } catch (e) {
    throw new AccountDeleteError("database", "Could not delete the account rows", { cause: e });
  }

  // 4. The user. In mock mode also forget its single-use link ids (mock sign-in only; they hold the address).
  let deleted: boolean;
  try {
    deleted = await deleteAuthUser(userId);
    if (getEnv().dataBackend === "mock" && plan.email) {
      const mock = await getMockDb();
      await mock.withAdmin((tx) => tx.query("delete from mock_meta.magic_links where lower(email) = lower($1)", [plan.email]));
    }
  } catch (e) {
    throw new AccountDeleteError("user", "Could not delete the user", { cause: e });
  }

  if (deleted) {
    // One line, nothing that names the person.
    console.info(`[account] deleted ${auditId(userId)} brands=${plan.sole.length} shared=${plan.shared.length} objects=${objectsRemoved}`);
  }
  return { deleted, brandsDeleted: plan.sole.length, membershipsRemoved, objectsRemoved };
}
