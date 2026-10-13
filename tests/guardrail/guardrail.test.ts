import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { V2FactCheck } from '@/lib/ai/schemas-v2';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { factsForPrompt, loadGuardrailContext, runGuardrail } from '@/lib/guardrail';
import { AI_UNCHECKED_TEXT, REGULATED_REMINDER_TEXT } from '@/lib/guardrail/types';
import { post, seedBrand, seedHistoryPost } from './helpers';

type Stmt = V2FactCheck['facts'][number];
const stmt = (o: Partial<Stmt> & { text: string }): Stmt => ({
  post: 1,
  field: 'caption',
  kind: 'price',
  supported: false,
  fact_id: '',
  outcome_promise: false,
  ...o,
});
const ai = (...facts: Stmt[]): V2FactCheck => ({ facts });

const BAKERY = [
  { kind: 'price', label: 'Sourdough loaf', value: '£4.50' },
  { kind: 'hours', label: 'Hours', value: 'Monday to Friday, 7am to 6pm' },
  { kind: 'phone', label: 'Phone', value: '+44 20 7946 0183' },
];

let db: MockDb;
beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

describe('merge of the two layers', () => {
  it('a code flag and an AI flag on the same span are one flag, layer both, AI span preferred', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const p = post({ caption: 'Now only 100% organic flour, from £4.50' });
    const [res] = await runGuardrail({
      userId,
      brandId,
      posts: [p],
      // The AI quotes the longer claim; the code layer found "100%".
      aiFixture: ai(stmt({ text: '100% organic flour', kind: 'claim' })),
    });
    const flags = res.flags.filter((f) => f.kind !== 'regulated_reminder');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ text: '100% organic flour', kind: 'claim', layer: 'both', highlight: true, status: 'open', field: 'caption' });
    expect(res.blocking).toBe(true);
  });

  it('keeps flags that do not overlap, from either layer', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const p = post({ caption: 'Loaf £3.90, award-winning, since 1990' });
    const [res] = await runGuardrail({ userId, brandId, posts: [p], aiFixture: ai(stmt({ text: 'award-winning', kind: 'claim' })) });
    expect(res.flags.map((f) => [f.text, f.layer]).sort()).toEqual([
      ['1990', 'code'],
      ['award-winning', 'ai'],
      ['£3.90', 'code'],
    ]);
  });

  it('the AI can never clear a code flag', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const [res] = await runGuardrail({
      userId,
      brandId,
      posts: [post({ caption: 'Loaf for £3.90' })],
      aiFixture: ai(stmt({ text: '£3.90', supported: true, fact_id: 'f1' })),
    });
    expect(res.flags).toEqual([expect.objectContaining({ text: '£3.90', layer: 'code', status: 'open' })]);
  });

  it('keeps an AI flag whose text is not in the field, with highlight false', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const [res] = await runGuardrail({
      userId,
      brandId,
      posts: [post({ caption: 'Open late on Fridays' })],
      aiFixture: ai(stmt({ text: 'open until late', kind: 'hours' })),
    });
    expect(res.flags).toEqual([expect.objectContaining({ text: 'open until late', kind: 'hours', layer: 'ai', highlight: false })]);
    expect(res.blocking).toBe(true);
  });

  it('puts statements on the right post and field', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const posts = [post({ caption: 'Fresh bread' }), post({ caption: 'Warm rolls', cta: 'Free tasting' }), post({ caption: 'Cakes' })];
    const res = await runGuardrail({
      userId,
      brandId,
      posts,
      aiFixture: ai(stmt({ post: 2, field: 'cta', text: 'Free tasting', kind: 'offer' }), stmt({ post: 9, text: 'nobody' })),
    });
    expect(res.map((r) => r.flags.length)).toEqual([0, 1, 0]);
    expect(res[1].flags[0]).toMatchObject({ field: 'cta', text: 'Free tasting', kind: 'offer' });
    expect(res.map((r) => r.blocking)).toEqual([false, true, false]);
  });

  it('flag ids are stable between runs', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const run = () => runGuardrail({ userId, brandId, posts: [post({ caption: 'Loaf £3.90' })], aiFixture: ai() });
    expect((await run())[0].flags[0].id).toBe((await run())[0].flags[0].id);
    expect((await run())[0].flags[0].id).toMatch(/^f_[0-9a-f]{8}$/);
  });

  it('a phone that is not a fact is one flag from both layers, not extra price flags', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const [res] = await runGuardrail({
      userId,
      brandId,
      posts: [post({ cta: 'Call +44 20 7946 0999 today' })],
      aiFixture: ai(stmt({ field: 'cta', text: '+44 20 7946 0999', kind: 'phone' })),
    });
    expect(res.flags).toEqual([expect.objectContaining({ text: '+44 20 7946 0999', kind: 'phone', layer: 'both', field: 'cta' })]);
  });

  it('the fact phone is not flagged by code', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const [res] = await runGuardrail({ userId, brandId, posts: [post({ cta: 'Call +44 20 7946 0183' })], aiFixture: ai() });
    expect(res.flags).toEqual([]);
    expect(res.blocking).toBe(false);
  });

  it('marks a flag the owner already confirmed as confirmed, and counts the text as a fact', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const [res] = await runGuardrail({
      userId,
      brandId,
      posts: [post({ caption: 'Now £3.90, award-winning' })],
      confirmedByPost: [['£3.90', 'award-winning']],
      aiFixture: ai(stmt({ text: 'award-winning', kind: 'claim' })),
      now: new Date('2026-10-19T08:00:00Z'),
    });
    expect(res.flags.map((f) => [f.text, f.status, f.decided_at])).toEqual([['award-winning', 'confirmed', '2026-10-19T08:00:00.000Z']]);
    expect(res.blocking).toBe(false);
  });

  it('returns channel limits for the pipeline, and nothing for an empty batch', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const [res] = await runGuardrail({ userId, brandId, posts: [post({ channel: 'instagram', hashtags: ['#a'] })], aiFixture: ai() });
    expect(res.formatIssues).toEqual([{ field: 'hashtags', code: 'hashtag_count', detail: '1, expected 3-8' }]);
    expect(res.blocking).toBe(false);
    expect(await runGuardrail({ userId, brandId, posts: [] })).toEqual([]);
  });

  it('records the AI call as a fact_check usage event', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    await runGuardrail({ userId, brandId, posts: [post(), post()], aiFixture: ai() });
    const rows = await db.withAdmin((tx) => tx.query<{ kind: string; n: number }>(`select kind::text as kind, count(*)::int as n from public.usage_events where brand_id = $1 group by kind`, [brandId]));
    expect(rows).toEqual([{ kind: 'fact_check', n: 1 }]); // one call for all posts
  });
});

