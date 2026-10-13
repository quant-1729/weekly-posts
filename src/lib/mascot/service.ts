// Server side of the mascot flow (R15): eligibility, 3 concepts, pick + character
// sheet, regenerate. Everything runs as the signed-in user (row-level security),
// except usage counting. See docs/mascot.md.

import { generateJson } from '@/lib/ai/client';
import { findBlockedTerm } from '@/lib/ai/mascot-blocklist';
import { buildMascotPrompt } from '@/lib/ai/prompts/mascot';
import {
  mascotConceptsJsonSchema,
  mascotConceptsSchema,
  mascotSpecSchema,
  type MascotConcepts,
  type MascotSpec,
} from '@/lib/ai/schemas';
import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { getStorage, type Storage } from '@/lib/storage';
import { assertUnderDailyCap, failedCallUsd, recordUsage } from '@/lib/usage';
import { assertUnderWeeklyCap } from '@/lib/usage/caps';
import { keepGoodConcepts, type Concept } from './concepts';
import { computeEligibility, storeEligibility, type EligibilityInput, type StoredEligibility } from './eligibility';
import { MascotError } from './errors';
import { FIXTURE_CONCEPTS } from './fixtures';
import { sheetStoredPath } from './paths';
import { exportCharacterSheet } from './sheet';

const WANTED = 3;
const MAX_HINT = 300;

export interface MascotView {
  id: string;
  status: 'concept' | 'active';
  name: string;
  name_local: string;
  personality: string;
  why_it_fits: string;
  spec: MascotSpec;
  sheet_path: string | null;
}

interface MascotDbRow {
  id: string;
  status: 'concept' | 'active' | 'discarded' | 'archived';
  name: string;
  concept: { name_local?: string; personality?: string; why_it_fits?: string } | null;
  spec: unknown;
  sheet_path: string | null;
}

function toView(r: MascotDbRow): MascotView | null {
  const spec = mascotSpecSchema.safeParse(r.spec);
  if (!spec.success || (r.status !== 'concept' && r.status !== 'active')) return null;
  return {
    id: r.id,
    status: r.status,
    name: r.name,
    name_local: r.concept?.name_local ?? '',
    personality: r.concept?.personality ?? '',
    why_it_fits: r.concept?.why_it_fits ?? '',
    spec: spec.data,
    sheet_path: r.sheet_path,
  };
}

const COLUMNS = 'id, status::text as status, name, concept, spec, sheet_path';

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

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The active mascot (or null) and the open concepts, for the mascot screen. */
export async function getMascotScreen(userId: string, brandId: string): Promise<{ active: MascotView | null; concepts: MascotView[] }> {
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<MascotDbRow>(
      `select ${COLUMNS} from public.mascots
        where brand_id = $1 and status in ('active', 'concept') order by created_at asc, id asc`,
      [brandId],
    ),
  );
  const views = rows.map(toView).filter((v): v is MascotView => v !== null);
  return { active: views.find((v) => v.status === 'active') ?? null, concepts: views.filter((v) => v.status === 'concept') };
}

/** The brand's active mascot, or null. For templates and the generate pipeline (part B). */
export async function getActiveMascot(userId: string, brandId: string): Promise<MascotView | null> {
  return (await getMascotScreen(userId, brandId)).active;
}


// ---------------------------------------------------------------------------
// Concepts (R15b, R15g)
// ---------------------------------------------------------------------------

export interface ConceptsResult {
  concepts: MascotView[];
  /** True when fewer than 3 concepts survived the checks. */
  fewer: boolean;
  /** How long the whole thing took, in ms (the AC is under 60 000). */
  ms: number;
}

/** Test and dev hooks. Production code passes none. */
export interface ConceptsDeps {
  /** Replaces the fixture-mode answer (used only when the model is not live). May throw to simulate a failed call. */
  fixture?: () => MascotConcepts;
  now?: Date;
}

// One idea run is at most two calls (the second only when some ideas were rejected). With these
// limits both fit inside the 60 seconds the owner is promised.
const CALL = { temperature: 0.9, timeoutMs: 20_000, budgetMs: 25_000 } as const;
const TOTAL_BUDGET_MS = 55_000;

interface BrandInfo {
  business_name: string | null;
  category: string | null;
  city: string | null;
  audience: string | null;
  tone: string | null;
  post_language: string;
  colors: { primary?: string; secondary?: string; accent?: string } | null;
}

