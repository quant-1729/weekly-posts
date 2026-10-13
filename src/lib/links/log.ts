import { getDb } from "@/lib/db";
import { jtiHash, type LinkClaims } from "./tokens";

/** One console line for a brand-level link action. Never contains the token. */
export function logBrandAction(claims: LinkClaims, what: string): void {
  console.info(`[link] act=${claims.act} brand=${claims.brandId} jti=${jtiHash(claims.jti)} ${what}`.trim());
}

/** A post action done through an emailed link (docs/email-links.md: forwarded links are logged). */
export async function insertPostAction(
  claims: LinkClaims,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  if (!claims.postId) throw new Error("insertPostAction needs a token with a post id");
  await getDb().withService((tx) =>
    tx.query(
      `insert into public.post_actions (post_id, brand_id, action, via, detail, user_id)
       values ($1, $2, $3::public.post_action, 'email_link', $4::jsonb, null)`,
      [claims.postId, claims.brandId, action, JSON.stringify({ ...detail, jti_hash: jtiHash(claims.jti) })],
    ),
  );
}
