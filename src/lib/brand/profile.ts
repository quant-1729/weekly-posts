import { getDb } from "@/lib/db";
import { getStorage, type Storage } from "@/lib/storage";
import { s } from "@/lib/i18n/strings";
import type { ContentLanguage } from "@/lib/ai/schemas";
import { storeEligibility } from "@/lib/mascot/eligibility";
import { BrandAccessError, getCurrentBrand, requireBrandMember } from "./current";
import { normalizeLogo, removeLogoFile, saveLogoFile, type NormalizedLogo } from "./logo";
import { parseProfile, type FieldErrors, type ProfileDraft, type ProfileInput } from "./schema";

/** The server side of the brand profile: read, validate + save, logo. Everything runs as the signed-in user. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ProfileValidationError extends Error {
  constructor(public readonly fieldErrors: FieldErrors) {
    super("Profile has invalid fields");
    this.name = "ProfileValidationError";
  }
}

export class SetupAlreadyCompletedError extends Error {
  constructor() {
    super("This brand has already been set up");
    this.name = "SetupAlreadyCompletedError";
  }
}

export interface StoredProfile {
  brandId: string;
  /** Form-ready values. Nullable text columns become "". */
  draft: ProfileDraft;
  logoPath: string | null;
  setupCompleted: boolean;
  updatedAt: string;
}

interface MemoryRow {
  business_name: string | null;
  category: string | null;
  city: string | null;
  products: { name?: string; price?: string; unit?: string; note?: string }[] | null;
  audience: string | null;
  tone: string | null;
  languages: ContentLanguage[] | null;
  default_language: ContentLanguage | null;
  logo_path: string | null;
  colors: { primary?: string; secondary?: string; accent?: string } | null;
  whatsapp_number: string | null;
  notes: string | null;
  setup_completed_at: string | null;
  updated_at: string;
}

/** The brand's profile, or null when the user is not a member (row-level security hides it). */
export async function getBrandProfile(userId: string, brandId: string): Promise<StoredProfile | null> {
  if (!UUID_RE.test(brandId)) return null;
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<MemoryRow>(
      `select business_name, category, city, products, audience, tone,
              languages::text[] as languages, default_language::text as default_language,
              logo_path, colors, whatsapp_number, notes, setup_completed_at, updated_at
         from public.brand_memory where brand_id = $1`,
      [brandId],
    ),
  );
  const r = rows[0];
  if (!r) return null;
  return {
    brandId,
    draft: {
      business_name: r.business_name ?? "",
      category: r.category ?? "",
      city: r.city ?? "",
      products: (r.products ?? []).map((p) => ({
        name: p.name ?? "",
        price: p.price ?? "",
        unit: p.unit ?? "",
        note: p.note ?? "",
      })),
      audience: r.audience ?? "",
      tone: r.tone ?? "",
      languages: r.languages ?? [],
      default_language: r.default_language ?? "",
      colors: {
        primary: r.colors?.primary ?? "",
        secondary: r.colors?.secondary ?? "",
        accent: r.colors?.accent ?? "",
      },
      whatsapp_number: r.whatsapp_number ?? "",
      notes: r.notes ?? "",
    },
    logoPath: r.logo_path,
    setupCompleted: r.setup_completed_at !== null,
    updatedAt: String(r.updated_at),
  };
}

const orNull = (v: string) => (v === "" ? null : v);

export interface SaveOptions {
  /**
   * Finishing setup: also stores the answers/transcript text and sets
   * setup_completed_at. Omit for later edits on /brand.
   */
  completeSetup?: { transcript: string };
}

/**
 * Validates and saves the profile, then renames the brand to business_name.
 * Throws ProfileValidationError (nothing written) or BrandAccessError when the
 * user is not a member of the brand.
 */
