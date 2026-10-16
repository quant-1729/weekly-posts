import { db } from "../db";
import { UUID_RE } from "./common";

/**
 * Signs one device out: sets revoked_at / revoked_by = 'admin' and records who did it in public.admin_actions, in one
 * transaction. The main app treats a revoked session row as signed out on the device's next request.
 * Returns false when the session does not exist or was already signed out.
 */
export async function revokeSession(adminEmail: string, sessionId: string): Promise<boolean> {
  if (!UUID_RE.test(sessionId)) return false;
  return db().tx(async (tx) => {
    const rows = await tx.query<{ user_id: string }>(
      `update public.user_sessions
          set revoked_at = now(), revoked_by = 'admin'
        where id = $1::uuid and revoked_at is null
        returning user_id::text as user_id`,
      [sessionId],
    );
    if (rows.length === 0) return false;
    await tx.query(
      `insert into public.admin_actions (admin_email, action, target, detail)
       values ($1, 'session_revoke', $2, jsonb_build_object('user_id', $3::text))`,
      [adminEmail, sessionId, rows[0].user_id],
    );
    return true;
  });
}
