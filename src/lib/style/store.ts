// Reading and saving the kit for "Keep my look", through the kit service (src/lib/kit): colours (with the
// background) go to brand_memory.colors, fonts, style, theme and source to brand_memory.kit.

import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { brandKitSchema, type BrandKit } from '@/lib/design/types';
import { getBrandKit, saveBrandKit } from '@/lib/kit/service';

export interface KitContext {
  kit: BrandKit;
  brandName: string;
  sells: string;
}

/** The kit a brand has now (defaults filled in) and the words the style prompt needs. Runs as the user (row-level security). */
export async function loadCurrentKit(userId: string, brandId: string): Promise<KitContext> {
  await requireBrandMember(userId, brandId);
  const kit = await getBrandKit(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ business_name: string | null; category: string | null }>('select business_name, category from public.brand_memory where brand_id = $1', [brandId]),
  );
  if (!row) throw new BrandAccessError();
  return { kit, brandName: row.business_name ?? '', sells: row.category ?? '' };
}

/**
 * Saves a kit the owner agreed to ("Keep my look"): colours, fonts, style and theme, with the kit's source
 * (instagram, website or mixed). The logo and the mascot switch are not touched. Throws KitValidationError or BrandAccessError.
 */
export async function saveKit(userId: string, brandId: string, raw: unknown): Promise<BrandKit> {
  const kit = brandKitSchema.parse(raw);
  return saveBrandKit(
    userId,
    brandId,
    { colors: kit.colors, fonts: kit.fonts, style: kit.style, themeId: kit.themeId },
    { source: kit.source },
  );
}