describe('regulated brands (Req 12)', () => {
  const DENTAL = [
    { kind: 'price', label: 'Check-up', value: '$145' },
    { kind: 'claim', label: 'Banner', value: 'Pain-free dentistry guaranteed', outcome_promise: true },
    { kind: 'phone', label: 'Phone', value: '(503) 555-0142' },
  ];

  it('flags an outcome promise even when a fact supports it, and says so is regulated', async () => {
    const { userId, brandId } = await seedBrand(db, { category: 'General dentistry', facts: DENTAL });
    const [res] = await runGuardrail({
      userId,
      brandId,
      posts: [post({ caption: 'Pain-free dentistry guaranteed, every visit.' })],
      aiFixture: ai(stmt({ text: 'Pain-free dentistry guaranteed', kind: 'claim', supported: true, fact_id: 'f2', outcome_promise: true })),
    });
    const promise = res.flags.find((f) => f.kind === 'claim');
    expect(promise).toMatchObject({ text: 'Pain-free dentistry guaranteed', layer: 'both', regulated: true, status: 'open', highlight: true });
    expect(res.blocking).toBe(true);
  });

  it('flags the supported promise from the code layer alone too (the AI is down)', async () => {
    const { userId, brandId } = await seedBrand(db, { category: 'General dentistry', facts: DENTAL });
    const [res] = await runGuardrail({ userId, brandId, posts: [post({ caption: 'Pain-free dentistry guaranteed, every visit.' })] });
    expect(res.flags.map((f) => f.text)).toEqual(expect.arrayContaining(['Pain-free', 'guaranteed']));
  });

  it('adds the reminder to every post, and the reminder never blocks', async () => {
    const { userId, brandId } = await seedBrand(db, { category: 'General dentistry', facts: DENTAL });
    const res = await runGuardrail({ userId, brandId, posts: [post(), post({ caption: 'Check-ups from $145' })], aiFixture: ai() });
    for (const r of res) {
      expect(r.flags).toEqual([expect.objectContaining({ kind: 'regulated_reminder', text: REGULATED_REMINDER_TEXT, highlight: false, status: 'open' })]);
      expect(r.blocking).toBe(false);
    }
  });

  it('an unregulated brand gets no reminder, and an outcome promise alone does not flag', async () => {
    const { userId, brandId } = await seedBrand(db, { category: 'Bakery', facts: BAKERY });
    const [res] = await runGuardrail({
      userId,
      brandId,
      posts: [post({ caption: 'Our bread makes you happy' })],
      aiFixture: ai(stmt({ text: 'makes you happy', kind: 'claim', supported: true, outcome_promise: true })),
    });
    expect(res.flags).toEqual([]);
  });

  it('brand_memory.regulated overrides the detected group in both directions', async () => {
    const a = await seedBrand(db, { category: 'Dental clinic', regulated: 'none', facts: [] });
    expect((await loadGuardrailContext(a.brandId, a.userId)).regulated).toBe('none');
    const b = await seedBrand(db, { category: 'Dental clinic', regulated: null, facts: [] });
    expect((await loadGuardrailContext(b.brandId, b.userId)).regulated).toBe('health');
    const c = await seedBrand(db, { category: 'Bakery', regulated: 'other', facts: [] });
    expect((await loadGuardrailContext(c.brandId, c.userId)).regulated).toBe('other');
    const d = await seedBrand(db, { category: 'Wine bar and bottle shop', regulated: null, facts: [] });
    expect((await loadGuardrailContext(d.brandId, d.userId)).regulated).toBe('alcohol');
  });
});

