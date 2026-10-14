// The only place (with the refresh job and disconnect, which call it) that reads a token back. Server only.

import { getDb } from "@/lib/db";
import type { Provider } from "@/lib/queue/types";
import { decryptToken, tokenAad } from "./crypto";
import { ConnectionError } from "./types";

/** Decrypts the stored token of a connection. Throws ConnectionError('no_token') or TokenKeyError; never logs the token. */
export async function readToken(conn: { id: string; brandId: string; provider: Provider }): Promise<string> {
  const rows = await getDb().withService((tx) =>
    tx.query<{ ciphertext: string; iv: string; tag: string; key_version: number }>(
      "select ciphertext, iv, tag, key_version from public.channel_tokens where connection_id = $1 and brand_id = $2",
      [conn.id, conn.brandId],
    ),
  );
  const r = rows[0];
  if (!r) throw new ConnectionError("no_token");
  return decryptToken({ ciphertext: r.ciphertext, iv: r.iv, tag: r.tag, keyVersion: Number(r.key_version) }, tokenAad(conn.brandId, conn.provider));
}