export async function saveBrandProfile(
  userId: string,
  brandId: string,
  raw: unknown,
  opts: SaveOptions = {},
): Promise<ProfileInput> {
  const parsed = parseProfile(raw);
  if (!parsed.ok) throw new ProfileValidationError(parsed.fieldErrors);
  const p = parsed.data;
  if (!UUID_RE.test(brandId)) throw new BrandAccessError();

  const setup = opts.completeSetup;
  const params: unknown[] = [
    brandId,
    p.business_name,
    orNull(p.category),
    orNull(p.city),
    JSON.stringify(p.products),
    orNull(p.audience),
    orNull(p.tone),
    `{${p.languages.join(",")}}`,
    p.default_language,
    JSON.stringify(p.colors),
    p.whatsapp_number,
    orNull(p.notes),
  ];
  if (setup) params.push(setup.transcript.slice(0, 20_000));

  await getDb().withUser(userId, async (tx) => {
    // Row-level security limits this to brands the user belongs to.
    const updated = await tx.query(
      `update public.brand_memory set
         business_name = $2, category = $3, city = $4, products = $5::jsonb, audience = $6, tone = $7,
         languages = $8::public.content_language[], default_language = $9::public.content_language,
         colors = $10::jsonb, whatsapp_number = $11, notes = $12
         ${setup ? ", setup_transcript = $13, setup_completed_at = now()" : ""}
       where brand_id = $1
       returning brand_id`,
      params,
    );
    if (updated.length === 0) throw new BrandAccessError();
    // Only owners may rename (brands_update policy); for an editor this touches nothing.
    await tx.query("update public.brands set name = $2 where id = $1", [brandId, p.business_name]);
    // Category and tone decide whether a mascot is offered (R15a), so recheck on every save.
    await storeEligibility(tx, brandId, { category: orNull(p.category), tone: orNull(p.tone) });
  });
  return p;
}

/**
 * Starts setup: reuses the user's unfinished brand (so a reload does not leave
 * a pile of empty brands), or creates one with the placeholder name and makes
 * it the current brand. Throws SetupAlreadyCompletedError if the current brand
 * is already set up.
 */
export async function ensureSetupBrand(userId: string): Promise<string> {
  const current = await getCurrentBrand(userId);
  if (current) {
    if (current.setupCompleted) throw new SetupAlreadyCompletedError();
    return current.id;
  }
  return getDb().withUser(userId, async (tx) => {
    const [row] = await tx.query<{ id: string }>("select public.create_brand($1) as id", [
      s.setup.placeholderBrandName,
    ]);
    await tx.query("update public.profiles set last_brand_id = $2 where id = $1", [userId, row.id]);
    return row.id;
  });
}

export async function getProfilePhone(userId: string): Promise<string | null> {
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ phone: string }>("select phone from public.profiles where id = $1", [userId]),
  );
  return rows[0]?.phone ?? null;
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

/**
 * Validates and normalises the upload (png/jpg/webp, max 2 MB, to PNG up to
 * 512 px), saves it at brand-assets/{brand_id}/logo.png and records the path.
 * Throws LogoError for a bad file, BrandAccessError for a non-member.
 */
export async function setBrandLogo(args: {
  userId: string;
  brandId: string;
  bytes: Uint8Array;
  declaredType?: string;
  storage?: Storage;
}): Promise<NormalizedLogo & { logoPath: string }> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const logo = await normalizeLogo(args.bytes, args.declaredType);
  const logoPath = await saveLogoFile(brandId, logo.png, args.storage ?? getStorage());
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query("update public.brand_memory set logo_path = $2 where brand_id = $1 returning brand_id", [
      brandId,
      logoPath,
    ]),
  );
  if (rows.length === 0) throw new BrandAccessError();
  return { ...logo, logoPath };
}

export async function clearBrandLogo(args: { userId: string; brandId: string; storage?: Storage }): Promise<void> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  await getDb().withUser(userId, (tx) =>
    tx.query("update public.brand_memory set logo_path = null where brand_id = $1", [brandId]),
  );
  await removeLogoFile(brandId, args.storage ?? getStorage());
}
