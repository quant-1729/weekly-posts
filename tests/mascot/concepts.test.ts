import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/client', async (orig) => {
  const mod = await orig<typeof import('@/lib/ai/client')>();
  return { ...mod, generateJson: vi.fn(mod.generateJson) };
});

import { generateJson } from '@/lib/ai/client';
import { BrandAccessError } from '@/lib/brand/current';
import type { MockDb } from '@/lib/db/mock';
import { conceptProblem, hasExcludedCombination, keepGoodConcepts } from '@/lib/mascot/concepts';
import { describeMascotError, MascotError } from '@/lib/mascot/errors';
import { FIXTURE_CONCEPTS } from '@/lib/mascot/fixtures';
import { generateMascotConcepts, getMascotEligibility } from '@/lib/mascot/service';
import { DailyCapError } from '@/lib/usage';
import { WEEKLY_MASCOT_RUNS, WeeklyCapError } from '@/lib/usage/caps';
import { closeTestDb, createUser, openTestDb } from '../brand/helpers';
import { seedWeeklyBrand } from '../weekly/helpers';
import { answer, concept } from './helpers';

const ai = vi.mocked(generateJson);
let db: MockDb;
let outsider: string;
beforeAll(async () => {
  db = await openTestDb();
  outsider = (await createUser(db)).id;
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(() => {
  ai.mockClear();
});

const bakery = () => seedWeeklyBrand(db, { name: 'Corner Bakery' });
const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Record<string, unknown>>(sql, params));
const usage = async (brandId: string) => (await rows("select usd from public.usage_events where brand_id = $1 and kind = 'mascot'", [brandId])).length;

describe('blocked hints are refused before any AI call (R15g)', () => {
  const HINTS = [
    'make it look like Paddington Bear',
    'a Taylor Swift style cupcake',
    'like the Michelin man but bread',
    'Trump as a donut',
    'SpongeBob but a sponge cake',
    'a little Minion baker',
    'Elon Musk with a spatula',
    'Pikachu in a chef hat',
    'Shah Rukh Khan jaisa',
    'ek chhota Hanuman ji jaisa mascot',
    'Chhota Bheem style',
    'a Doraemon type robot',
    'Make it Jesus with a loaf',
    'गणेश जी वाला मascot',
    'धोनी जैसा',
    'मोदी जी की तरह',
    'छोटा भीम जैसा',
  ];

  it('has at least 12 cases, in English, Hindi and global names', () => {
    expect(HINTS.length).toBeGreaterThanOrEqual(12);
  });

  it.each(HINTS)('refuses "%s" and makes no AI call', async (hint) => {
    const { userId, brandId } = await bakery();
    const err = await generateMascotConcepts({ userId, brandId, hint }).catch((e) => e);
    expect(err).toBeInstanceOf(MascotError);
    expect(err.code).toBe('blocked_hint');
    expect(ai).not.toHaveBeenCalled();
    expect(await usage(brandId)).toBe(0);
    expect(describeMascotError(err).message).toMatch(/real person, a god/);
    expect(await rows('select 1 from public.mascots where brand_id = $1', [brandId])).toHaveLength(0);
  });

  it('lets a harmless hint through, and ignores the business name in the hint', async () => {
    const { userId, brandId } = await bakery();
    const res = await generateMascotConcepts({ userId, brandId, hint: 'a happy croissant with a chef hat' });
    expect(res.concepts).toHaveLength(3);
    expect(ai).toHaveBeenCalledTimes(1);
    await db.withAdmin((tx) => tx.query("update public.brand_memory set business_name = 'Shri Ram Sweets' where brand_id = $1", [brandId]));
    await expect(generateMascotConcepts({ userId, brandId, hint: 'mascot for Shri Ram Sweets, a laddoo' })).resolves.toBeTruthy();
  });

  it('refuses when the model itself refuses, with its reason', async () => {
    const { userId, brandId } = await bakery();
    const refused = { refused: true, refusal_reason: 'That looks like a famous character.', concepts: [] };
    const err = await generateMascotConcepts({ userId, brandId, hint: 'a nice bun' }, { fixture: () => refused }).catch((e) => e);
    expect(err).toMatchObject({ code: 'refused' });
    expect(describeMascotError(err).message).toBe('That looks like a famous character.');
    expect(ai).toHaveBeenCalledTimes(1);
  });
});

describe('eligibility (R15a)', () => {
  it('a regulated brand is never offered a mascot, and Try anyway does not help', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Smile Dental', category: 'dental clinic' });
    expect((await getMascotEligibility(userId, brandId)).reason).toBe('regulated');
    for (const tryAnyway of [false, true]) {
      const err = await generateMascotConcepts({ userId, brandId, tryAnyway }).catch((e) => e);
      expect(err).toMatchObject({ code: 'not_eligible' });
    }
    expect(ai).not.toHaveBeenCalled();
  });

  it('a formal brand needs Try anyway', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Grey and Co' });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set tone = 'professional' where brand_id = $1", [brandId]));
    const e = await getMascotEligibility(userId, brandId);
    expect(e).toMatchObject({ eligible: false, reason: 'formal', canOverride: true });
    await expect(generateMascotConcepts({ userId, brandId })).rejects.toMatchObject({ code: 'formal_needs_confirm' });
    expect(ai).not.toHaveBeenCalled();
    const res = await generateMascotConcepts({ userId, brandId, tryAnyway: true });
    expect(res.concepts).toHaveLength(3);
  });

  it("the owner's regulated choice wins over what we detect", async () => {
    const health = await seedWeeklyBrand(db, { name: 'Corner Bakery', category: 'bakery', regulated: 'health' });
    expect((await getMascotEligibility(health.userId, health.brandId)).reason).toBe('regulated');
    await expect(generateMascotConcepts({ userId: health.userId, brandId: health.brandId })).rejects.toMatchObject({ code: 'not_eligible' });
    const none = await seedWeeklyBrand(db, { name: 'Dental Toys', category: 'dental clinic', regulated: 'none' });
    expect((await getMascotEligibility(none.userId, none.brandId)).eligible).toBe(true);
  });

  it('stores the result and keeps it in step with the brand', async () => {
    const { userId, brandId } = await bakery();
    const stored = async () => (await rows('select mascot_eligibility as e from public.brand_memory where brand_id = $1', [brandId]))[0].e as Record<string, unknown>;
    await getMascotEligibility(userId, brandId);
    expect(await stored()).toMatchObject({ eligible: true, reason: 'ok', canOverride: false });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set category = 'funeral services' where brand_id = $1", [brandId]));
    expect((await getMascotEligibility(userId, brandId)).reason).toBe('formal');
    expect(await stored()).toMatchObject({ eligible: false, reason: 'formal', canOverride: true });
  });
});

