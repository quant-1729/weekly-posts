/**
 * Contact set (PRD v3 B-4, change C-09): how customers reach the business, per brand.
 *
 * Runs as the signed-in user (row-level security) after a membership check. Every value is
 * normalised by `normalizeContact` before it is stored (E.164 phones in the brand's country,
 * https links that pass the SSRF rules, lower-case emails, hours per day with a generated text).
 * Reachability of a link is checked separately and never blocks saving: `verifyContact` sets
 * `verified_at` when the page answers.
 */
import { requireBrandMember } from '@/lib/brand/current';
import { getDb, type Tx } from '@/lib/db';
import { saveInstagramHandle } from '@/lib/instagram/import';
import { FetchError, safeFetch, type FetchEnv } from '@/lib/website/fetch';
import { findPhoneNumbersInText, type CountryCode } from 'libphonenumber-js/max';
import { ContactDuplicateError, ContactLimitError, ContactNotFoundError, ContactValidationError } from './errors';
import { normalizeContact, normalizeEmail, normalizePhone } from './normalize';
import { CONTACT_KINDS, LINK_KINDS, SINGLE_KINDS, type ContactInput, type ContactKind, type ContactPoint, type ContactSource } from './types';
import { detailsAlreadySeeded } from '@/lib/details/seeded';

export const MAX_CONTACTS = 50;

/** Kinds a post shows only one of by default. */
const ONE_DEFAULT_KINDS: ReadonlySet<ContactKind> = new Set(['phone', 'whatsapp', 'email', 'address', 'hours', 'website']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  brand_id: string;
  kind: ContactKind;
  value: string;
  display: string | null;
  details: Record<string, unknown>;
  is_default: boolean;
  verified_at: string | null;
  source: ContactSource;
}

const COLUMNS = `id, brand_id, kind, value, display, details, is_default, to_char(verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as verified_at, source`;

/**
 * Phones are shown from their stored E.164 value, so every number reads the same way however old the
 * row is (rows saved before 2026-10-14 kept a national format such as "098200 12345").
 */
function displayFor(r: Row): string | null {
  if ((r.kind === 'phone' || r.kind === 'whatsapp') && r.value.startsWith('+')) {
    const n = normalizePhone(r.value, null);
    if (n.ok) return n.display;
  }
  return r.display;
}

function toContact(r: Row): ContactPoint {
  return {
    id: r.id,
    brandId: r.brand_id,
    kind: r.kind,
    value: r.value,
    display: displayFor(r),
    details: r.details ?? {},
    isDefault: r.is_default,
    verifiedAt: r.verified_at,
    source: r.source,
  };
}

async function brandCountry(tx: Tx, brandId: string): Promise<string | null> {
  const [m] = await tx.query<{ country: string | null }>('select country from public.brand_memory where brand_id = $1', [brandId]);
  return m?.country ?? null;
}

const kindOrder = (k: ContactKind) => CONTACT_KINDS.indexOf(k);

