import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { V2FactCheck } from '@/lib/ai/schemas-v2';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { runGuardrail } from '@/lib/guardrail';
import { REGULATED_REMINDER_TEXT } from '@/lib/guardrail/types';
import { brandFactRows, brands, seedBrand, type TestFact } from './helpers';

type Post = { caption: string; cta: string; image_text: { headline: string; subline: string } };
interface RCase {
  id: string;
  brand_id?: string;
  brand?: { id: string; what_they_sell: string; regulated: string; facts: TestFact[] };
  post: Post;
  has_outcome_promise: boolean;
  promise_text: string;
}
const cases: RCase[] = JSON.parse(readFileSync('test-data/v2/guardrail/regulated-20.json', 'utf8'));

let db: MockDb;
const seeded = new Map<string, { userId: string; brandId: string }>();
const PROMISE = /guarantee|cure|pain.?free|win every|good for your heart|drink more|teens/i;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  const sources = [
    ...brands.filter((b) => b.regulated !== 'none').map((b) => ({ id: b.id, category: b.what_they_sell, regulated: b.regulated, facts: brandFactRows(b.id) })),
    ...cases.filter((c) => c.brand).map((c) => ({ id: c.brand!.id, category: c.brand!.what_they_sell, regulated: c.brand!.regulated, facts: c.brand!.facts })),
  ];
  for (const s of sources) {
    if (seeded.has(s.id)) continue;
    seeded.set(
      s.id,
      await seedBrand(db, {
        category: s.category,
        regulated: s.regulated,
        // a website that promises results: the extraction marks such a fact outcome_promise
        facts: s.facts.map((f) => ({ ...f, outcome_promise: PROMISE.test(f.value) })),
      }),
    );
  }
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

const idOf = (c: RCase) => c.brand_id ?? c.brand!.id;

describe('regulated-20 (AC 12), fixture AI built from each case\'s promise_text', () => {
  it('has 12 posts with promises and 8 clean ones', () => {
    expect(cases.filter((c) => c.has_outcome_promise)).toHaveLength(12);
    expect(cases.filter((c) => !c.has_outcome_promise)).toHaveLength(8);
  });

  it('flags every outcome promise, even when the AI says a fact supports it', async () => {
    let flagged = 0;
    for (const c of cases.filter((x) => x.has_outcome_promise)) {
      const { userId, brandId } = seeded.get(idOf(c))!;
      const fixture: V2FactCheck = {
        facts: [{ post: 1, field: 'caption', text: c.promise_text, kind: 'claim', supported: true, fact_id: 'f1', outcome_promise: true }],
      };
      const [res] = await runGuardrail({ userId, brandId, posts: [{ channel: 'facebook', hashtags: [], ...c.post }], aiFixture: fixture });
      const hit = res.flags.find((f) => f.field === 'caption' && f.status === 'open' && f.regulated && (f.text.includes(c.promise_text) || c.promise_text.includes(f.text)));
      expect(hit, c.id).toBeDefined();
      expect(res.blocking, c.id).toBe(true);
      flagged++;
    }
    expect(flagged).toBe(12);
  });

  it('puts the reminder on all 20 posts, and it alone never blocks a clean post', async () => {
    for (const c of cases) {
      const { userId, brandId } = seeded.get(idOf(c))!;
      const [res] = await runGuardrail({ userId, brandId, posts: [{ channel: 'facebook', hashtags: [], ...c.post }], aiFixture: { facts: [] } });
      expect(res.flags.filter((f) => f.kind === 'regulated_reminder').map((f) => f.text), c.id).toEqual([REGULATED_REMINDER_TEXT]);
      if (!c.has_outcome_promise) {
        expect(res.flags.filter((f) => f.kind !== 'regulated_reminder'), c.id).toEqual([]);
        expect(res.blocking, c.id).toBe(false);
      }
    }
  });

  it('the code layer alone already flags the promises that use risky words (the AI is down)', async () => {
    let byCode = 0;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const c of cases.filter((x) => x.has_outcome_promise)) {
      const { userId, brandId } = seeded.get(idOf(c))!;
      const [res] = await runGuardrail({ userId, brandId, posts: [{ channel: 'facebook', hashtags: [], ...c.post }] });
      if (res.flags.some((f) => f.layer === 'code' && f.kind === 'claim' && c.promise_text.toLowerCase().includes(f.text.toLowerCase()))) byCode++;
    }
    err.mockRestore();
    console.info(`[regulated-20] code layer alone: ${byCode}/12 promises`);
    expect(byCode).toBeGreaterThan(0);
  });
});
