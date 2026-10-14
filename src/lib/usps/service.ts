/**
 * USP library (PRD v3 B-2, change C-05): the owner's selling points, per brand.
 *
 * Everything runs as the signed-in user (row-level security) after an explicit membership check.
 * `details` is validated per kind with `USP_DETAILS`; the title is trimmed, 1 to 60 characters.
 * `confirmed` changes only through `setUspConfirmed` (an explicit owner action): create and update
 * ignore any `confirmed` in their input, and editing the claim of a point clears it again.
 * "Remove" is `setUspActive(..., false)`: the row stays, so a suggestion the owner dismissed is not
 * suggested again by `seedUspsFromFacts`. No AI is involved anywhere here.
 */
import { requireBrandMember } from '@/lib/brand/current';
import { getDb, type Tx } from '@/lib/db';
import { parsePrice } from './currency';
import { UspLimitError, UspNotFoundError, UspValidationError } from './errors';
import { parseUsp } from './schema';
import { NEEDS_CONFIRMATION, USP_TITLE_MAX, type Usp, type UspKind, type UspSource } from './types';
import { detailsAlreadySeeded } from '@/lib/details/seeded';

/** A brand keeps at most this many active selling points (keeps the page and the picker usable). */
export const MAX_ACTIVE_USPS = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UspRow {
  id: string;
  brand_id: string;
  kind: UspKind;
  title: string;
  details: Record<string, unknown>;
  source: UspSource;
  source_ref: string | null;
  confirmed: boolean;
  active: boolean;
  sort: number;
}

const COLUMNS = 'id, brand_id, kind::text as kind, title, details, source, source_ref, confirmed, active, sort';

function toUsp(r: UspRow): Usp {
  return {
    id: r.id,
    brandId: r.brand_id,
    kind: r.kind,
    title: r.title,
    details: r.details as Usp['details'],
    source: r.source,
    sourceRef: r.source_ref,
    confirmed: r.confirmed,
    active: r.active,
    sort: r.sort,
  };
}

function checked(raw: unknown) {
  const parsed = parseUsp(raw);
  if (!parsed.ok) throw new UspValidationError(parsed.fieldErrors);
  return parsed.data;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

/** The brand's selling points in the owner's order. Inactive ones only with `includeInactive`. */
export async function listUsps(userId: string, brandId: string, opts: { includeInactive?: boolean } = {}): Promise<Usp[]> {
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<UspRow>(
      `select ${COLUMNS} from public.usps where brand_id = $1 ${opts.includeInactive ? '' : 'and active'} order by sort asc, created_at asc, id asc`,
      [brandId],
    ),
  );
  return rows.map(toUsp);
}

export async function getUsp(userId: string, brandId: string, id: string): Promise<Usp | null> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) return null;
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<UspRow>(`select ${COLUMNS} from public.usps where id = $1 and brand_id = $2`, [id, brandId]),
  );
  return row ? toUsp(row) : null;
}

/** True when the brand has any USP row at all, active or not (used to decide whether to seed). */
export async function hasAnyUsps(userId: string, brandId: string): Promise<boolean> {
  await requireBrandMember(userId, brandId);
  const [r] = await getDb().withUser(userId, (tx) =>
    tx.query<{ n: number }>('select count(*)::int as n from public.usps where brand_id = $1', [brandId]),
  );
  return (r?.n ?? 0) > 0;
}

async function nextSort(tx: Tx, brandId: string): Promise<number> {
  const [r] = await tx.query<{ n: number }>('select coalesce(max(sort), -1)::int + 1 as n from public.usps where brand_id = $1', [brandId]);
  return r?.n ?? 0;
}

/** Adds a selling point the owner typed (source "owner", not confirmed). */
export async function createUsp(userId: string, brandId: string, raw: unknown): Promise<Usp> {
  await requireBrandMember(userId, brandId);
  const u = checked(raw);
  return getDb().withUser(userId, async (tx) => {
    const [count] = await tx.query<{ n: number }>('select count(*)::int as n from public.usps where brand_id = $1 and active', [brandId]);
    if ((count?.n ?? 0) >= MAX_ACTIVE_USPS) throw new UspLimitError();
    const [row] = await tx.query<UspRow>(
      `insert into public.usps (brand_id, kind, title, details, source, confirmed, sort, created_by)
       values ($1, $2::public.usp_kind, $3, $4::jsonb, 'owner', false, $5, $6) returning ${COLUMNS}`,
      [brandId, u.kind, u.title, JSON.stringify(u.details), await nextSort(tx, brandId), userId],
    );
    return toUsp(row);
  });
}

/**
 * Edits kind, title and details. A change of content makes the point the owner's own (source
 * "owner"; `source_ref` stays so a seeded point is never suggested twice) and clears `confirmed`.
 * An edit that changes nothing writes nothing.
 */
