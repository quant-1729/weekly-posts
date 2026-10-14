import { getDb } from "@/lib/db";
import { readWebsiteFacts } from "@/lib/website/extract";
import { applyWebsiteUrl } from "./save";

/**
 * Reading the owner's website during setup (Req 3, 6). The read runs in the background and
 * never blocks or fails setup: if it cannot finish, the status becomes "failed" and the
 * owner adds facts by hand. readWebsiteFacts saves its own result.
 */

/** A read that has not finished after this long is marked failed (a later finish still overwrites it). */
export const READ_TIMEOUT_MS = 90_000;

export type ReadFn = typeof readWebsiteFacts;

/**
 * Saves `url` on the brand and says whether a read must start. False when this address was
 * already handed to a read (a second tap on Next must not start another).
 */
export async function prepareWebsiteRead(userId: string, brandId: string, url: string): Promise<boolean> {
  return getDb().withUser(userId, (tx) => applyWebsiteUrl(tx, brandId, url));
}

async function markFailedIfStillReading(userId: string, brandId: string, url: string): Promise<void> {
  try {
    await getDb().withUser(userId, (tx) =>
      tx.query(
        `update public.brand_memory
            set website_status = 'failed', website_read_at = now(), website_read_reason = 'read_timeout'
          where brand_id = $1 and website_url = $2 and website_status = 'none' and website_read_at is null`,
        [brandId, url],
      ),
    );
  } catch (e) {
    console.error("[setup] could not mark the website read as failed", e);
  }
}

/**
 * Starts the read now and returns a promise for the background work. The promise never
 * rejects, so it is safe to hand to `after()` or to drop. Any error, and the time limit,
 * end as status "failed".
 */
export function runWebsiteRead(args: {
  userId: string;
  brandId: string;
  url: string;
  read?: ReadFn;
  timeoutMs?: number;
}): Promise<void> {
  const { userId, brandId, url } = args;
  const read = args.read ?? readWebsiteFacts;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = Promise.resolve()
    .then(() => read({ userId, brandId, url }))
    .then(() => "done" as const);
  const limit = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), args.timeoutMs ?? READ_TIMEOUT_MS);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });

  return Promise.race([work, limit])
    .then(async (outcome) => {
      if (outcome === "timeout") await markFailedIfStillReading(userId, brandId, url);
    })
    .catch(async (e) => {
      console.error("[setup] website read failed", e);
      await markFailedIfStillReading(userId, brandId, url);
    })
    .finally(() => clearTimeout(timer));
}

export type WebsiteReadState = "none" | "reading" | "ok" | "partial" | "blocked" | "failed";

export interface WebsiteReadSummary {
  state: WebsiteReadState;
  /** Active facts read from the website. */
  facts: number;
  /** Pages those facts came from. */
  pages: number;
  /** brand_memory.website_read_reason: why the read was not clean ("js_only_meta", "no_text", "robots" ...), null when it was. */
  reason: string | null;
}

/** Where the website read stands, for the Done screen. Null when the user cannot see the brand. */
export async function getWebsiteReadSummary(userId: string, brandId: string): Promise<WebsiteReadSummary | null> {
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{
      website_url: string | null;
      status: Exclude<WebsiteReadState, "reading">;
      read_at: string | null;
      reason: string | null;
      facts: number;
      pages: number;
    }>(
      `select m.website_url, m.website_status::text as status, m.website_read_at as read_at, m.website_read_reason as reason,
              (select count(*)::int from public.brand_facts f
                where f.brand_id = m.brand_id and f.source_type = 'website' and f.active) as facts,
              (select count(distinct f.source_ref)::int from public.brand_facts f
                where f.brand_id = m.brand_id and f.source_type = 'website' and f.active) as pages
         from public.brand_memory m
        where m.brand_id = $1 and public.is_brand_member(m.brand_id)`,
      [brandId],
    ),
  );
  if (!row) return null;
  const reading = row.website_url !== null && row.status === "none" && row.read_at === null;
  return { state: reading ? "reading" : row.status, facts: row.facts, pages: row.pages, reason: reading ? null : row.reason };
}
