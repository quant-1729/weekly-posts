/**
 * Settings on the brand page (Req 2, 7, 12): the setup answers, where links go, and the
 * regulated category. Same rules as setup v2 (schema.ts here builds on src/lib/setup/schema.ts).
 * Runs as the signed-in user, so row-level security keeps it to their own brand.
 */
import { regulatedGroup, type RegulatedGroup } from "@/lib/ai/regulated";
import { BrandAccessError, requireBrandMember } from "@/lib/brand/current";
import { getDb, type Tx } from "@/lib/db";
import { enforceFaceRules } from "@/lib/faces/service";
import { storeEligibility } from "@/lib/mascot/eligibility";
import { s } from "@/lib/i18n/strings";
import { isIsoCountry } from "@/lib/setup/countries";
import { isValidRegion } from "@/lib/setup/regions";
import { SETUP_FACT_KEYS } from "@/lib/setup/save";
import { parseSettings, settingsFromForm, type RegulatedChoice, type SettingsFieldErrors, type SettingsValues } from "./schema";

export class SettingsValidationError extends Error {
  constructor(public readonly fieldErrors: SettingsFieldErrors) {
    super("Settings are invalid");
    this.name = "SettingsValidationError";
  }
}

/** What the settings form holds: the validated shape, with numbers and nullable text made form-friendly. */
export interface SettingsForm {
  business_name: string;
  what_sell: string;
  customers: string;
  country: string;
  region: string;
  city: string;
  timezone: string;
  goal: string;
  tone: string;
  post_language: string;
  minutes_per_post: string;
  schedule_weekday: number;
  schedule_time: string;
  link_destination: string;
  /** "" = automatic. */
  regulated: "" | RegulatedChoice;
}

export interface SettingsView {
  form: SettingsForm;
  /** What we detect from "what you sell". The owner's choice, if any, overrides it. */
  detected: RegulatedGroup;
  websiteUrl: string | null;
  /** Read-only until the email task (V-15): pause and unsubscribe. */
  email: { pausedUntil: string | null; unsubscribedAt: string | null };
}

interface Row {
  business_name: string | null;
  category: string | null;
  audience: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string;
  goal: string;
  tone: string | null;
  post_language: string;
  minutes_per_post: number | null;
  schedule_weekday: number;
  schedule_time: string;
  link_destination: string | null;
  regulated: RegulatedChoice | null;
  website_url: string | null;
  paused: string | null;
  unsubscribed: string | null;
}

export async function getSettings(userId: string, brandId: string): Promise<SettingsView> {
  await requireBrandMember(userId, brandId);
  const [r] = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(
      `select business_name, category, audience, country, region, city, timezone, goal::text as goal, tone,
              post_language, minutes_per_post, schedule_weekday, to_char(schedule_time, 'HH24:MI') as schedule_time,
              link_destination, regulated::text as regulated, website_url,
              to_char(email_paused_until, 'YYYY-MM-DD') as paused,
              to_char(email_unsubscribed_at at time zone 'UTC', 'YYYY-MM-DD') as unsubscribed
         from public.brand_memory where brand_id = $1`,
      [brandId],
    ),
  );
  if (!r) throw new BrandAccessError();
  return {
    form: {
      business_name: r.business_name ?? "",
      what_sell: r.category ?? "",
      customers: r.audience ?? "",
      country: r.country ?? "",
      region: r.region ?? "",
      city: r.city ?? "",
      timezone: r.timezone,
      goal: r.goal,
      tone: r.tone ?? "",
      post_language: r.post_language,
      minutes_per_post: r.minutes_per_post === null ? "" : String(r.minutes_per_post),
      schedule_weekday: r.schedule_weekday,
      schedule_time: r.schedule_time,
      link_destination: r.link_destination ?? "",
      regulated: r.regulated ?? "",
    },
    detected: regulatedGroup(r.category ?? ""),
    websiteUrl: r.website_url,
    email: { pausedUntil: r.paused, unsubscribedAt: r.unsubscribed },
  };
}

/** Plain-words group name for "We think: Health". */
export function regulatedGroupLabel(group: string): string {
  return s.brandV2.settings.regulatedGroups[group as keyof typeof s.brandV2.settings.regulatedGroups] ?? group;
}