export async function updateUsp(userId: string, brandId: string, id: string, raw: unknown): Promise<Usp> {
  await requireBrandMember(userId, brandId);
  const u = checked(raw);
  if (!UUID_RE.test(String(id))) throw new UspNotFoundError();
  return getDb().withUser(userId, async (tx) => {
    const [cur] = await tx.query<UspRow>(`select ${COLUMNS} from public.usps where id = $1 and brand_id = $2 for update`, [id, brandId]);
    if (!cur) throw new UspNotFoundError();
    const same = cur.kind === u.kind && cur.title === u.title && JSON.stringify(sortKeys(cur.details)) === JSON.stringify(sortKeys(u.details));
    if (same) return toUsp(cur);
    const [row] = await tx.query<UspRow>(
      `update public.usps
          set kind = $3::public.usp_kind, title = $4, details = $5::jsonb, source = 'owner',
              confirmed = false, updated_at = now()
        where id = $1 and brand_id = $2 returning ${COLUMNS}`,
      [id, brandId, u.kind, u.title, JSON.stringify(u.details)],
    );
    return toUsp(row);
  });
}

/**
 * The owner confirms (or withdraws confirmation of) a claim. Only kinds in NEEDS_CONFIRMATION
 * can be confirmed; for the others this throws UspValidationError.
 */
export async function setUspConfirmed(userId: string, brandId: string, id: string, confirmed: boolean): Promise<Usp> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) throw new UspNotFoundError();
  return getDb().withUser(userId, async (tx) => {
    const [cur] = await tx.query<UspRow>(`select ${COLUMNS} from public.usps where id = $1 and brand_id = $2 for update`, [id, brandId]);
    if (!cur) throw new UspNotFoundError();
    if (!NEEDS_CONFIRMATION.has(cur.kind)) throw new UspValidationError({ confirmed: 'not_needed' });
    const [row] = await tx.query<UspRow>(
      `update public.usps set confirmed = $3, updated_at = now() where id = $1 and brand_id = $2 returning ${COLUMNS}`,
      [id, brandId, confirmed === true],
    );
    return toUsp(row);
  });
}

/** Puts the given active points first, in this order, then the rest as they were (sort 0, 1, 2 ...). Ids that are not the brand's are ignored. */
export async function reorderUsps(userId: string, brandId: string, orderedIds: string[]): Promise<Usp[]> {
  await requireBrandMember(userId, brandId);
  const ids = [...new Set(orderedIds.map(String).filter((i) => UUID_RE.test(i)))];
  await getDb().withUser(userId, async (tx) => {
    const current = await tx.query<{ id: string }>(
      'select id from public.usps where brand_id = $1 and active order by sort asc, created_at asc, id asc for update',
      [brandId],
    );
    const known = new Set(current.map((r) => r.id));
    const first = ids.filter((i) => known.has(i));
    const rest = current.map((r) => r.id).filter((i) => !first.includes(i));
    for (const [i, uspId] of [...first, ...rest].entries()) {
      await tx.query('update public.usps set sort = $3 where id = $1 and brand_id = $2 and sort <> $3', [uspId, brandId, i]);
    }
  });
  return listUsps(userId, brandId);
}

/** "Remove" in the UI: active = false keeps the row (and the memory that it was dismissed). */
export async function setUspActive(userId: string, brandId: string, id: string, active: boolean): Promise<Usp> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) throw new UspNotFoundError();
  return getDb().withUser(userId, async (tx) => {
    if (active) {
      const [count] = await tx.query<{ n: number }>('select count(*)::int as n from public.usps where brand_id = $1 and active', [brandId]);
      if ((count?.n ?? 0) >= MAX_ACTIVE_USPS) throw new UspLimitError();
    }
    const [row] = await tx.query<UspRow>(
      `update public.usps set active = $3, updated_at = now() where id = $1 and brand_id = $2 returning ${COLUMNS}`,
      [id, brandId, active === true],
    );
    if (!row) throw new UspNotFoundError();
    return toUsp(row);
  });
}

export const deactivateUsp = (userId: string, brandId: string, id: string) => setUspActive(userId, brandId, id, false);

/** Deletes the row for good. Briefs that used it keep their frozen copy (the foreign key clears `primary_usp_id`). */
export async function deleteUsp(userId: string, brandId: string, id: string): Promise<boolean> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) return false;
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query('delete from public.usps where id = $1 and brand_id = $2 returning id', [id, brandId]),
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Seeding from facts
// ---------------------------------------------------------------------------

interface FactRow {
  id: string;
  kind: 'price' | 'offer' | 'claim';
  label: string | null;
  value: string;
  source_type: 'website' | 'setup' | 'upload' | 'owner';
}

export interface SeedCandidate {
  kind: UspKind;
  title: string;
  details: Record<string, unknown>;
}

