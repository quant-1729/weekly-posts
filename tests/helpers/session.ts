import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { signSession as signSessionToken } from "@/lib/auth/session";

/**
 * Test stand-in for signSession for tests that put a session cookie in a fake cookie jar and then call code that
 * reads getCurrentUser(): a session cookie now carries `sid`, the id of a live user_sessions row, so this inserts
 * that row (for the user, in the current mock database) and signs the cookie with its id. For a user that does not
 * exist the row cannot be made and the cookie gets a random sid, so that user is signed out, as in production.
 */
export async function signSession(user: { id: string; email: string }, nowMs?: number): Promise<string> {
  let sid: string = randomUUID();
  try {
    const [row] = await getDb().withService((tx) =>
      tx.query<{ id: string }>("insert into public.user_sessions (user_id) values ($1) returning id::text as id", [user.id]),
    );
    sid = row.id;
  } catch {
    // no such user
  }
  return signSessionToken({ ...user, sid }, nowMs);
}

/** A cookie for tests that never read the database (the proxy checks only the signature). */
export function signSessionNoRow(user: { id: string; email: string }, nowMs?: number): Promise<string> {
  return signSessionToken({ ...user, sid: randomUUID() }, nowMs);
}