/** Zod checks plus the region check, which needs the holiday dataset. */
export function validateSettings(raw: unknown): { ok: true; data: SettingsValues } | { ok: false; fieldErrors: SettingsFieldErrors } {
  const input = settingsFromForm(raw);
  const parsed = parseSettings(input);
  const fieldErrors: SettingsFieldErrors = parsed.ok ? {} : { ...parsed.fieldErrors };
  const o = (input ?? {}) as { country?: unknown; region?: unknown };
  const region = typeof o.region === "string" ? o.region.trim() : "";
  if (!("region" in fieldErrors) && region !== "") {
    if (!isIsoCountry(o.country) || !isValidRegion(o.country, region)) fieldErrors.region = "invalid_region";
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return parsed as { ok: true; data: SettingsValues };
}

/**
 * Keeps the setup-sourced fact (what we sell, our customers) in step with the setting. When the
 * answer changed, the old fact, and any owner edit of it, stops being used and a fresh setup fact
 * is added. The old rows stay for audit.
 */
async function syncSetupFact(
  tx: Tx,
  args: { brandId: string; userId: string; ref: string; kind: "product" | "other"; label: string; value: string; previous: string },
): Promise<void> {
  if (args.previous.trim() === args.value.trim()) return;
  await tx.query(
    `update public.brand_facts set active = false
      where brand_id = $1 and active
        and ((source_type = 'setup' and source_ref = $2)
          or (source_type = 'owner' and source_ref in
                (select id::text from public.brand_facts where brand_id = $1 and source_type = 'setup' and source_ref = $2)))`,
    [args.brandId, args.ref],
  );
  await tx.query(
    `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote, created_by)
     values ($1, $2::public.fact_kind, $3, $4, 'setup', $5, $4, $6)`,
    [args.brandId, args.kind, args.label, args.value, args.ref, args.userId],
  );
}

/**
 * Validates and saves the settings. Throws SettingsValidationError (nothing written) or
 * BrandAccessError. The regulated choice is saved as given; null means automatic.
 */
export async function saveSettings(userId: string, brandId: string, raw: unknown): Promise<SettingsValues> {
  await requireBrandMember(userId, brandId);
  const parsed = validateSettings(raw);
  if (!parsed.ok) throw new SettingsValidationError(parsed.fieldErrors);
  const a = parsed.data;

  await getDb().withUser(userId, async (tx) => {
    const [before] = await tx.query<{ category: string | null; audience: string | null }>(
      "select category, audience from public.brand_memory where brand_id = $1 for update",
      [brandId],
    );
    if (!before) throw new BrandAccessError();
    await tx.query(
      `update public.brand_memory set
         business_name = $2, category = $3, audience = $4,
         country = $5, region = $6, city = $7, timezone = $8,
         goal = $9::public.goal_v2, tone = $10, post_language = $11, minutes_per_post = $12,
         schedule_weekday = $13, schedule_time = $14::time, link_destination = $15,
         regulated = $16::public.regulated_category
       where brand_id = $1`,
      [
        brandId,
        a.business_name,
        a.what_sell,
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
        a.link_destination === "" ? null : a.link_destination,
        a.regulated,
      ],
    );
    // Only owners may rename (brands_update policy); the creator is the owner.
    await tx.query("update public.brands set name = $2 where id = $1", [brandId, a.business_name]);

    // What we sell, the tone and the regulated choice decide whether a mascot is offered (V-25), so recompute it.
    // A brand that is now regulated stops using its mascot in posts.
    const eligibility = await storeEligibility(tx, brandId, { category: a.what_sell, tone: a.tone, regulated: a.regulated });
    if (eligibility.reason === "regulated") {
      await tx.query("update public.brand_memory set mascot_in_posts = false where brand_id = $1 and mascot_in_posts", [brandId]);
    }
    // Brand Face: a mascot that is no longer allowed, and a realistic AI person for a health, finance, legal or alcohol brand, go off.
    await enforceFaceRules(tx, brandId, a.regulated ?? regulatedGroup(a.what_sell), eligibility.reason !== "regulated");

    await syncSetupFact(tx, {
      brandId,
      userId,
      ref: SETUP_FACT_KEYS.whatSell,
      kind: "product",
      label: s.setupV2.factLabels.whatSell,
      value: a.what_sell,
      previous: before.category ?? "",
    });
    await syncSetupFact(tx, {
      brandId,
      userId,
      ref: SETUP_FACT_KEYS.customers,
      kind: "other",
      label: s.setupV2.factLabels.customers,
      value: a.customers,
      previous: before.audience ?? "",
    });
  });
  return a;
}
