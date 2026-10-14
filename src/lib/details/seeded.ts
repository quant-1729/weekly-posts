// One-time filling of the USP library and contact set from a brand's facts (C-05, C-09).
// `brand_memory.details_seeded_at` records the first fill; after that the "ensure" functions never
// refill, so an owner who deletes their USPs or contacts keeps them deleted.

import { getDb } from "@/lib/db";

/**
 * True when this brand's details were already filled once. The first call for a brand marks the
 * time and returns false for both callers in that call's flow: USPs and contacts are filled together
 * on the same page load, so a short grace period lets the second one through.
 */
export async function detailsAlreadySeeded(userId: string, brandId: string): Promise<boolean> {
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ seeded_at: string | null; marked: boolean }>(
      `with cur as (select details_seeded_at from public.brand_memory where brand_id = $1),
            upd as (update public.brand_memory set details_seeded_at = now()
                     where brand_id = $1 and details_seeded_at is null returning true as marked)
       select (select details_seeded_at::text from cur) as seeded_at, coalesce((select marked from upd), false) as marked`,
      [brandId],
    ),
  );
  const r = rows[0];
  if (!r || r.marked || !r.seeded_at) return false;
  // Seeded before: allow a short window so the other half of the same first visit can still fill.
  return Date.now() - Date.parse(r.seeded_at) > 60_000;
}