describe('factsForPrompt', () => {
  it('gives short ids f1... in a stable order and marks outcome promises NEVER USE for a regulated brand', async () => {
    const { userId, brandId } = await seedBrand(db, {
      category: 'Dental clinic',
      facts: [
        { kind: 'price', label: 'Check-up', value: '$145' },
        { kind: 'claim', label: 'Banner', value: 'Pain-free dentistry guaranteed', outcome_promise: true },
        { kind: 'claim', label: 'Licence', value: 'Licensed by the state board' },
      ],
    });
    const facts = await factsForPrompt(brandId, userId);
    // (facts added in one transaction share a created_at: the order is then by id, but fixed)
    // The stored facts come first; the business name from setup is appended after them.
    expect(facts.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(Object.fromEntries(facts.map((f) => [f.value, f.neverUse]))).toEqual({
      '$145': false,
      'Pain-free dentistry guaranteed': true,
      'Licensed by the state board': false,
      'Test brand': false,
    });
    expect(await factsForPrompt(brandId, userId)).toEqual(facts);
    expect(await factsForPrompt(brandId)).toEqual(facts); // service role (cron)
  });

  it('does not mark anything NEVER USE for an unregulated brand, and skips removed facts', async () => {
    const { userId, brandId } = await seedBrand(db, { category: 'Bakery', facts: [{ kind: 'claim', label: 'Banner', value: 'Best bread in town guaranteed', outcome_promise: true }, { kind: 'price', label: 'Loaf', value: '£4' }] });
    await db.withAdmin((tx) => tx.query(`update public.brand_facts set active = false where brand_id = $1 and value = '£4'`, [brandId]));
    const facts = await factsForPrompt(brandId, userId);
    expect(facts.map((f) => [f.id, f.value, f.neverUse])).toEqual([['f1', 'Best bread in town guaranteed', false], ['f2', 'Test brand', false]]);
  });

  it('adds the business name and location from setup as facts, after the stored ones', async () => {
    const { userId, brandId } = await seedBrand(db, { name: 'Corner Bakery', facts: [{ kind: 'price', label: 'Loaf', value: '£4' }] });
    await db.withAdmin((tx) => tx.query(`update public.brand_memory set business_name = 'Corner Bakery', city = 'London', region = 'GB-ENG', country = 'GB' where brand_id = $1`, [brandId]));
    const facts = await factsForPrompt(brandId, userId);
    expect(facts.map((f) => [f.id, f.label, f.value])).toEqual([
      ['f1', 'Loaf', '£4'],
      ['f2', 'Business name', 'Corner Bakery'],
      ['f3', 'Location (city, region, country)', 'London, England, United Kingdom'],
    ]);
    // So the city is not a "please check" contact or claim flag.
    const [res] = await runGuardrail({ userId, brandId, posts: [post({ caption: 'Fresh loaves every morning at Corner Bakery in London.' })], aiFixture: ai() });
    expect(res.flags.filter((f) => f.text.includes('London') || f.text.includes('Corner Bakery'))).toEqual([]);
  });

  it('a NEVER USE fact is not a source for the code layer', async () => {
    const { userId, brandId } = await seedBrand(db, { category: 'Dental clinic', facts: [{ kind: 'claim', label: 'Banner', value: 'Painless guaranteed results', outcome_promise: true }] });
    const [res] = await runGuardrail({ userId, brandId, posts: [post({ caption: 'Painless guaranteed results' })], aiFixture: ai() });
    expect(res.flags.map((f) => f.text)).toContain('guaranteed');
  });
});

describe('AI failure fallback', () => {
  it('keeps the code flags and adds one open claim flag; never passes silently', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // No fixture in fixture mode throws, like a failed call.
    const [res] = await runGuardrail({ userId, brandId, posts: [post({ caption: 'Loaf £3.90' })] });
    err.mockRestore();
    expect(res.aiChecked).toBe(false);
    expect(res.flags.map((f) => [f.text, f.kind, f.layer, f.highlight, f.status])).toEqual([
      ['£3.90', 'price', 'code', true, 'open'],
      [AI_UNCHECKED_TEXT, 'claim', 'code', false, 'open'],
    ]);
    expect(res.blocking).toBe(true);
  });

  it('a clean post still gets the "not checked" flag, and invalid AI output counts as a failure', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = (() => ({ facts: [{ post: 'x' }] })) as unknown as () => V2FactCheck;
    const res = await runGuardrail({ userId, brandId, posts: [post(), post()], aiFixture: bad });
    err.mockRestore();
    for (const r of res) {
      expect(r.flags.map((f) => f.text)).toEqual([AI_UNCHECKED_TEXT]);
      expect(r.blocking).toBe(true);
    }
    // and no usage is recorded for a call that failed
    const n = await db.withAdmin((tx) => tx.query(`select 1 from public.usage_events where brand_id = $1`, [brandId]));
    expect(n).toHaveLength(0);
  });
});

