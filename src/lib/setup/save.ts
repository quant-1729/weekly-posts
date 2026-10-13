import { BrandAccessError, getCurrentBrand } from "@/lib/brand/current";
import { SetupAlreadyCompletedError } from "@/lib/brand/profile";
import { getDb } from "@/lib/db";
import type { Tx } from "@/lib/db/types";
import { s } from "@/lib/i18n/strings";
import type { SetupFieldErrors } from "./schema";
import { validateSetup } from "./validate";

/**
 * Saves the setup v2 answers (Req 2, 7) into brand_memory and brand_facts, and creates the
 * brand with create_brand. Everything runs as the signed-in user, so row-level security
 * keeps it to their own brand.
 */

export class SetupValidationError extends Error {
  constructor(public readonly fieldErrors: SetupFieldErrors) {
    super("Setup answers are invalid");
    this.name = "SetupValidationError";
  }
}

/** Question keys stored as brand_facts.source_ref for facts from setup. */
export const SETUP_FACT_KEYS = { whatSell: "what_sell", customers: "customers" } as const;

/**
 * The user's unfinished brand, or a new one named `businessName` (made the current brand).
 * Throws SetupAlreadyCompletedError when the user already has a finished brand: one
 * business per account.
 */
export async function ensureSetupBrandV2(userId: string, businessName: string): Promise<string> {
  const current = await getCurrentBrand(userId);
  if (current) {
    if (current.setupCompleted) throw new SetupAlreadyCompletedError();
    return current.id;
  }
  const name = businessName.trim().slice(0, 100) || s.setup.placeholderBrandName;
  return getDb().withUser(userId, async (tx) => {
    const [row] = await tx.query<{ id: string }>("select public.create_brand($1) as id", [name]);
    await tx.query("update public.profiles set last_brand_id = $2 where id = $1", [userId, row.id]);
    return row.id;
  });
}

/**
 * Makes `url` the brand's website and clears the earlier read's status when the address
 * changed. Returns true when a read should start for it. An empty url removes the website, and
 * the facts it gave stop being used. For a new address the old website facts are kept until the
 * new read succeeds with at least one fact (readWebsiteFacts then replaces them); a failed or
 * blocked read leaves them active. Runs inside the caller's transaction.
 */
export async function applyWebsiteUrl(tx: Tx, brandId: string, url: string): Promise<boolean> {
  const [prev] = await tx.query<{ website_url: string | null }>(
    "select website_url from public.brand_memory where brand_id = $1",
    [brandId],
  );
  if (!prev) throw new BrandAccessError();
  if ((prev.website_url ?? "") === url) return false;
  await tx.query(
    `update public.brand_memory
        set website_url = $2, website_status = 'none', website_read_at = null
      where brand_id = $1`,
    [brandId, url === "" ? null : url],
  );
  if (url === "") {
    await tx.query(
      "update public.brand_facts set active = false where brand_id = $1 and source_type = 'website' and active",
      [brandId],
    );
  }
  return url !== "";
}

export interface CompletedSetup {
  brandId: string;
  /** The website that was saved, or null. */
  websiteUrl: string | null;
  /** True when a website read has to be started now (no read was started for this address yet). */
  readNeeded: boolean;
}

/**
 * Validates the answers and finishes setup: brand, brand_memory, the two setup facts and
 * setup_completed_at, in one transaction. Throws SetupValidationError (nothing written),
 * SetupAlreadyCompletedError or BrandAccessError. Does not read the website: the caller
 * starts that (see website.ts) when `readNeeded` is true.
 */
export async function completeSetupV2(userId: string, raw: unknown): Promise<CompletedSetup> {
  const parsed = validateSetup(raw);
  if (!parsed.ok) throw new SetupValidationError(parsed.fieldErrors);
  const a = parsed.data;

  const brandId = await ensureSetupBrandV2(userId, a.business_name);
  const url = a.website_url;

  const readNeeded = await getDb().withUser(userId, async (tx) => {
    const changed = await applyWebsiteUrl(tx, brandId, url);
    const updated = await tx.query(
      `update public.brand_memory set
         business_name = $2, category = $3, audience = $4,
         country = $5, region = $6, city = $7, timezone = $8,
         goal = $9::public.goal_v2, tone = $10, post_language = $11, minutes_per_post = $12,
         schedule_weekday = $13, schedule_time = $14::time, link_destination = $15,
         setup_completed_at = now()
       where brand_id = $1
       returning brand_id`,
      [
        brandId,
        a.business_name,
        a.what_sell, // category: kept filled so regulated businesses are detected
        a.customers,
        a.country,
        a.region === "" ? null : a.region,
        a.city === "" ? null : a.city,
        a.timezone,
        a.goal,
        a.tone,
        a.post_language,
        a.minutes_per_post,
        a.schedule_weekday,
        a.schedule_time,
        url === "" ? null : url, // short links go to the website unless the owner picks another place later
      ],
    );
    if (updated.length === 0) throw new BrandAccessError();
    // Only owners may rename (brands_update policy); the creator is the owner.
    await tx.query("update public.brands set name = $2 where id = $1", [brandId, a.business_name]);

    // What they sell and who their customers are are facts the posts may use (R8, Req 11).
    await tx.query(
      `update public.brand_facts set active = false
        where brand_id = $1 and source_type = 'setup' and source_ref = any($2::text[]) and active`,
      [brandId, [SETUP_FACT_KEYS.whatSell, SETUP_FACT_KEYS.customers]],
    );
    const facts: Array<{ kind: "product" | "other"; label: string; value: string; ref: string }> = [
      { kind: "product", label: s.setupV2.factLabels.whatSell, value: a.what_sell, ref: SETUP_FACT_KEYS.whatSell },
      { kind: "other", label: s.setupV2.factLabels.customers, value: a.customers, ref: SETUP_FACT_KEYS.customers },
    ];
    for (const f of facts) {
      await tx.query(
        `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote, created_by)
         values ($1, $2::public.fact_kind, $3, $4, 'setup', $5, $4, $6)`,
        [brandId, f.kind, f.label, f.value, f.ref, userId],
      );
    }
    return changed;
  });

  return { brandId, websiteUrl: url === "" ? null : url, readNeeded };
}