describe('concept checks', () => {
  it('drops blocked names, blocked personalities, copied looks and bad names', () => {
    const topi = { ...FIXTURE_CONCEPTS.concepts[0].spec, head: 'topi' as const, neck: 'bow' as const, face: { ...FIXTURE_CONCEPTS.concepts[0].spec.face, mustache: 'thin' as const } };
    expect(hasExcludedCombination(topi)).toBe(true);
    expect(conceptProblem(concept('Hanuman'), 'Corner Bakery')).toBe('blocked');
    expect(conceptProblem(concept('Mickey'), 'Corner Bakery')).toBe('blocked');
    expect(conceptProblem(concept('Bun', { name_local: 'डोरेमोन' }), 'Corner Bakery')).toBe('blocked');
    expect(conceptProblem(concept('Bun', { personality: 'A cheerful bun who looks like Doraemon.' }), 'Corner Bakery')).toBe('blocked');
    expect(conceptProblem(concept('Bun', { spec: topi }), 'Corner Bakery')).toBe('excluded_combination');
    expect(conceptProblem(concept(''), 'Corner Bakery')).toBe('invalid_name');
    expect(conceptProblem(concept('A very long mascot name'), 'Corner Bakery')).toBe('invalid_name');
    expect(conceptProblem(concept('Bun'), 'Corner Bakery')).toBeNull();
    expect(keepGoodConcepts([concept('Bun'), concept('bun'), concept('Hanuman'), concept('Pip')], 'Corner Bakery').map((c) => c.name)).toEqual(['Bun', 'Pip']);
  });

  it('three good concepts come back from one call, saved as concept rows, in well under 60 seconds', async () => {
    const { userId, brandId } = await bakery();
    const res = await generateMascotConcepts({ userId, brandId });
    expect(res.concepts).toHaveLength(3);
    expect(res.fewer).toBe(false);
    expect(res.ms).toBeLessThan(60_000);
    expect(ai).toHaveBeenCalledTimes(1);
    expect((await rows('select status::text as s from public.mascots where brand_id = $1', [brandId])).map((r) => r.s)).toEqual(['concept', 'concept', 'concept']);
    expect(await usage(brandId)).toBe(1);
  });

  it('passes the post language, the colours and product names (no prices) to the prompt', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, {
      name: 'Corner Bakery',
      facts: [
        { kind: 'product', label: 'Sourdough loaf', value: '£4.50' },
        { kind: 'price', label: 'Cake', value: '£20' },
      ],
    });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set post_language = 'hi' where brand_id = $1", [brandId]));
    await generateMascotConcepts({ userId, brandId });
    const call = ai.mock.calls[0][0] as { user: string };
    expect(call.user).toContain('POST LANGUAGE: hi');
    expect(call.user).toContain('Sourdough loaf');
    expect(call.user).not.toContain('£');
  });

  it('retries once when concepts are dropped, and shows what is left', async () => {
    const { userId, brandId } = await bakery();
    const answers = [answer(concept('Hanuman'), concept('Mickey'), concept('Bun')), answer(concept('Pip'), concept('Doraemon'), concept('Zuzu'))];
    let n = 0;
    const res = await generateMascotConcepts({ userId, brandId }, { fixture: () => answers[n++] });
    expect(ai).toHaveBeenCalledTimes(2);
    expect(res.concepts.map((c) => c.name)).toEqual(['Bun', 'Pip', 'Zuzu']);
    expect(res.fewer).toBe(false);
    expect(await usage(brandId)).toBe(1); // one run, however many calls
  });

  it('shows one concept when only one survives both calls (at least 1 shown)', async () => {
    const { userId, brandId } = await bakery();
    const answers = [answer(concept('Hanuman'), concept('Mickey'), concept('Bun')), answer(concept('Krishna'), concept('Elmo'), concept('Bun'))];
    let n = 0;
    const res = await generateMascotConcepts({ userId, brandId }, { fixture: () => answers[n++] });
    expect(ai).toHaveBeenCalledTimes(2);
    expect(res.concepts.map((c) => c.name)).toEqual(['Bun']);
    expect(res.fewer).toBe(true);
  });

  it('shows what it has when the retry fails', async () => {
    const { userId, brandId } = await bakery();
    let n = 0;
    const res = await generateMascotConcepts(
      { userId, brandId },
      {
        fixture: () => {
          if (n++ === 0) return answer(concept('Bun'), concept('Hanuman'), concept('Mickey'));
          throw new Error('model down');
        },
      },
    );
    expect(res.concepts.map((c) => c.name)).toEqual(['Bun']);
  });

  it('fails plainly when nothing survives, after exactly one retry', async () => {
    const { userId, brandId } = await bakery();
    const allBlocked = () => answer(concept('Hanuman'), concept('Mickey'), concept('Doraemon'));
    const err = await generateMascotConcepts({ userId, brandId }, { fixture: allBlocked }).catch((e) => e);
    expect(err).toMatchObject({ code: 'none' });
    expect(ai).toHaveBeenCalledTimes(2);
    expect(await rows('select 1 from public.mascots where brand_id = $1', [brandId])).toHaveLength(0);
  });

  it('a new set of concepts replaces the open ones and never touches the active mascot', async () => {
    const { userId, brandId } = await bakery();
    const [active] = await rows(`insert into public.mascots (brand_id, status, name, spec) values ($1, 'active', 'Old', $2::jsonb) returning id::text as id`, [
      brandId,
      JSON.stringify(FIXTURE_CONCEPTS.concepts[0].spec),
    ]);
    await generateMascotConcepts({ userId, brandId });
    await generateMascotConcepts({ userId, brandId });
    const all = await rows('select id::text as id, status::text as s from public.mascots where brand_id = $1 order by created_at, id', [brandId]);
    expect(all.filter((r) => r.s === 'concept')).toHaveLength(3);
    expect(all.filter((r) => r.s === 'discarded')).toHaveLength(3);
    expect(all.filter((r) => r.s === 'active').map((r) => r.id)).toEqual([active.id]);
  });
});