describe('words to avoid and repetition through the database', () => {
  it('reads words to avoid from brand memory', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY, wordsToAvoid: ['cheap', 'Bargain'] });
    const [res] = await runGuardrail({ userId, brandId, posts: [post({ caption: 'A cheap BARGAIN, Cheapside', cta: 'bargain hunt' })], aiFixture: ai() });
    expect(res.flags.map((f) => [f.kind, f.field, f.text])).toEqual([
      ['avoid', 'caption', 'cheap'],
      ['avoid', 'caption', 'BARGAIN'],
      ['avoid', 'cta', 'bargain'],
    ]);
    expect(res.blocking).toBe(true);
  });

  const LONG = 'Every loaf is shaped by hand and baked on site every morning';

  it('flags a phrase of 6+ words from the last 4 weeks, ignores skipped posts and older batches', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    await seedHistoryPost(db, brandId, userId, '2026-09-28', `Hello. ${LONG}.`); // 3 weeks back
    await seedHistoryPost(db, brandId, userId, '2026-09-07', 'Our rye bread tastes of caraway seeds and honey from the hills'); // 6 weeks back
    await seedHistoryPost(db, brandId, userId, '2026-10-12', 'Our croissants are laminated for three days before they reach you', 'skipped');
    const res = await runGuardrail({
      userId,
      brandId,
      weekStart: '2026-10-19',
      posts: [
        post({ caption: `Come in, because ${LONG}, and say hi.` }),
        post({ caption: 'Our rye bread tastes of caraway seeds and honey from the hills' }),
        post({ caption: 'Our croissants are laminated for three days before they reach you' }),
      ],
      aiFixture: ai(),
    });
    expect(res[0].repeats).toEqual([LONG]);
    expect(res[0].flags).toEqual([expect.objectContaining({ kind: 'repeat', field: 'caption', highlight: true, layer: 'code' })]);
    expect(res[0].blocking).toBe(true);
    expect(res[1].repeats).toEqual([]); // outside the window
    expect(res[2].repeats).toEqual([]); // history was skipped
  });

  it('compares posts of the batch with each other', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const res = await runGuardrail({
      userId,
      brandId,
      posts: [post({ caption: `Monday: ${LONG}.` }), post({ caption: `Friday: ${LONG}!` }), post({ caption: 'Something else entirely' })],
      aiFixture: ai(),
    });
    expect(res.map((r) => r.repeats.length)).toEqual([1, 1, 0]);
  });

  it('flagRepeats: false returns the repeats without flags, for the pipeline\'s regenerate-once step', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    await seedHistoryPost(db, brandId, userId, '2026-10-12', LONG);
    const [res] = await runGuardrail({ userId, brandId, weekStart: '2026-10-19', flagRepeats: false, posts: [post({ caption: `Hi! ${LONG}` })], aiFixture: ai() });
    expect(res.repeats).toHaveLength(1);
    expect(res.flags).toEqual([]);
    expect(res.blocking).toBe(false);
  });

  it('does not count the post being rechecked as its own history', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: BAKERY });
    const id = await seedHistoryPost(db, brandId, userId, '2026-10-19', LONG);
    const [res] = await runGuardrail({ userId, brandId, weekStart: '2026-10-19', posts: [post({ id, caption: LONG })], aiFixture: ai() });
    expect(res.repeats).toEqual([]);
    const [other] = await runGuardrail({ userId, brandId, weekStart: '2026-10-19', posts: [post({ caption: LONG })], aiFixture: ai() });
    expect(other.repeats).toHaveLength(1);
  });

  it('fact text may repeat', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: [{ kind: 'address', label: 'Shop', value: '27 Lansdowne Parade, London SE5 8QJ' }] });
    await seedHistoryPost(db, brandId, userId, '2026-10-12', 'Visit 27 Lansdowne Parade, London SE5 8QJ');
    const [res] = await runGuardrail({ userId, brandId, weekStart: '2026-10-19', posts: [post({ caption: 'Find 27 Lansdowne Parade, London SE5 8QJ' })], aiFixture: ai() });
    expect(res.repeats).toEqual([]);
  });
});
