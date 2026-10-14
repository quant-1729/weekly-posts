// Server side of the mascot (D9): the brand's Tween (its name and scarf colour), the character sheet and
// the "use in posts" switch. There is no AI call: Tween is drawn by code. Everything runs as the signed-in
// user (row-level security). See docs/architecture.md D9.

import { randomUUID } from 'node:crypto';
import { findBlockedTerm } from '@/lib/ai/mascot-blocklist';
import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { getStorage, type Storage } from '@/lib/storage';
import { cleanHex, tweenColorsFor, type BrandColorsInput, type TweenColors } from './colors';
import { computeEligibility, storeEligibility, type EligibilityInput, type StoredEligibility } from './eligibility';
import { MascotError } from './errors';
import { MAX_NAME_CHARS } from './limits';
import { sheetStoredPath } from './paths';
import { exportCharacterSheet } from './sheet';
import { parseTweenSpec, TWEEN_NAME, type TweenSpec } from './spec';

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’.-]*$/u;

export interface MascotView {
  id: string;
  name: string;
  /** The scarf colour the owner chose, or null: the brand's colours decide. */
  scarf: string | null;
  sheet_path: string | null;
}

interface MascotDbRow {
  id: string;
  name: string;
  concept: { sheet_colors?: string } | null;
  spec: unknown;
  sheet_path: string | null;
}

const COLUMNS = 'id::text as id, name, concept, spec, sheet_path';

function toView(r: MascotDbRow): MascotView {
  return { id: r.id, name: r.name.trim() || TWEEN_NAME, scarf: parseTweenSpec(r.spec).scarf, sheet_path: r.sheet_path };
}

/** What the sheet files were drawn with, to tell when the brand's colours have changed since. */
const sheetKey = (c: TweenColors) => `${c.scarf}|${c.coral}`.toLowerCase();

// ---------------------------------------------------------------------------
// Eligibility (R15a)
// ---------------------------------------------------------------------------

/**
 * The brand's eligibility, worked out from its category, tone and regulated choice as they are now.
 * The result is stored in brand_memory.mascot_eligibility when it is missing or has changed (settings
 * also recompute it on save, see saveSettings).
 */
export async function getMascotEligibility(userId: string, brandId: string): Promise<StoredEligibility> {
  return getDb().withUser(userId, async (tx) => {
    const rows = await tx.query<EligibilityInput & { mascot_eligibility: StoredEligibility | null }>(
      'select category, tone, regulated::text as regulated, mascot_eligibility from public.brand_memory where brand_id = $1',
      [brandId],
    );
    const r = rows[0];
    if (!r) throw new BrandAccessError();
    const fresh = computeEligibility(r);
    const e = r.mascot_eligibility;
    if (e && e.eligible === fresh.eligible && e.reason === fresh.reason && e.canOverride === fresh.canOverride) return e;
    return storeEligibility(tx, brandId, r);
  });
}