/** The brand's contacts, grouped by kind in the order of `CONTACT_KINDS`, oldest first within a kind. */
export async function listContacts(userId: string, brandId: string): Promise<ContactPoint[]> {
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.contact_points where brand_id = $1 order by is_default desc, created_at asc, id asc`, [brandId]),
  );
  return rows.map(toContact).sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
}

export async function hasAnyContacts(userId: string, brandId: string): Promise<boolean> {
  await requireBrandMember(userId, brandId);
  const [r] = await getDb().withUser(userId, (tx) =>
    tx.query<{ n: number }>('select count(*)::int as n from public.contact_points where brand_id = $1', [brandId]),
  );
  return (r?.n ?? 0) > 0;
}

/** Contacts shown on new posts by default (is_default), for the brief's blocks. */
export async function listDefaultContacts(userId: string, brandId: string): Promise<ContactPoint[]> {
  return (await listContacts(userId, brandId)).filter((c) => c.isDefault);
}

async function syncInstagram(userId: string, brandId: string, c: ContactPoint): Promise<void> {
  if (c.kind === 'instagram') await saveInstagramHandle({ userId, brandId, handle: c.value, source: 'owner' });
}

/**
 * Adds a contact the owner typed. `source` is "owner" (default) or "setup" (typed on a setup screen).
 * Throws ContactValidationError / ContactDuplicateError / ContactLimitError.
 */
export async function createContact(userId: string, brandId: string, raw: ContactInput | unknown): Promise<ContactPoint> {
  await requireBrandMember(userId, brandId);
  const isDefault = (raw as { isDefault?: unknown } | null)?.isDefault !== false;
  const source: 'owner' | 'setup' = (raw as { source?: unknown } | null)?.source === 'setup' ? 'setup' : 'owner';
  const created = await getDb().withUser(userId, async (tx) => {
    const n = normalizeContact(raw, { country: await brandCountry(tx, brandId) });
    if (!n.ok) throw new ContactValidationError(n.fieldErrors);
    const [count] = await tx.query<{ n: number }>('select count(*)::int as n from public.contact_points where brand_id = $1', [brandId]);
    if ((count?.n ?? 0) >= MAX_CONTACTS) throw new ContactLimitError();
    if (SINGLE_KINDS.has(n.kind)) {
      const [one] = await tx.query('select 1 as x from public.contact_points where brand_id = $1 and kind = $2', [brandId, n.kind]);
      if (one) throw new ContactDuplicateError(true);
    }
    const [dup] = await tx.query('select 1 as x from public.contact_points where brand_id = $1 and kind = $2 and value = $3', [brandId, n.kind, n.value]);
    if (dup) throw new ContactDuplicateError();
    const [row] = await tx.query<Row>(
      `insert into public.contact_points (brand_id, kind, value, display, details, is_default, source, created_by)
       values ($1, $2, $3, $4, $5::jsonb, $6, $8, $7) returning ${COLUMNS}`,
      [brandId, n.kind, n.value, n.display, JSON.stringify(n.details), isDefault, userId, source],
    );
    return toContact(row);
  });
  await syncInstagram(userId, brandId, created);
  return created;
}

/**
 * Edits a contact (its kind stays). A changed value clears `verified_at`; the edited contact is the
 * owner's own (source "owner"). Omitting `isDefault` keeps it. Editing the Instagram contact also
 * updates the handle the Instagram import uses.
 */
export async function updateContact(userId: string, brandId: string, id: string, raw: ContactInput | unknown): Promise<ContactPoint> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) throw new ContactNotFoundError();
  const updated = await getDb().withUser(userId, async (tx) => {
    const [cur] = await tx.query<Row>(`select ${COLUMNS} from public.contact_points where id = $1 and brand_id = $2 for update`, [id, brandId]);
    if (!cur) throw new ContactNotFoundError();
    const input: Record<string, unknown> = { ...((raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>), kind: cur.kind };
    const n = normalizeContact(input, { country: await brandCountry(tx, brandId) });
    if (!n.ok) throw new ContactValidationError(n.fieldErrors);
    const [dup] = await tx.query('select 1 as x from public.contact_points where brand_id = $1 and kind = $2 and value = $3 and id <> $4', [
      brandId,
      n.kind,
      n.value,
      id,
    ]);
    if (dup) throw new ContactDuplicateError();
    const isDefault = typeof input.isDefault === 'boolean' ? input.isDefault : cur.is_default;
    const [row] = await tx.query<Row>(
      `update public.contact_points
          set value = $3, display = $4, details = $5::jsonb, is_default = $6, source = 'owner',
              verified_at = case when value = $3 then verified_at else null end, updated_at = now()
        where id = $1 and brand_id = $2 returning ${COLUMNS}`,
      [id, brandId, n.value, n.display, JSON.stringify(n.details), isDefault],
    );
    return toContact(row);
  });
  await syncInstagram(userId, brandId, updated);
  return updated;
}

/** "Show on new posts" on or off for one contact. */
export async function setContactDefault(userId: string, brandId: string, id: string, isDefault: boolean): Promise<ContactPoint> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) throw new ContactNotFoundError();
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(
      `update public.contact_points set is_default = $3, updated_at = now() where id = $1 and brand_id = $2 returning ${COLUMNS}`,
      [id, brandId, isDefault === true],
    ),
  );
  if (!row) throw new ContactNotFoundError();
  return toContact(row);
}

export async function deleteContact(userId: string, brandId: string, id: string): Promise<boolean> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) return false;
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query('delete from public.contact_points where id = $1 and brand_id = $2 returning id', [id, brandId]),
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

export const VERIFY_TIMEOUT_MS = 4_000;

/** True when the address answers with a success or redirect status within a few seconds. Never throws. */
export async function isReachable(url: string, env: FetchEnv = {}): Promise<boolean> {
  try {
    const r = await safeFetch(url, { accept: 'text/html', timeoutMs: VERIFY_TIMEOUT_MS, maxBytes: 20_000, ...env });
    return r.status >= 200 && r.status < 400;
  } catch (e) {
    // The page answered but is not HTML (a PDF, a JSON booking API): it is there.
    return e instanceof FetchError && e.code === 'wrong_content_type' && (e.status ?? 500) < 400;
  }
}

/**
 * Checks a link contact (website, map, booking, custom link) and sets `verified_at` when it
 * answers; clears it when it does not. Does its own short network call, so run it after the
 * response (see the server action) and never inside a page render. Returns null for a contact
 * that is not a link.
 */
export async function verifyContact(
  userId: string,
  brandId: string,
  id: string,
  env: FetchEnv = {},
): Promise<{ reachable: boolean; verifiedAt: string | null } | null> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) throw new ContactNotFoundError();
  const [cur] = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.contact_points where id = $1 and brand_id = $2`, [id, brandId]),
  );
  if (!cur) throw new ContactNotFoundError();
  if (!LINK_KINDS.has(cur.kind)) return null;
  const reachable = await isReachable(cur.value, env);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(
      `update public.contact_points
          set verified_at = case when $4 then now() else null end
        where id = $1 and brand_id = $2 and value = $3 returning ${COLUMNS}`,
      [id, brandId, cur.value, reachable],
    ),
  );
  return { reachable, verifiedAt: row ? toContact(row).verifiedAt : null };
}

