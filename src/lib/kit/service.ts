/**
 * The brand kit (C-13, G-1). Colours keep brand_memory.colors, the logo keeps logo_path, and
 * brand_memory.kit holds the rest (fonts, style, default theme, text-logo flag, where it came from).
 * The mascot flag is not stored in the kit: it reads brand_memory.mascot_in_posts, which the mascot
 * pages own. Everything runs as the signed-in user, so row-level security limits it to their brands.
 */
import { requireBrandMember, BrandAccessError } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { z } from "zod";
import { POST_TYPES, type PostType } from "@/lib/briefs/types";
import { brandKitSchema, DEFAULT_KIT, storedKitSchema, typeDefaultSchema, type BrandKit, type StoredKit, type TypeDefault } from "@/lib/design/types";
import { completeColors, type ColorsInput } from "./defaults";
import { KitValidationError, kitPatchSchema, type KitPatch } from "./schema";

interface Row {
  colors: (ColorsInput & Record<string, unknown>) | null;
  kit: unknown;
  mascot_in_posts: boolean;
}

/** The valid fields of whatever is stored: a bad field is dropped, not the whole kit. */
function parseStored(raw: unknown): StoredKit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(storedKitSchema.shape)) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const r = schema.safeParse(value);
    if (r.success && r.data !== undefined) out[key] = r.data;
  }
  return out as StoredKit;
}

/** Colours + stored kit + defaults, as one valid BrandKit. */
export function mergeKit(row: Row): BrandKit {
  const stored = parseStored(row.kit);
  const style = { ...DEFAULT_KIT.style, ...stored.style };
  return brandKitSchema.parse({
    colors: completeColors(row.colors, style.mode),
    fonts: { ...DEFAULT_KIT.fonts, ...stored.fonts },
    style,
    themeId: stored.themeId ?? DEFAULT_KIT.themeId,
    textLogo: stored.textLogo ?? DEFAULT_KIT.textLogo,
    mascot: row.mascot_in_posts === true,
    source: stored.source ?? DEFAULT_KIT.source,
  });
}

const SELECT = "select colors, kit, mascot_in_posts from public.brand_memory where brand_id = $1";

/** The brand's kit. Always valid per brandKitSchema. Throws BrandAccessError for a non-member. */
export async function getBrandKit(userId: string, brandId: string): Promise<BrandKit> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) => tx.query<Row>(SELECT, [brandId]));
  if (!row) throw new BrandAccessError();
  return mergeKit(row);
}

export interface SaveOptions {
  /** Default "owner". The style reader and importers pass where the kit came from. */
  source?: BrandKit["source"];
}

/**
 * Validates the patch and saves it: colours into `colors` (other keys there are kept), the rest into
 * `kit`. The logo is not touched. Returns the merged kit. Throws KitValidationError (nothing written)
 * or BrandAccessError.
 */
export async function saveBrandKit(userId: string, brandId: string, patch: KitPatch | unknown, opts: SaveOptions = {}): Promise<BrandKit> {
  const parsed = kitPatchSchema.safeParse(patch);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "kit";
      if (!(key in fieldErrors)) fieldErrors[key] = /^[a-z_]+$/.test(issue.message) ? issue.message : "invalid";
    }
    throw new KitValidationError(fieldErrors);
  }
  const p = parsed.data;
  await requireBrandMember(userId, brandId);
  const source = opts.source ?? "owner";

  return getDb().withUser(userId, async (tx) => {
    const [row] = await tx.query<Row>(SELECT, [brandId]);
    if (!row) throw new BrandAccessError();
    const current = mergeKit(row);
    const next: BrandKit = brandKitSchema.parse({
      colors: { ...current.colors, ...p.colors },
      fonts: { ...current.fonts, ...p.fonts },
      style: { ...current.style, ...p.style },
      themeId: p.themeId ?? current.themeId,
      textLogo: p.textLogo ?? current.textLogo,
      mascot: current.mascot,
      source,
    });
    // Only what the patch touches is written, so a fonts-only edit does not copy the default colours into the row.
    const stored: StoredKit = { source: next.source };
    if (p.fonts) stored.fonts = next.fonts;
    if (p.style) stored.style = next.style;
    if (p.themeId) stored.themeId = next.themeId;
    if (p.textLogo !== undefined) stored.textLogo = next.textLogo;
    // `||` keeps keys this code does not know about, on both columns.
    const updated = await tx.query(
      "update public.brand_memory set colors = coalesce(colors, '{}'::jsonb) || $2::jsonb, kit = coalesce(kit, '{}'::jsonb) || $3::jsonb where brand_id = $1 returning brand_id",
      [brandId, JSON.stringify(p.colors ?? {}), JSON.stringify(stored)],
    );
    if (updated.length === 0) throw new BrandAccessError();
    // Read back what is stored, so the answer matches what getBrandKit gives (e.g. a background derived for a new mode).
    const [saved] = await tx.query<Row>(SELECT, [brandId]);
    return mergeKit(saved);
  });
}

// ---------------------------------------------------------------------------------------------
// G-7: the design the owner used last for a type of post
// ---------------------------------------------------------------------------------------------

/** The design remembered for a post type, or null (also when the stored value is not valid any more). */
export async function getTypeDefault(userId: string, brandId: string, postType: PostType): Promise<TypeDefault | null> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) => tx.query<{ kit: unknown }>("select kit from public.brand_memory where brand_id = $1", [brandId]));
  const map = row?.kit && typeof row.kit === "object" ? (row.kit as Record<string, unknown>).typeDefaults : null;
  const entry = map && typeof map === "object" ? (map as Record<string, unknown>)[postType] : null;
  const parsed = typeDefaultSchema.safeParse(entry);
  return parsed.success ? parsed.data : null;
}

/**
 * Remembers the chosen design for a post type. Validated, and only `kit.typeDefaults[postType]` is written: the other
 * types, the kit's own theme, fonts, style and `source` are left as they are. Throws KitValidationError or BrandAccessError.
 */
export async function saveTypeDefault(userId: string, brandId: string, postType: PostType, choice: TypeDefault | unknown): Promise<TypeDefault> {
  const type = z.enum(POST_TYPES).safeParse(postType);
  const parsed = typeDefaultSchema.safeParse(choice);
  if (!type.success || !parsed.success) {
    const fieldErrors: Record<string, string> = {};
    if (!type.success) fieldErrors.postType = "invalid";
    if (!parsed.success) for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".") || "typeDefault"] ??= "invalid";
    throw new KitValidationError(fieldErrors);
  }
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query(
      `update public.brand_memory
          set kit = coalesce(kit, '{}'::jsonb) || jsonb_build_object('typeDefaults', coalesce(kit -> 'typeDefaults', '{}'::jsonb) || $2::jsonb)
        where brand_id = $1 returning brand_id`,
      [brandId, JSON.stringify({ [type.data]: parsed.data })],
    ),
  );
  if (rows.length === 0) throw new BrandAccessError();
  return parsed.data;
}