/** A regulated brand never gets a mascot; a formal one needs to confirm "Try anyway" before it first gets one. */
function assertMayHave(e: StoredEligibility, hasMascot: boolean, tryAnyway: boolean | undefined): void {
  if (e.reason === 'regulated') throw new MascotError('not_eligible');
  if (!e.eligible && !hasMascot) {
    if (!e.canOverride) throw new MascotError('not_eligible');
    if (tryAnyway !== true) throw new MascotError('formal_needs_confirm');
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface BrandInfo {
  business_name: string | null;
  colors: BrandColorsInput | null;
  mascot_in_posts: boolean;
}

async function loadBrand(userId: string, brandId: string): Promise<{ info: BrandInfo; row: MascotDbRow | null }> {
  return getDb().withUser(userId, async (tx) => {
    const [info] = await tx.query<BrandInfo>('select business_name, colors, mascot_in_posts from public.brand_memory where brand_id = $1', [brandId]);
    if (!info) throw new BrandAccessError();
    const [row] = await tx.query<MascotDbRow>(`select ${COLUMNS} from public.mascots where brand_id = $1 and status = 'active'`, [brandId]);
    return { info, row: row ?? null };
  });
}

export interface MascotScreenData {
  eligibility: StoredEligibility;
  /** The brand's Tween, or null until the owner turns it on or saves a choice. */
  mascot: MascotView | null;
  /** brand_memory.mascot_in_posts: weekly posts use the mascot. */
  inPosts: boolean;
  /** The brand's palette, for the swatches. */
  brandColors: BrandColorsInput;
  /** The colours Tween is drawn in now (the mascot's, or the brand's before one is saved). */
  colors: TweenColors;
}

/** What the mascot screen shows. Before a mascot is saved, it previews Tween in the brand's colours. */
export async function getMascotScreen(userId: string, brandId: string): Promise<MascotScreenData> {
  const eligibility = await getMascotEligibility(userId, brandId);
  const { info, row } = await loadBrand(userId, brandId);
  const mascot = row ? toView(row) : null;
  const colors = tweenColorsFor(info.colors, mascot?.scarf ?? null);
  return {
    eligibility,
    mascot,
    // A regulated brand never uses one, whatever an older setting says.
    inPosts: info.mascot_in_posts && mascot !== null && eligibility.reason !== 'regulated',
    brandColors: info.colors ?? {},
    colors,
  };
}

/** The brand's active mascot (or null). */
export async function getActiveMascot(userId: string, brandId: string): Promise<MascotView | null> {
  const { row } = await loadBrand(userId, brandId);
  return row ? toView(row) : null;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/** The owner's name for the character: short, plain letters, not on the blocklist. Empty means "Tween". */
export function cleanMascotName(raw: unknown, businessName: string): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) return TWEEN_NAME;
  if ([...name].length > MAX_NAME_CHARS || !NAME_RE.test(name)) throw new MascotError('bad_name');
  if (findBlockedTerm(name, [businessName])) throw new MascotError('blocked_name');
  return name;
}

/**
 * Saves the brand's Tween: its name and scarf colour (`undefined` keeps what it has; `null` for the scarf goes back
 * to the brand's colours). Creates the mascot when there is none. Draws the character sheet and the pose files into
 * storage first, so if that fails nothing changes. Old posts keep the images they were made with.
 * Throws MascotError (not_eligible, formal_needs_confirm, bad_name, blocked_name, bad_color) or BrandAccessError.
 */
export async function saveMascot(args: {
  userId: string;
  brandId: string;
  name?: string;
  scarf?: string | null;
  tryAnyway?: boolean;
  storage?: Storage;
}): Promise<MascotView> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const eligibility = await getMascotEligibility(userId, brandId);
  const { info, row } = await loadBrand(userId, brandId);
  assertMayHave(eligibility, row !== null, args.tryAnyway);

  const businessName = (info.business_name ?? '').trim();
  const name = args.name === undefined ? (row ? toView(row).name : TWEEN_NAME) : cleanMascotName(args.name, businessName);
  let scarf: string | null;
  if (args.scarf === undefined) scarf = row ? parseTweenSpec(row.spec).scarf : null;
  else if (args.scarf === null) scarf = null;
  else {
    scarf = cleanHex(args.scarf);
    if (!scarf) throw new MascotError('bad_color');
  }

  const id = row?.id ?? randomUUID();
  const colors = tweenColorsFor(info.colors, scarf);
  await exportCharacterSheet({ brandId, mascotId: id, colors, name, storage: args.storage ?? getStorage() });

  const spec: TweenSpec = { v: 2, base: 'tween', scarf };
  const concept = { sheet_colors: sheetKey(colors) };
  const saved = await getDb().withUser(userId, async (tx) => {
    if (row) {
      const [done] = await tx.query<MascotDbRow>(
        `update public.mascots set name = $3, spec = $4::jsonb, concept = $5::jsonb, sheet_path = $6
          where id = $2 and brand_id = $1 and status = 'active' returning ${COLUMNS}`,
        [brandId, id, name, JSON.stringify(spec), JSON.stringify(concept), sheetStoredPath(brandId, id)],
      );
      if (!done) throw new MascotError('not_found');
      return done;
    }
    const [made] = await tx.query<MascotDbRow>(
      `insert into public.mascots (id, brand_id, status, name, concept, spec, sheet_path, created_by)
       values ($1, $2, 'active', $3, $4::jsonb, $5::jsonb, $6, $7) returning ${COLUMNS}`,
      [id, brandId, name, JSON.stringify(concept), JSON.stringify(spec), sheetStoredPath(brandId, id), userId],
    );
    return made;
  });
  return toView(saved);
}

