import { getDb } from "@/lib/db";

export interface CurrentBrand {
  id: string;
  name: string;
  /** True once the owner has saved the setup review (brand_memory.setup_completed_at). */
  setupCompleted: boolean;
}

interface BrandRow {
  id: string;
  name: string;
  setup_completed: boolean;
}

const BRAND_COLUMNS = `b.id, b.name, (m.setup_completed_at is not null) as setup_completed`;

/**
 * The brand the user is working in: profiles.last_brand_id if they are still a
 * member of it, else their first membership (oldest first), else null.
 * Runs as the user, so row-level security decides what counts as "a member".
 */
export async function getCurrentBrand(userId: string): Promise<CurrentBrand | null> {
  const rows = await getDb().withUser(userId, async (tx) => {
    // brands is only visible to members, so a stale last_brand_id finds nothing.
    const last = await tx.query<BrandRow>(
      `select ${BRAND_COLUMNS}
         from public.profiles p
         join public.brands b on b.id = p.last_brand_id
         left join public.brand_memory m on m.brand_id = b.id
        where p.id = $1 and public.is_brand_member(b.id)`,
      [userId],
    );
    if (last.length > 0) return last;
    return tx.query<BrandRow>(
      `select ${BRAND_COLUMNS}
         from public.brand_members bm
         join public.brands b on b.id = bm.brand_id
         left join public.brand_memory m on m.brand_id = b.id
        where bm.user_id = $1
        order by bm.created_at asc, b.id asc
        limit 1`,
      [userId],
    );
  });
  const row = rows[0];
  return row ? { id: row.id, name: row.name, setupCompleted: row.setup_completed } : null;
}

/** Signed-in users whose current brand has no saved profile yet belong on /setup. */
export function needsSetup(brand: CurrentBrand | null): boolean {
  return !brand || !brand.setupCompleted;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BrandAccessError extends Error {
  constructor() {
    super("Brand not found or not accessible");
    this.name = "BrandAccessError";
  }
}

export interface BrandSummary {
  id: string;
  name: string;
}

/** Every brand the user belongs to, oldest membership first. RLS limits this to their own memberships. */
export async function listUserBrands(userId: string): Promise<BrandSummary[]> {
  return getDb().withUser(userId, (tx) =>
    tx.query<BrandSummary>(
      `select b.id, b.name
         from public.brand_members bm
         join public.brands b on b.id = bm.brand_id
        where bm.user_id = $1
        order by bm.created_at asc, b.id asc`,
      [userId],
    ),
  );
}

/**
 * Makes `brandId` the user's current brand (profiles.last_brand_id), the brand switcher (R14).
 * Throws BrandAccessError, leaving last_brand_id unchanged, unless the user is a member.
 * The profiles policy checks membership too, so the database refuses it even if this check is skipped.
 */
export async function switchBrand(userId: string, brandId: string): Promise<void> {
  if (!UUID_RE.test(brandId)) throw new BrandAccessError();
  const updated = await getDb().withUser(userId, async (tx) => {
    const [member] = await tx.query<{ ok: boolean }>("select public.is_brand_member($1::uuid) as ok", [brandId]);
    if (!member?.ok) return [];
    return tx.query<{ id: string }>("update public.profiles set last_brand_id = $2::uuid where id = $1 returning id", [
      userId,
      brandId,
    ]);
  });
  if (updated.length === 0) throw new BrandAccessError();
}

/** Throws BrandAccessError unless the user is a member of the brand. Call before any service-role work. */
export async function requireBrandMember(userId: string, brandId: string): Promise<void> {
  if (!UUID_RE.test(brandId)) throw new BrandAccessError();
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ ok: boolean }>("select public.is_brand_member($1::uuid) as ok", [brandId]),
  );
  if (!rows[0]?.ok) throw new BrandAccessError();
}
