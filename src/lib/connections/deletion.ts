// Meta's two callbacks (required for App Review, C-25):
//  - Deauthorize: the person removed our app. Their connections are marked revoked and their tokens deleted.
//  - Data deletion: the person asked Meta to delete their data. Their connections and tokens are deleted, a
//    receipt row (public.deletion_requests: platform account id + random code, no brand, no user) is written, and
//    we answer { url, confirmation_code } as Meta requires. The code opens the public status page /meta/deletion/[code].
//
// Both receive a form-encoded `signed_request`: base64url(HMAC-SHA256 signature) + "." + base64url(JSON payload),
// signed with the app secret. Anything that does not verify is refused and changes nothing.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import type { Provider } from "@/lib/queue/types";
import { appSecrets, appUrl } from "./config";
import { PLATFORM_USER_TAG } from "./service";

export interface SignedRequest {
  userId: string;
  /** Which of our apps signed it. */
  provider: Provider;
}

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Verifies the HMAC with each app secret we have; null when it does not verify or is malformed. */
export function parseSignedRequest(signed: string | null | undefined): SignedRequest | null {
  if (!signed || signed.length > 4000) return null;
  const parts = signed.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [sigPart, payloadPart] = parts;
  let sig: Buffer;
  let payload: unknown;
  try {
    sig = b64urlDecode(sigPart);
    payload = JSON.parse(b64urlDecode(payloadPart).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.algorithm !== "string" || p.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
  const userId = typeof p.user_id === "string" ? p.user_id : typeof p.user_id === "number" ? String(p.user_id) : null;
  if (!userId || !/^[0-9A-Za-z_.-]{1,64}$/.test(userId)) return null;
  for (const { provider, secret } of appSecrets()) {
    const expected = createHmac("sha256", secret).update(payloadPart).digest();
    if (expected.length === sig.length && timingSafeEqual(expected, sig)) return { userId, provider };
  }
  return null;
}

/** Builds a signed_request. Used by tests and by nothing else. */
export function signRequestForTests(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", issued_at: 1_700_000_000, ...payload }), "utf8").toString("base64url");
  return `${createHmac("sha256", secret).update(body).digest("base64url")}.${body}`;
}

const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const isDeletionCode = (v: string) => CODE_RE.test(v);

/** Connections of this platform person: the user id Meta knows them by, else their account id (older rows: the scopes tag). */
const MATCH = `(platform_user_id = $1 or account_id = $1 or scopes @> array[$2]::text[])`;

/** Deauthorize: revoke and drop tokens. Returns how many connections were affected. */
export async function handleDeauthorize(req: SignedRequest): Promise<number> {
  return getDb().withService(async (tx) => {
    const rows = await tx.query<{ id: string }>(`select id::text as id from public.channel_connections where ${MATCH}`, [req.userId, `${PLATFORM_USER_TAG}${req.userId}`]);
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    await tx.query("delete from public.channel_tokens where connection_id = any($1::uuid[])", [ids]);
    await tx.query("update public.channel_connections set status = 'revoked', last_error = null, expires_at = null, updated_at = now() where id = any($1::uuid[])", [ids]);
    return ids.length;
  });
}

/** Data deletion: delete connections and tokens, record the receipt, return what Meta wants back. */
export async function handleDataDeletion(req: SignedRequest): Promise<{ url: string; confirmation_code: string }> {
  const code = randomBytes(18).toString("base64url"); // 24 characters
  await getDb().withService(async (tx) => {
    const rows = await tx.query<{ id: string; provider: Provider }>(
      `select id::text as id, provider from public.channel_connections where ${MATCH}`,
      [req.userId, `${PLATFORM_USER_TAG}${req.userId}`],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await tx.query("delete from public.channel_tokens where connection_id = any($1::uuid[])", [ids]);
      await tx.query("delete from public.channel_connections where id = any($1::uuid[])", [ids]);
    }
    await tx.query(
      `insert into public.deletion_requests (code, provider, account_id, status, done_at) values ($1, $2, $3, 'done', now())`,
      [code, rows[0]?.provider ?? req.provider, req.userId],
    );
  });
  return { url: `${appUrl()}/meta/deletion/${code}`, confirmation_code: code };
}

export interface DeletionStatus {
  status: "received" | "done";
  createdAt: string;
  doneAt: string | null;
}

/** For the public status page. Shows nothing about the account. */
export async function getDeletionStatus(code: string): Promise<DeletionStatus | null> {
  if (!isDeletionCode(code)) return null;
  const rows = await getDb().withService((tx) =>
    tx.query<{ status: "received" | "done"; created_at: Date | string; done_at: Date | string | null }>(
      "select status, created_at, done_at from public.deletion_requests where code = $1",
      [code],
    ),
  );
  const r = rows[0];
  return r ? { status: r.status, createdAt: new Date(r.created_at).toISOString(), doneAt: r.done_at ? new Date(r.done_at).toISOString() : null } : null;
}