describe('caps', () => {
  it(`allows ${WEEKLY_MASCOT_RUNS} idea runs a week, then refuses without an AI call`, async () => {
    const { userId, brandId } = await bakery();
    for (let i = 0; i < WEEKLY_MASCOT_RUNS; i++) await generateMascotConcepts({ userId, brandId });
    expect(ai).toHaveBeenCalledTimes(WEEKLY_MASCOT_RUNS);
    const err = await generateMascotConcepts({ userId, brandId }).catch((e) => e);
    expect(err).toBeInstanceOf(WeeklyCapError);
    expect(err).toMatchObject({ kind: 'mascot', reason: 'count' });
    expect(describeMascotError(err)).toMatchObject({ code: 'cap', message: "You've used this week's mascot ideas. They reset on Monday." });
    expect(ai).toHaveBeenCalledTimes(WEEKLY_MASCOT_RUNS);
    expect(await usage(brandId)).toBe(WEEKLY_MASCOT_RUNS);
  });

  it('a failed call still counts as a run', async () => {
    const { userId, brandId } = await bakery();
    await expect(
      generateMascotConcepts(
        { userId, brandId },
        {
          fixture: () => {
            throw new Error('model down');
          },
        },
      ),
    ).rejects.toBeTruthy();
    expect(await usage(brandId)).toBe(1);
  });

  it("stops at the brand's daily limit with no AI call", async () => {
    const { userId, brandId } = await bakery();
    await db.withAdmin((tx) => tx.query('update public.brands set daily_generation_cap = 0 where id = $1', [brandId]));
    const err = await generateMascotConcepts({ userId, brandId }).catch((e) => e);
    expect(err).toBeInstanceOf(DailyCapError);
    expect(describeMascotError(err).code).toBe('cap');
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("only members can use a brand's mascot", () => {
  it('blocks a signed-in user who is not a member', async () => {
    const { brandId } = await bakery();
    await expect(generateMascotConcepts({ userId: outsider, brandId })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(getMascotEligibility(outsider, brandId)).rejects.toBeInstanceOf(BrandAccessError);
    expect(ai).not.toHaveBeenCalled();
    expect(await usage(brandId)).toBe(0);
  });
});
