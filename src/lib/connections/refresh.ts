// Daily token refresh (C-25). Instagram long-lived tokens last 60 days and can be renewed once they are 24 hours
// old, so this renews every active one that is older than 24 hours and ends within 10 days. Facebook Page tokens
// do not expire and are not touched.
//
// A refresh that Meta refuses (token revoked, password changed, expired) marks the connection 'expired', stores
// the reason and emails the owner once (markConnectionProblem). A refresh that fails for a passing reason (Meta
// down, rate limit, a timeout) is left alone and tried again at the next run.

import { getDb } from "@/lib/db";
import type { Provider } from "@/lib/queue/types";
import { GraphError, scrub, type FetchLike } from "./graph";
import { refreshLongLived } from "./instagram";
import { markConnectionProblem, replaceToken } from "./service";
import { readToken } from "./tokens";
import { REFRESH_MIN_AGE_HOURS, REFRESH_WINDOW_DAYS } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 613]);

export interface RefreshSummary {
  checked: number;
  refreshed: number;
  expired: number;
  /** Failed for a passing reason; tried again next time. */
  retryLater: number;
  emailed: number;
}

function transient(e: unknown): boolean {
  return e instanceof GraphError && (e.httpStatus === 0 || e.httpStatus >= 500 || e.httpStatus === 429 || (e.code !== null && TRANSIENT_CODES.has(e.code)));
}

export async function refreshConnections(deps: { fetch?: FetchLike; now?: Date } = {}): Promise<RefreshSummary> {
  const now = deps.now ?? new Date();
  const due = await getDb().withService((tx) =>
    tx.query<{ id: string; brand_id: string; provider: Provider; expires_at: Date | string }>(
      `select c.id::text as id, c.brand_id::text as brand_id, c.provider, c.expires_at
         from public.channel_connections c
         join public.channel_tokens t on t.connection_id = c.id
        where c.provider = 'instagram' and c.status = 'active' and c.expires_at is not null
          and c.expires_at < $1::timestamptz and t.updated_at < $2::timestamptz
        order by c.expires_at`,
      [new Date(now.getTime() + REFRESH_WINDOW_DAYS * DAY_MS).toISOString(), new Date(now.getTime() - REFRESH_MIN_AGE_HOURS * HOUR_MS).toISOString()],
    ),
  );
  // Connections that already ended and have no token row at all are caught by the publisher (token_expired).
  const summary: RefreshSummary = { checked: due.length, refreshed: 0, expired: 0, retryLater: 0, emailed: 0 };
  for (const c of due) {
    const conn = { id: c.id, brandId: c.brand_id, provider: c.provider };
    const problem = async (message: string) => {
      summary.expired++;
      if (await markConnectionProblem({ brandId: c.brand_id, provider: c.provider, status: "expired", message })) summary.emailed++;
    };
    if (new Date(c.expires_at).getTime() <= now.getTime()) {
      await problem("The Instagram permission has ended. Please reconnect.");
      continue;
    }
    try {
      const token = await readToken(conn);
      const fresh = await refreshLongLived(token, deps.fetch);
      await replaceToken({ connectionId: c.id, brandId: c.brand_id, provider: c.provider, token: fresh.token, expiresAt: new Date(now.getTime() + fresh.expiresIn * 1000) });
      summary.refreshed++;
    } catch (e) {
      if (transient(e)) {
        summary.retryLater++;
        continue;
      }
      await problem(e instanceof GraphError ? `Instagram refused to renew the permission: ${scrub(e.message)}` : "The saved permission could not be renewed. Please reconnect.");
    }
  }
  return summary;
}
