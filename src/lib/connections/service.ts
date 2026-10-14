// Connections store (C-25). Members read the public part (RLS: select only); every write runs as the service
// role AFTER the server has checked that the signed-in user owns the brand. Tokens are encrypted before they
// reach the database and are read back only by ./tokens.ts.

import { APP_NAME } from "@/lib/app";
import { getDb } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/links/format";
import { upgradeQueuedToPublish } from "@/lib/queue/connection-hook";
import { PROVIDERS, type Provider } from "@/lib/queue/types";
import { connectionCopy } from "./copy";
import { appUrl } from "./config";
import { encryptToken, tokenAad } from "./crypto";
import type { FetchLike } from "./graph";
import { revokeAtMeta } from "./revoke";
import { readToken } from "./tokens";
import { ConnectionError, REFRESH_WINDOW_DAYS, type ConnectionStatus, type ConnectionView } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Older rows kept the Meta user id as a scopes entry with this prefix; deletion callbacks still read it. */
export const PLATFORM_USER_TAG = "meta_user:";

interface Row {
  id: string;
  brand_id: string;
  provider: Provider;
  account_id: string;
  account_name: string | null;
  status: ConnectionStatus;
  expires_at: Date | string | null;
  last_error: string | null;
  connected_at: Date | string;
}
const COLUMNS = "id::text as id, brand_id::text as brand_id, provider, account_id, account_name, status, expires_at, last_error, connected_at";
const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

export function toView(r: Row, now: Date = new Date()): ConnectionView {
  const expiresAt = iso(r.expires_at);
  return {
    id: r.id,
    brandId: r.brand_id,
    provider: r.provider,
    accountId: r.account_id,
    accountName: r.account_name,
    status: r.status,
    expiresAt,
    lastError: r.last_error,
    connectedAt: iso(r.connected_at)!,
    expiresSoon: r.status === "active" && expiresAt !== null && new Date(expiresAt).getTime() - now.getTime() < REFRESH_WINDOW_DAYS * DAY_MS,
  };
}

/** Throws ConnectionError('not_owner') unless the signed-in user is an owner of the brand (the database decides). */
export async function requireBrandOwner(userId: string, brandId: string): Promise<void> {
  if (!UUID_RE.test(brandId)) throw new ConnectionError("not_owner");
  const rows = await getDb().withUser(userId, (tx) => tx.query<{ ok: boolean }>("select public.is_brand_owner($1::uuid) as ok", [brandId]));
  if (!rows[0]?.ok) throw new ConnectionError("not_owner");
}

/** The brand's connections, newest first. Runs as the user, so row-level security decides. Revoked ones are left out. */
export async function listConnections(userId: string, brandId: string, now: Date = new Date()): Promise<ConnectionView[]> {
  if (!UUID_RE.test(brandId)) return [];
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.channel_connections where brand_id = $1 and status <> 'revoked' order by connected_at desc`, [brandId]),
  );
  return rows.map((r) => toView(r, now));
}

/** The connection the publisher uses (service role): any status, so it can tell "expired" from "never connected". */
export async function getConnection(brandId: string, provider: Provider): Promise<ConnectionView | null> {
  const rows = await getDb().withService((tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.channel_connections where brand_id = $1 and provider = $2`, [brandId, provider]),
  );
  return rows[0] ? toView(rows[0]) : null;
}

export interface SaveConnectionInput {
  brandId: string;
  userId: string;
  provider: Provider;
  accountId: string;
  accountName: string | null;
  scopes: readonly string[];
  /** The id Meta sends for this person in deauthorize and data-deletion requests (stored in platform_user_id). */
  platformUserId: string | null;
  expiresAt: Date | null;
  /** Plain token: encrypted here and not kept anywhere else. */
  token: string;
}

const UPSERT_TOKEN = `insert into public.channel_tokens (connection_id, brand_id, ciphertext, iv, tag, key_version, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (connection_id) do update set ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag, key_version = excluded.key_version, updated_at = now()`;