// ---------------------------------------------------------------------------
// Backfill from facts and brand memory
// ---------------------------------------------------------------------------

interface FactRow {
  kind: 'phone' | 'email' | 'address' | 'hours';
  value: string;
  source_type: 'website' | 'setup' | 'upload' | 'owner';
}

interface Candidate {
  kind: ContactKind;
  value: string;
  display: string;
  details: Record<string, unknown>;
  source: ContactSource;
  isDefault: boolean;
}

const SOURCE_OF_FACT: Record<FactRow['source_type'], ContactSource> = { website: 'website', setup: 'setup', owner: 'owner', upload: 'owner' };

function shortAddress(full: string): string {
  if (full.length <= 120) return full;
  const cut = full.slice(0, 120);
  const comma = cut.lastIndexOf(',');
  return (comma > 20 ? cut.slice(0, comma) : cut).trim();
}

/** The one phone number in a fact's text, or null (none, or several: we do not guess). */
function phoneFromText(value: string, country: string | null): ReturnType<typeof normalizePhone> {
  const whole = normalizePhone(value, country);
  if (whole.ok) return whole;
  try {
    const found = findPhoneNumbersInText(value, (/^[A-Z]{2}$/.test(country ?? '') ? country : undefined) as CountryCode | undefined);
    if (found.length === 1 && found[0].number.isValid()) return normalizePhone(found[0].number.number, country);
  } catch {
    // fall through
  }
  return { ok: false };
}

/**
 * Fills the contact set from what the brand already has: phone, email, address and hours facts,
 * and brand memory (website, WhatsApp number, Instagram handle, city). Idempotent: a contact
 * with the same kind and value is never added twice, and the brand keeps one hours entry.
 * Imported hours are the fact's own text (no per-day breakdown) until the owner edits them.
 * Returns how many contacts were added. Makes no network calls.
 */
