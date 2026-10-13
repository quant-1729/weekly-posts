import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { V2FactCheck } from '@/lib/ai/schemas-v2';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { runGuardrail } from '@/lib/guardrail';
import { checkPostDeterministic } from '@/lib/guardrail/deterministic';
import { asWeeklyFacts, brandFactRows, brands, seedBrand, type TestFact } from './helpers';

type Post = { caption: string; cta: string; image_text: { headline: string; subline: string } };
interface Planted {
  id: string;
  brand_id: string;
  channel: string;
  post: Post;
  planted: Array<{ text: string; kind: string; field: V2FactCheck['facts'][number]['field'] }>;
  allowed: string[];
}
const cases: Planted[] = JSON.parse(readFileSync('test-data/v2/guardrail/planted-30.json', 'utf8'));
const channel = (c: string) => (c === 'google_business_profile' ? 'gbp' : (c as 'instagram' | 'facebook' | 'linkedin'));
const overlaps = (a: string, b: string) => a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));

let db: MockDb;
const seeded = new Map<string, { userId: string; brandId: string }>();

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  for (const b of brands) {
    seeded.set(
      b.id,
      await seedBrand(db, { name: b.business_name, category: b.what_they_sell, regulated: b.regulated, facts: brandFactRows(b.id) as TestFact[] }),
    );
  }
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

/** What a perfect AI layer would return: every planted span, unsupported. */
const fixtureFor = (c: Planted): V2FactCheck => ({
  facts: c.planted.map((p) => ({ post: 1, field: p.field, text: p.text, kind: p.kind as V2FactCheck['facts'][number]['kind'], supported: false, fact_id: '', outcome_promise: false })),
});

describe('planted-30 (AC 11), fixture AI built from each case\'s planted list', () => {
  it('has 30 cases', () => expect(cases).toHaveLength(30));

  it('flags 100% of planted spans through runGuardrail (merge path)', async () => {
    let planted = 0;
    let caught = 0;
    const missed: string[] = [];
    for (const c of cases) {
      const { userId, brandId } = seeded.get(c.brand_id)!;
      const [res] = await runGuardrail({
        userId,
        brandId,
        posts: [{ channel: channel(c.channel), hashtags: [], ...c.post }],
        aiFixture: fixtureFor(c),
        now: new Date('2026-10-19T08:00:00Z'),
      });
      expect(res.aiChecked).toBe(true);
      for (const p of c.planted) {
        planted++;
        if (res.flags.some((f) => f.field === p.field && f.status === 'open' && overlaps(f.text, p.text))) caught++;
        else missed.push(`${c.id}: ${p.text}`);
      }
      if (c.planted.length > 0) expect(res.blocking).toBe(true);
    }
    expect(missed).toEqual([]);
    expect(caught).toBe(planted);
    expect(planted).toBeGreaterThanOrEqual(27);
  });

  it('the deterministic layer alone flags no allowed span', () => {
    const falsePositives: string[] = [];
    for (const c of cases) {
      const det = checkPostDeterministic({
        post: { channel: channel(c.channel), hashtags: [], ...c.post },
        facts: asWeeklyFacts(brandFactRows(c.brand_id)),
        regulated: brands.find((b) => b.id === c.brand_id)!.regulated,
        wordsToAvoid: [],
      });
      for (const i of det.issues) {
        const touchesPlanted = c.planted.some((p) => p.field === i.field && overlaps(i.text, p.text));
        const inAllowed = c.allowed.some((a) => overlaps(i.text, a));
        if (inAllowed && !touchesPlanted) falsePositives.push(`${c.id} ${i.field}: ${i.text}`);
      }
    }
    expect(falsePositives).toEqual([]);
  });

  it('clean posts (no planted spans) get no fact flags when the AI finds nothing', async () => {
    for (const c of cases.filter((x) => x.planted.length === 0)) {
      const { userId, brandId } = seeded.get(c.brand_id)!;
      const [res] = await runGuardrail({
        userId,
        brandId,
        posts: [{ channel: channel(c.channel), hashtags: [], ...c.post }],
        aiFixture: { facts: [] },
      });
      expect(res.flags.filter((f) => f.kind !== 'regulated_reminder'), c.id).toEqual([]);
    }
  });

  it('what the code layer alone catches in the planted set (information)', () => {
    let planted = 0;
    let byCode = 0;
    for (const c of cases) {
      const det = checkPostDeterministic({
        post: { channel: channel(c.channel), hashtags: [], ...c.post },
        facts: asWeeklyFacts(brandFactRows(c.brand_id)),
        regulated: brands.find((b) => b.id === c.brand_id)!.regulated,
        wordsToAvoid: [],
      });
      for (const p of c.planted) {
        planted++;
        if (det.issues.some((i) => i.field === p.field && overlaps(i.text, p.text))) byCode++;
      }
    }
    console.info(`[planted-30] code layer alone: ${byCode}/${planted}`);
    expect(byCode).toBeGreaterThan(0);
  });
});
