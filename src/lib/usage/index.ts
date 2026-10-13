import { getDb } from "@/lib/db";

/** Kinds that exist in the usage_kind enum (0001_init.sql, 0002_usage_setup.sql, 0005_v2.sql). */
export type UsageKind =
  | "generate"
  | "regenerate"
  | "switch_language"
  | "plan"
  | "transcribe"
  | "mascot"
  | "photo_cleanup"
  | "setup"
  | "website_read" // v2 kinds (0005_v2.sql); other v2 kinds are added by their tasks
  | "upload_extract"
  | "fact_check" // 0004_usage_fact_check.sql; used by the v2 guardrail
  | "weekly_batch" // 0005_v2.sql; weekly generation (V-10)
  | "rewrite"
  | "review_reply" // 0005_v2.sql; review replies (V-22)
  | "auto_rewrite"; // 0011_hardening.sql; the weekly pipeline's own repeat/avoid-word rewrites (H-1)

/**
 * What a failed AI call cost: the sum of the attempts that got an answer before it threw
 * (`AiError.stats`, H-2). 0 for any other error, or when no attempt got a response.
 */
export function failedCallUsd(err: unknown): number {
  const stats = err instanceof Error ? (err as { stats?: unknown }).stats : undefined;
  if (!Array.isArray(stats)) return 0;
  return stats.reduce((sum: number, st: { usd?: number }) => sum + (Number.isFinite(st?.usd) ? (st.usd as number) : 0), 0);
}

/** Thrown when a brand has used all of today's AI calls. The UI shows `message`-free copy from i18n. */
export class DailyCapError extends Error {
  constructor(
    public readonly cap: number,
    public readonly used: number,
  ) {
    super(`Daily limit reached: ${used} of ${cap} AI calls used today`);
    this.name = "DailyCapError";
  }
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // Asia/Kolkata has no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;

/** The IST calendar day containing `now`, as [start, end) instants. */
export function istDayRange(now: Date = new Date()): { start: Date; end: Date } {
  const startMs = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/**
 * Writes one usage event. Server-only: runs as service_role, so the caller must
 * already have checked that `userId` is a member of `brandId`.
 */
export async function recordUsage(
  brandId: string,
  userId: string | null,
  kind: UsageKind,
  usd = 0,
): Promise<void> {
  await getDb().withService((tx) =>
    tx.query("insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, $3::public.usage_kind, $4)", [
      brandId,
      userId,
      kind,
      usd,
    ]),
  );
}

/** Number of AI calls the brand has made today (IST day). */
export async function countUsageToday(brandId: string, now: Date = new Date()): Promise<number> {
  const { start, end } = istDayRange(now);
  const [row] = await getDb().withService((tx) =>
    tx.query<{ n: number }>(
      `select count(*)::int as n from public.usage_events
       where brand_id = $1 and created_at >= $2 and created_at < $3`,
      [brandId, start.toISOString(), end.toISOString()],
    ),
  );
  return row?.n ?? 0;
}

/**
 * Throws DailyCapError when today's events (IST day) have reached
 * brands.daily_generation_cap. Call before every AI call.
 */
export async function assertUnderDailyCap(brandId: string, now: Date = new Date()): Promise<void> {
  const { start, end } = istDayRange(now);
  const [row] = await getDb().withService((tx) =>
    tx.query<{ cap: number; used: number }>(
      `select b.daily_generation_cap as cap,
              (select count(*)::int from public.usage_events u
                where u.brand_id = b.id and u.created_at >= $2 and u.created_at < $3) as used
         from public.brands b where b.id = $1`,
      [brandId, start.toISOString(), end.toISOString()],
    ),
  );
  if (!row) throw new Error("Brand not found");
  if (row.used >= row.cap) throw new DailyCapError(row.cap, row.used);
}
