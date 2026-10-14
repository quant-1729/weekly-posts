import { getDb } from "@/lib/db";
import { getSupabaseAdmin } from "./admin";

/**
 * Auth users on Supabase. service_role cannot read auth.users, so lookups go through
 * public.auth_user_id_by_email (migration 0012); creating and deleting go through the
 * Auth admin API. Server only.
 */

async function lookup(email: string): Promise<string | null> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ id: string | null }>("select public.auth_user_id_by_email($1) as id", [email]),
  );
  return row?.id ?? null;
}

/** The id of the user with this address, created (already confirmed) if it does not exist. */
export async function findOrCreateSupabaseUser(email: string): Promise<string> {
  const existing = await lookup(email);
  if (existing) return existing;

  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({ email, email_confirm: true });
  if (data?.user) return data.user.id;

  // Two first clicks at once (or a user made a moment ago): the address now exists, so find it.
  const raced = await lookup(email);
  if (raced) return raced;
  throw new Error(`Could not create the user: ${error?.message ?? "unknown error"}`);
}

/** Deletes the user (foreign keys cascade). False when there was no such user. */
export async function deleteSupabaseUser(userId: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(userId);
  if (!error) return true;
  if (error.status === 404 || /not.?found/i.test(`${error.code ?? ""} ${error.message}`)) return false;
  throw new Error(`Could not delete the user: ${error.message}`);
}