/**
 * Turns one fact into a USP candidate, or null when it does not fit a 60-character line. Only
 * what the fact says is used: a price is read only when the text is one clear price and the fact
 * has a name, a discount only when it reads like "20% off ...". Anything else becomes a "custom"
 * point with the fact's own words, which the owner can turn into a typed kind.
 */
export function uspFromFact(fact: Pick<FactRow, 'kind' | 'label' | 'value'>, country: string | null = null): SeedCandidate | null {
  const value = fact.value.trim().replace(/\s+/g, ' ');
  const label = (fact.label ?? '').trim().replace(/\s+/g, ' ');
  const fits = (t: string) => t.length >= 1 && t.length <= USP_TITLE_MAX;

  if (fact.kind === 'claim') {
    return fits(value) ? { kind: 'quality', title: value, details: { claim: value } } : null;
  }

  if (fact.kind === 'price') {
    const price = parsePrice(value, country);
    if (price && label && fits(label)) {
      const title = `${label} ${value}`;
      if (fits(title)) {
        return { kind: 'price', title, details: { item: label, price: { amount: price.amount, currency: price.currency } } };
      }
    }
  }

  if (fact.kind === 'offer') {
    const m = /^(\d{1,3}(?:\.\d+)?)\s*%\s*off(?:\s+(?:on\s+)?(.+))?$/i.exec(value);
    const percent = m ? Number(m[1]) : NaN;
    const on = (m?.[2] ?? label).trim();
    if (m && percent > 0 && percent <= 100 && on && on.length <= 60 && fits(value)) {
      return { kind: 'discount', title: value, details: { percent, on, upTo: false } };
    }
  }

  const text = label && fits(`${label}: ${value}`) ? `${label}: ${value}` : value;
  return fits(text) ? { kind: 'custom', title: text, details: {} } : null;
}

const FACT_SOURCE_TO_USP: Record<FactRow['source_type'], UspSource> = {
  website: 'website',
  setup: 'setup',
  owner: 'owner',
  upload: 'owner', // the owner supplied it
};

/**
 * Creates selling points from the brand's active price, offer and claim facts. Idempotent:
 * `source_ref` holds the fact id and a fact that already has a USP row (active or dismissed) is
 * skipped. Seeded points are never confirmed. Returns how many were created.
 */
export async function seedUspsFromFacts(brandId: string, userId: string): Promise<{ created: number }> {
  await requireBrandMember(userId, brandId);
  return getDb().withUser(userId, async (tx) => {
    const facts = await tx.query<FactRow>(
      `select id, kind::text as kind, label, value, source_type::text as source_type
         from public.brand_facts
        where brand_id = $1 and active and kind in ('price', 'offer', 'claim')
        order by created_at asc, id asc`,
      [brandId],
    );
    if (facts.length === 0) return { created: 0 };
    const seen = new Set(
      (await tx.query<{ source_ref: string }>('select source_ref from public.usps where brand_id = $1 and source_ref is not null', [brandId])).map(
        (r) => r.source_ref,
      ),
    );
    const [mem] = await tx.query<{ country: string | null }>('select country from public.brand_memory where brand_id = $1', [brandId]);
    const [active] = await tx.query<{ n: number }>('select count(*)::int as n from public.usps where brand_id = $1 and active', [brandId]);
    let room = MAX_ACTIVE_USPS - (active?.n ?? 0);
    let sort = await nextSort(tx, brandId);
    let created = 0;
    for (const f of facts) {
      if (room <= 0) break;
      if (seen.has(f.id)) continue;
      const candidate = uspFromFact(f, mem?.country ?? null);
      if (!candidate) continue;
      const valid = parseUsp(candidate);
      if (!valid.ok) continue; // never store something the owner's own form would refuse
      await tx.query(
        `insert into public.usps (brand_id, kind, title, details, source, source_ref, confirmed, sort, created_by)
         values ($1, $2::public.usp_kind, $3, $4::jsonb, $5, $6, false, $7, $8)`,
        [brandId, valid.data.kind, valid.data.title, JSON.stringify(valid.data.details), FACT_SOURCE_TO_USP[f.source_type], f.id, sort, userId],
      );
      seen.add(f.id);
      sort += 1;
      room -= 1;
      created += 1;
    }
    return { created };
  });
}

/** Seeds from facts only when the brand has no USP rows at all (so dismissed points stay dismissed). */
export async function ensureUspsSeeded(userId: string, brandId: string): Promise<{ created: number }> {
  // Once per brand: after the first import, an owner who deletes everything isn't refilled.
  if (await detailsAlreadySeeded(userId, brandId)) return { created: 0 };
  if (await hasAnyUsps(userId, brandId)) return { created: 0 };
  return seedUspsFromFacts(brandId, userId);
}