/** Product names only (never prices) from the brand's facts. */
async function loadBrandInfo(userId: string, brandId: string): Promise<{ info: BrandInfo; products: string[] }> {
  return getDb().withUser(userId, async (tx) => {
    const [info] = await tx.query<BrandInfo>(
      'select business_name, category, city, audience, tone, post_language, colors from public.brand_memory where brand_id = $1',
      [brandId],
    );
    if (!info) throw new BrandAccessError();
    const facts = await tx.query<{ label: string | null }>(
      "select label from public.brand_facts where brand_id = $1 and active and kind = 'product' and label is not null order by created_at, id limit 8",
      [brandId],
    );
    return { info, products: facts.map((f) => (f.label ?? '').trim()).filter(Boolean) };
  });
}

/**
 * Makes up to 3 mascot concepts and saves them as `concept` rows (older open
 * concepts are discarded). Refuses before any AI call when the brand is not
 * eligible or the hint names something blocked. Throws MascotError,
 * BrandAccessError, DailyCapError, WeeklyCapError or AiError.
 */
export async function generateMascotConcepts(
  args: { userId: string; brandId: string; hint?: string; tryAnyway?: boolean },
  deps: ConceptsDeps = {},
): Promise<ConceptsResult> {
  const t0 = Date.now();
  const { userId, brandId } = args;
  const now = deps.now ?? new Date();
  await requireBrandMember(userId, brandId);
  const { info, products } = await loadBrandInfo(userId, brandId);
  const businessName = (info.business_name ?? '').trim();

  const elig = await getMascotEligibility(userId, brandId);
  if (!elig.eligible) {
    if (elig.reason === 'regulated' || !elig.canOverride) throw new MascotError('not_eligible');
    if (!args.tryAnyway) throw new MascotError('formal_needs_confirm');
  }

  const hint = (args.hint ?? '').trim().slice(0, MAX_HINT);
  // Checked in code first: a blocked hint costs no AI call. The business name is
  // ignored so "Shri Ram Sweets" in a hint is not a hit.
  if (findBlockedTerm(hint, [businessName])) throw new MascotError('blocked_hint');

  // Both limits are checked once per run, before the first call. A run is one usage event.
  await assertUnderDailyCap(brandId, now);
  await assertUnderWeeklyCap(brandId, 'mascot', { now });

  const prompt = buildMascotPrompt({
    postLanguage: info.post_language || 'en',
    businessName,
    category: info.category ?? '',
    city: info.city ?? '',
    audience: info.audience ?? '',
    tone: info.tone ?? '',
    productNames: products,
    colors: info.colors ?? {},
    hint,
  });

  let usd = 0;
  const callOnce = async (budgetMs: number) => {
    try {
      const { data, stats } = await generateJson({
        system: prompt.system,
        user: prompt.user,
        zodSchema: mascotConceptsSchema,
        jsonSchema: mascotConceptsJsonSchema,
        temperature: CALL.temperature,
        timeoutMs: Math.min(CALL.timeoutMs, budgetMs),
        budgetMs,
        logContext: { brandId },
        fixture: deps.fixture ?? FIXTURE_CONCEPTS,
      });
      usd += stats?.usd ?? 0;
      return data;
    } catch (e) {
      usd += failedCallUsd(e); // an answer that did not validate still cost money (H-2)
      throw e;
    }
  };

  let good: Concept[];
  try {
    const first = await callOnce(CALL.budgetMs);
    if (first.refused) throw new MascotError('refused', first.refusal_reason.trim());
    good = keepGoodConcepts(first.concepts, businessName);

    // Some ideas were rejected (a blocked name, a copied look): ask once more, if there is time.
    const timeLeft = TOTAL_BUDGET_MS - (Date.now() - t0);
    if (good.length < WANTED && timeLeft >= 10_000) {
      try {
        const second = await callOnce(Math.min(CALL.budgetMs, timeLeft));
        if (!second.refused) good = keepGoodConcepts([...good, ...second.concepts], businessName);
      } catch (e) {
        // Show what we have; only fail when there is nothing to show.
        if (good.length === 0) throw e;
      }
    }
  } finally {
    // The run was attempted, so it counts against the limits even if it failed.
    await recordUsage(brandId, userId, 'mascot', usd);
  }
  good = good.slice(0, WANTED);
  if (good.length === 0) throw new MascotError('none');

  const rows = await getDb().withUser(userId, async (tx) => {
    // New ideas replace any earlier open ones. The active mascot is not touched.
    await tx.query("update public.mascots set status = 'discarded' where brand_id = $1 and status = 'concept'", [brandId]);
    const out: MascotDbRow[] = [];
    for (const c of good) {
      const [row] = await tx.query<MascotDbRow>(
        `insert into public.mascots (brand_id, status, name, concept, spec, created_by)
         values ($1, 'concept', $2, $3::jsonb, $4::jsonb, $5)
         returning ${COLUMNS}`,
        [
          brandId,
          c.name.trim(),
          JSON.stringify({ name: c.name.trim(), name_local: c.name_local, personality: c.personality, why_it_fits: c.why_it_fits }),
          JSON.stringify(c.spec),
          userId,
        ],
      );
      out.push(row);
    }
    return out;
  });
  const concepts = rows.map(toView).filter((v): v is MascotView => v !== null);
  return { concepts, fewer: concepts.length < WANTED, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Pick + character sheet (R15c) and regenerate (R15e)
// ---------------------------------------------------------------------------

/**
 * Makes the chosen concept the active mascot: draws its 8 poses and the sheet
 * into storage, then in one transaction archives the previous active mascot,
 * activates this one and discards the other open concepts. If anything fails,
 * nothing changes (the old mascot stays active). Old posts keep their mascot_id.
 */
export async function pickMascot(args: {
  userId: string;
  brandId: string;
  mascotId: string;
  storage?: Storage;
}): Promise<MascotView> {
  const { userId, brandId, mascotId } = args;
  await requireBrandMember(userId, brandId);

  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<MascotDbRow>(`select ${COLUMNS} from public.mascots where id = $1 and brand_id = $2`, [mascotId, brandId]),
  );
  if (!row) throw new MascotError('not_found');
  if (row.status === 'active') {
    const v = toView(row);
    if (v) return v;
  }
  if (row.status !== 'concept') throw new MascotError('not_found');
  const spec = mascotSpecSchema.safeParse(row.spec);
  if (!spec.success) throw new MascotError('bad_spec');

  await exportCharacterSheet({
    brandId,
    mascotId,
    spec: spec.data,
    names: { name: row.name, name_local: row.concept?.name_local },
    storage: args.storage ?? getStorage(),
  });

  const picked = await getDb().withUser(userId, async (tx) => {
    // Order matters: the unique index allows one active mascot per brand.
    await tx.query("update public.mascots set status = 'archived' where brand_id = $1 and status = 'active'", [brandId]);
    const [done] = await tx.query<MascotDbRow>(
      `update public.mascots set status = 'active', sheet_path = $3
        where id = $2 and brand_id = $1 and status = 'concept'
        returning ${COLUMNS}`,
      [brandId, mascotId, sheetStoredPath(brandId, mascotId)],
    );
    if (!done) throw new MascotError('not_found'); // rolls the archive back
    await tx.query("update public.mascots set status = 'discarded' where brand_id = $1 and status = 'concept' and id <> $2", [brandId, mascotId]);
    return done;
  });
  const view = toView(picked);
  if (!view) throw new MascotError('bad_spec');
  return view;
}

// ---------------------------------------------------------------------------
// The brand page (V-25): status card and the "use in posts" switch
// ---------------------------------------------------------------------------

export interface MascotCard {
  eligibility: StoredEligibility;
  /** The active mascot, or null. */
  active: { id: string; name: string } | null;
  /** brand_memory.mascot_in_posts: weekly posts use the mascot. */
  inPosts: boolean;
}

export async function getMascotCard(userId: string, brandId: string): Promise<MascotCard> {
  const eligibility = await getMascotEligibility(userId, brandId);
  const [active, mem] = await getDb().withUser(userId, async (tx) => [
    (await tx.query<{ id: string; name: string }>("select id::text as id, name from public.mascots where brand_id = $1 and status = 'active'", [brandId]))[0] ?? null,
    (await tx.query<{ mascot_in_posts: boolean }>('select mascot_in_posts from public.brand_memory where brand_id = $1', [brandId]))[0],
  ] as const);
  if (!mem) throw new BrandAccessError();
  // A regulated brand never uses one, whatever an older setting says.
  return { eligibility, active, inPosts: mem.mascot_in_posts && active !== null && eligibility.reason !== 'regulated' };
}

/**
 * Switches "Use my mascot in posts". Turning it on needs an active mascot and a brand that may have
 * one. Turning it off always works. Posts already made are not changed.
 */
export async function setMascotInPosts(userId: string, brandId: string, on: boolean): Promise<boolean> {
  await requireBrandMember(userId, brandId);
  if (on) {
    const card = await getMascotCard(userId, brandId);
    if (card.eligibility.reason === 'regulated') throw new MascotError('not_eligible');
    if (!card.active) throw new MascotError('none');
  }
  const done = await getDb().withUser(userId, (tx) =>
    tx.query('update public.brand_memory set mascot_in_posts = $2 where brand_id = $1 returning brand_id', [brandId, on]),
  );
  if (done.length === 0) throw new BrandAccessError();
  return on;
}