export async function importContactsFromFacts(brandId: string, userId: string): Promise<{ created: number }> {
  await requireBrandMember(userId, brandId);
  return getDb().withUser(userId, async (tx) => {
    const [mem] = await tx.query<{
      country: string | null;
      city: string | null;
      website_url: string | null;
      whatsapp_number: string | null;
      instagram_handle: string | null;
      instagram_handle_source: 'owner' | 'website' | null;
    }>('select country, city, website_url, whatsapp_number, instagram_handle, instagram_handle_source from public.brand_memory where brand_id = $1', [brandId]);
    if (!mem) return { created: 0 };
    const facts = await tx.query<FactRow>(
      `select kind::text as kind, value, source_type::text as source_type from public.brand_facts
        where brand_id = $1 and active and kind in ('phone', 'email', 'address', 'hours') order by created_at asc, id asc`,
      [brandId],
    );
    const existing = await tx.query<{ kind: ContactKind; value: string; is_default: boolean }>(
      'select kind, value, is_default from public.contact_points where brand_id = $1',
      [brandId],
    );
    // A kind that already has a default contact (e.g. the phone the owner typed): imported ones of that kind
    // are kept but not shown on posts by default, so a post never shows two phones.
    const hasDefault = new Set<ContactKind>(existing.filter((e) => e.is_default && ONE_DEFAULT_KINDS.has(e.kind)).map((e) => e.kind));
    const have = new Set(existing.map((e) => `${e.kind}\u0000${e.value}`));
    const kindsHave = new Set(existing.map((e) => e.kind));
    const list: Candidate[] = [];
    const push = (c: Candidate) => {
      if (SINGLE_KINDS.has(c.kind) && (kindsHave.has(c.kind) || list.some((x) => x.kind === c.kind))) return;
      if (have.has(`${c.kind}\u0000${c.value}`) || list.some((x) => x.kind === c.kind && x.value === c.value)) return;
      if (c.isDefault && ONE_DEFAULT_KINDS.has(c.kind)) {
        if (hasDefault.has(c.kind)) c = { ...c, isDefault: false };
        else hasDefault.add(c.kind);
      }
      list.push(c);
    };
    const via = (input: Record<string, unknown>, source: ContactSource, isDefault = true) => {
      const n = normalizeContact(input, { country: mem.country });
      if (n.ok) push({ kind: n.kind, value: n.value, display: n.display, details: n.details, source, isDefault });
    };

    if (mem.website_url) via({ kind: 'website', value: mem.website_url }, 'setup');
    if (mem.whatsapp_number) via({ kind: 'whatsapp', value: mem.whatsapp_number }, 'setup');
    if (mem.instagram_handle) via({ kind: 'instagram', value: mem.instagram_handle }, mem.instagram_handle_source === 'website' ? 'website' : 'owner');

    for (const f of facts) {
      const source = SOURCE_OF_FACT[f.source_type];
      const text = f.value.trim().replace(/\s+/g, ' ');
      if (f.kind === 'phone') {
        const p = phoneFromText(text, mem.country);
        if (p.ok) via({ kind: 'phone', value: p.e164 }, source);
      } else if (f.kind === 'email') {
        const inText = text.match(/[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>().,;]+/g) ?? [];
        const m = normalizeEmail(text) ?? (inText.length === 1 ? normalizeEmail(inText[0]) : null);
        if (m) via({ kind: 'email', value: m }, source);
      } else if (f.kind === 'address') {
        if (text.length >= 1 && text.length <= 500) via({ kind: 'address', value: shortAddress(text), full: text }, source);
      } else if (f.kind === 'hours') {
        if (text.length >= 1 && text.length <= 500) {
          push({ kind: 'hours', value: text, display: text.length <= 120 ? text : `${text.slice(0, 119)}…`, details: { text, imported: true }, source, isDefault: true });
        }
      }
    }

    if (mem.city?.trim() && !kindsHave.has('address') && !list.some((c) => c.kind === 'address')) {
      const city = mem.city.trim().slice(0, 120);
      push({ kind: 'address', value: city, display: city, details: { full: city, cityOnly: true }, source: 'setup', isDefault: false });
    }

    let created = 0;
    const [count] = await tx.query<{ n: number }>('select count(*)::int as n from public.contact_points where brand_id = $1', [brandId]);
    let room = MAX_CONTACTS - (count?.n ?? 0);
    for (const c of list) {
      if (room <= 0) break;
      const done = await tx.query(
        `insert into public.contact_points (brand_id, kind, value, display, details, is_default, source, created_by)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8) on conflict (brand_id, kind, value) do nothing returning id`,
        [brandId, c.kind, c.value, c.display, JSON.stringify(c.details), c.isDefault, c.source, userId],
      );
      if (done.length > 0) {
        created += 1;
        room -= 1;
      }
    }
    return { created };
  });
}

/** Imports only when the brand has no contacts at all (so deleting one contact does not bring it back). */
export async function ensureContactsImported(userId: string, brandId: string): Promise<{ created: number }> {
  // Once per brand: after the first import, an owner who deletes everything isn't refilled.
  if (await detailsAlreadySeeded(userId, brandId)) return { created: 0 };
  if (await hasAnyContacts(userId, brandId)) return { created: 0 };
  return importContactsFromFacts(brandId, userId);
}