/** Creates or replaces the brand's connection for the provider and stores its encrypted token. The caller has checked ownership. */
export async function saveConnection(input: SaveConnectionInput): Promise<ConnectionView> {
  const enc = encryptToken(input.token, tokenAad(input.brandId, input.provider));
  const row = await getDb().withService(async (tx) => {
    const [conn] = await tx.query<Row>(
      `insert into public.channel_connections (brand_id, provider, account_id, account_name, scopes, status, expires_at, last_error, connected_by, connected_at, updated_at, platform_user_id)
       values ($1, $2, $3, $4, $5::text[], 'active', $6::timestamptz, null, $7, now(), now(), $8)
       on conflict (brand_id, provider) do update set
         account_id = excluded.account_id, account_name = excluded.account_name, scopes = excluded.scopes, platform_user_id = excluded.platform_user_id, status = 'active',
         expires_at = excluded.expires_at, last_error = null, connected_by = excluded.connected_by, connected_at = now(), updated_at = now()
       returning ${COLUMNS}`,
      [input.brandId, input.provider, input.accountId.slice(0, 64), input.accountName?.slice(0, 120) ?? null, [...input.scopes], input.expiresAt?.toISOString() ?? null, input.userId, input.platformUserId?.slice(0, 64) ?? null],
    );
    await tx.query(UPSERT_TOKEN, [conn.id, input.brandId, enc.ciphertext, enc.iv, enc.tag, enc.keyVersion]);
    return conn;
  });
  // Items already queued as "we'll email it to you" for this provider's channels now publish by themselves.
  await upgradeQueuedToPublish(input.brandId, input.provider).catch((e) => console.error("[connections] could not upgrade queued items:", e instanceof Error ? e.name : "error"));
  return toView(row);
}

/** Replaces a connection's token and expiry after a refresh (service role; the refresh job is the only caller). */
export async function replaceToken(args: { connectionId: string; brandId: string; provider: Provider; token: string; expiresAt: Date | null }): Promise<void> {
  const enc = encryptToken(args.token, tokenAad(args.brandId, args.provider));
  await getDb().withService(async (tx) => {
    await tx.query(UPSERT_TOKEN, [args.connectionId, args.brandId, enc.ciphertext, enc.iv, enc.tag, enc.keyVersion]);
    await tx.query(
      `update public.channel_connections set expires_at = $2::timestamptz, status = 'active', last_error = null, updated_at = now() where id = $1`,
      [args.connectionId, args.expiresAt?.toISOString() ?? null],
    );
  });
  await upgradeQueuedToPublish(args.brandId, args.provider).catch(() => 0); // a renewed connection that had expired works again
}

// ---------------------------------------------------------------------------
// Problems: expired tokens, revoked access. The owner is emailed once per problem.
// ---------------------------------------------------------------------------