/**
 * Draws the sheet and pose files again when the brand's colours have changed since they were made (or an older
 * mascot has none in the new style). Cheap when nothing changed. Returns true when it redrew.
 */
export async function refreshSheetIfStale(userId: string, brandId: string, storage: Storage = getStorage()): Promise<boolean> {
  const { info, row } = await loadBrand(userId, brandId);
  if (!row) return false;
  const colors = tweenColorsFor(info.colors, parseTweenSpec(row.spec).scarf);
  if (row.sheet_path && row.concept?.sheet_colors === sheetKey(colors) && parseTweenSpec(row.spec).v === 2) return false;
  const view = toView(row);
  await exportCharacterSheet({ brandId, mascotId: row.id, colors, name: view.name, storage });
  const spec: TweenSpec = { v: 2, base: 'tween', scarf: view.scarf };
  await getDb().withUser(userId, (tx) =>
    tx.query("update public.mascots set spec = $3::jsonb, concept = $4::jsonb, sheet_path = $5 where id = $2 and brand_id = $1 and status = 'active'", [
      brandId,
      row.id,
      JSON.stringify(spec),
      JSON.stringify({ sheet_colors: sheetKey(colors) }),
      sheetStoredPath(brandId, row.id),
    ]),
  );
  return true;
}

// ---------------------------------------------------------------------------
// The brand page (V-25): status card and the "use in posts" switch
// ---------------------------------------------------------------------------

export interface MascotCard {
  eligibility: StoredEligibility;
  /** The brand's Tween, or null until it is first turned on. */
  active: { id: string; name: string } | null;
  /** brand_memory.mascot_in_posts: weekly posts use the mascot. */
  inPosts: boolean;
  /** The colours Tween is drawn in now. */
  colors: TweenColors;
}

export async function getMascotCard(userId: string, brandId: string): Promise<MascotCard> {
  const s = await getMascotScreen(userId, brandId);
  return { eligibility: s.eligibility, active: s.mascot ? { id: s.mascot.id, name: s.mascot.name } : null, inPosts: s.inPosts, colors: s.colors };
}

/**
 * Switches "Use the mascot in my posts". Turning it on creates the brand's Tween when there is none (no AI call)
 * and needs a brand that may have one (a formal brand must have confirmed "Try anyway"). Turning it off always
 * works. Posts already made are not changed.
 */
export async function setMascotInPosts(
  userId: string,
  brandId: string,
  on: boolean,
  opts: { tryAnyway?: boolean; storage?: Storage } = {},
): Promise<boolean> {
  await requireBrandMember(userId, brandId);
  if (on) {
    const { row } = await loadBrand(userId, brandId);
    assertMayHave(await getMascotEligibility(userId, brandId), row !== null, opts.tryAnyway);
    if (!row) await saveMascot({ userId, brandId, tryAnyway: opts.tryAnyway, storage: opts.storage });
  }
  const done = await getDb().withUser(userId, (tx) =>
    tx.query('update public.brand_memory set mascot_in_posts = $2 where brand_id = $1 returning brand_id', [brandId, on]),
  );
  if (done.length === 0) throw new BrandAccessError();
  return on;
}
