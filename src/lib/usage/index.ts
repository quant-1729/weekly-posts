import { getDb } from "@/lib/db";

/** Kinds that exist in the usage_kind enum (0001_init.sql, 0002_usage_setup.sql, 0005_v2.sql). */
export type UsageKind =
  | "generate"
  | "regenerate"
  | "switch_language"
  | "plan"
  | "transcribe"
  | "mascot" // enum value kept (0001_init.sql); unused since the mascot became Tween (D9), which makes no AI call
  | "photo_cleanup"
  | "setup"
  | "website_read" // v2 kinds (0005_v2.sql); other v2 kinds are added by their tasks
  | "upload_extract"
  | "fact_check" // 0004_usage_fact_check.sql; used by the v2 guardrail
  | "weekly_batch" // 0005_v2.sql; weekly generation (V-10)
  | "rewrite"
  | "review_reply" // 0005_v2.sql; review replies (V-22)
  | "brief_from_text" // 0016_v3_design.sql; "Describe your post" (C-08)
  | "style_read" // 0016_v3_design.sql; "Keep my look" (C-17)
  | "post_copy" // 0016_v3_design.sql; the words of a post made from a brief (C-16)
  | "image" // 0005_v2.sql; used for Imagen backgrounds (C-18)
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

/**
 * The brand's own calendar day containing `now`, in its time zone (`brand_memory.timezone`, UTC when there is none),
 * as [start, end) instants. Worked out in Postgres, so daylight-saving days (23 or 25 hours) are right.
 */
const TODAY_SQL = `
  with tz as (select coalesce((select timezone from public.brand_memory where brand_id = $1), 'UTC') as name),
       day as (
         select (((($2::timestamptz at time zone tz.name)::date))::timestamp at time zone tz.name) as start,
                ((((($2::timestamptz at time zone tz.name)::date) + 1))::timestamp at time zone tz.name) as stop
           from tz)
  select (select count(*)::int from public.usage_events u, day d
           where u.brand_id = $1 and u.created_at >= d.start and u.created_at < d.stop) as used`;

/** Number of AI calls the brand has made today (the day in the brand's time zone). */
export async function countUsageToday(brandId: string, now: Date = new Date()): Promise<number> {
  const [row] = await getDb().withService((tx) => tx.query<{ used: number }>(TODAY_SQL, [brandId, now.toISOString()]));
  return row?.used ?? 0;
}

/**
 * Throws DailyCapError when today's events (the day in the brand's time zone) have reached
 * brands.daily_generation_cap. Call before every AI call.
 */
export async function assertUnderDailyCap(brandId: string, now: Date = new Date()): Promise<void> {
  const [brand] = await getDb().withService((tx) =>
    tx.query<{ cap: number }>("select daily_generation_cap as cap from public.brands where id = $1", [brandId]),
  );
  if (!brand) throw new Error("Brand not found");
  const used = await countUsageToday(brandId, now);
  if (used >= brand.cap) throw new DailyCapError(brand.cap, used);
}