export function connectionProblemEmail(args: { provider: Provider; accountName: string | null; link: string }): { subject: string; html: string; text: string } {
  const t = connectionCopy.email;
  const intro = t.intro(args.provider, args.accountName ?? "");
  const href = escapeHtml(args.link);
  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#fafaf9;font-family:Arial,Helvetica,sans-serif;color:#1c1917;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
<tr><td>
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#E4572E;">${e(APP_NAME)}</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${e(intro)}</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${e(t.next)}</p>
<p style="margin:0 0 20px;"><a href="${href}" style="display:inline-block;background:#E4572E;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 24px;border-radius:8px;">${e(t.button)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#57534e;">${e(t.linkFallback)}</p>
<p style="margin:0;font-size:13px;word-break:break-all;"><a href="${href}" style="color:#57534e;">${href}</a></p>
</td></tr>
</table>
</body>
</html>`;
  return { subject: t.subject(args.provider), html, text: [intro, "", t.next, "", `${t.button}: ${args.link}`, ""].join("\n") };
}

/**
 * Marks an active connection as expired (or errored) and emails the brand's owners ONCE: only the call that
 * actually changes 'active' to the new status sends. Returns true when it did. Never throws for an email problem.
 */
export async function markConnectionProblem(args: { brandId: string; provider: Provider; status?: "expired" | "error"; message: string }): Promise<boolean> {
  const status = args.status ?? "expired";
  const { changed, owners, accountName } = await getDb().withService(async (tx) => {
    const rows = await tx.query<{ account_name: string | null }>(
      `update public.channel_connections set status = $3, last_error = $4, updated_at = now()
        where brand_id = $1 and provider = $2 and status = 'active' returning account_name`,
      [args.brandId, args.provider, status, args.message.slice(0, 500)],
    );
    if (rows.length === 0) return { changed: false, owners: [] as { id: string; email: string }[], accountName: null as string | null };
    const o = await tx.query<{ id: string; email: string | null }>(
      `select p.id::text as id, p.email from public.brand_members m join public.profiles p on p.id = m.user_id where m.brand_id = $1 and m.role = 'owner'`,
      [args.brandId],
    );
    return { changed: true, owners: o.filter((x): x is { id: string; email: string } => !!x.email), accountName: rows[0].account_name };
  });
  if (!changed) return false;
  let link: string;
  try {
    link = `${appUrl()}/connections`;
  } catch {
    return true;
  }
  const message = connectionProblemEmail({ provider: args.provider, accountName, link });
  for (const o of owners) {
    try {
      await sendEmail({ to: o.email, kind: "connection_problem", userId: o.id, brandId: args.brandId, ...message });
    } catch (e) {
      console.error("[connections] could not email a connection problem:", e instanceof Error ? e.name : "error");
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

/**
 * Disconnects: asks Meta to drop our access when it can (best effort), deletes the token and marks the
 * connection revoked. Owner only. Returns false when there was nothing connected.
 */
export async function disconnectChannel(args: { userId: string; brandId: string; provider: Provider; fetch?: FetchLike }): Promise<boolean> {
  if (!(PROVIDERS as readonly string[]).includes(args.provider)) return false;
  await requireBrandOwner(args.userId, args.brandId);
  const conn = await getConnection(args.brandId, args.provider);
  if (!conn || conn.status === "revoked") return false;
  try {
    const token = await readToken({ id: conn.id, brandId: conn.brandId, provider: conn.provider });
    await revokeAtMeta({ provider: conn.provider, token, fetch: args.fetch });
  } catch {
    // Best effort: a token we cannot read or Meta cannot reach must not stop the owner from disconnecting.
  }
  await getDb().withService(async (tx) => {
    await tx.query("delete from public.channel_tokens where connection_id = $1", [conn.id]);
    await tx.query("update public.channel_connections set status = 'revoked', last_error = null, expires_at = null, updated_at = now() where id = $1", [conn.id]);
  });
  return true;
}

/** True when the user is an owner of the brand (for showing or hiding buttons; the actions check again). */
export async function isBrandOwner(userId: string, brandId: string): Promise<boolean> {
  try {
    await requireBrandOwner(userId, brandId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Account deletion: asks Meta to drop our access for every connection of these brands, before the rows (and tokens)
 * are deleted. Best effort: every failure is ignored and never stops the deletion.
 */
export async function revokeBrandConnections(brandIds: readonly string[], fetch?: FetchLike): Promise<number> {
  if (brandIds.length === 0) return 0;
  const conns = await getDb().withService((tx) =>
    tx.query<{ id: string; brand_id: string; provider: Provider }>(
      "select id::text as id, brand_id::text as brand_id, provider from public.channel_connections where brand_id = any($1::uuid[]) and status = 'active'",
      [[...brandIds]],
    ),
  );
  let n = 0;
  for (const c of conns) {
    try {
      const token = await readToken({ id: c.id, brandId: c.brand_id, provider: c.provider });
      await revokeAtMeta({ provider: c.provider, token, fetch });
      n++;
    } catch {
      // ignored
    }
  }
  return n;
}
