/**
 * Owner-added occasions (Req 7), stored in public.owner_dates. Every call runs
 * as the signed-in user, so row-level security limits it to their own brand;
 * the explicit membership check gives a clear error instead of an empty result.
 */
import { BrandAccessError } from "@/lib/brand/current";
import { getDb, type Tx } from "@/lib/db";
import { isValidIsoDate } from "./dates";

export interface OwnerDate {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  name: string;
  yearly: boolean;
}

export class OwnerDateValidationError extends Error {
  constructor(
    public readonly field: "date" | "name",
    message: string,
  ) {
    super(message);
    this.name = "OwnerDateValidationError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = `id, to_char(date, 'YYYY-MM-DD') as date, name, yearly`;

async function assertMember(tx: Tx, brandId: string): Promise<void> {
  if (!UUID_RE.test(brandId)) throw new BrandAccessError();
  const [row] = await tx.query<{ ok: boolean }>("select public.is_brand_member($1::uuid) as ok", [brandId]);
  if (!row?.ok) throw new BrandAccessError();
}

/** The brand's owner dates, oldest date first. Throws BrandAccessError for non-members. */
export async function listOwnerDates(userId: string, brandId: string): Promise<OwnerDate[]> {
  return getDb().withUser(userId, async (tx) => {
    await assertMember(tx, brandId);
    return tx.query<OwnerDate>(
      `select ${COLUMNS} from public.owner_dates where brand_id = $1::uuid order by date asc, created_at asc`,
      [brandId],
    );
  });
}

/** Adds an occasion. `yearly` (default true) repeats it every year. Throws OwnerDateValidationError or BrandAccessError. */
export async function addOwnerDate(
  userId: string,
  brandId: string,
  input: { date: string; name: string; yearly?: boolean },
): Promise<OwnerDate> {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 120) {
    throw new OwnerDateValidationError("name", "Give the occasion a name of up to 120 characters.");
  }
  if (!isValidIsoDate(input.date)) {
    throw new OwnerDateValidationError("date", "Enter a real date as YYYY-MM-DD.");
  }
  return getDb().withUser(userId, async (tx) => {
    await assertMember(tx, brandId);
    const [row] = await tx.query<OwnerDate>(
      `insert into public.owner_dates (brand_id, date, name, yearly)
       values ($1::uuid, $2::date, $3, $4)
       returning ${COLUMNS}`,
      [brandId, input.date, name, input.yearly ?? true],
    );
    return row;
  });
}

/** Removes one of the brand's owner dates. Returns false if there was no such date. Throws BrandAccessError for non-members. */
export async function removeOwnerDate(userId: string, brandId: string, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  return getDb().withUser(userId, async (tx) => {
    await assertMember(tx, brandId);
    const rows = await tx.query<{ id: string }>(
      "delete from public.owner_dates where id = $1::uuid and brand_id = $2::uuid returning id",
      [id, brandId],
    );
    return rows.length > 0;
  });
}
