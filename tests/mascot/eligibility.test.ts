import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockDb } from '@/lib/db/mock';
import { computeEligibility } from '@/lib/mascot/eligibility';
import { getMascotCard, getMascotEligibility, setMascotInPosts } from '@/lib/mascot/service';
import { saveSettings } from '@/lib/memory/settings';
import { closeTestDb, createBrandFor, createUser, openTestDb } from '../brand/helpers';
import { insertActiveMascot } from './helpers';

const SET: Array<{ id: string; category: string; tone: string; expected_eligible: boolean }> = JSON.parse(
  readFileSync(path.join(process.cwd(), 'test-data', 'mascot-eligibility-20.json'), 'utf8'),
);

describe('eligibility on the 20-brand test set (old R15 AC)', () => {
  it('has 20 brands', () => {
    expect(SET).toHaveLength(20);
  });

  it('gives the expected answer for all 20', () => {
    const wrong = SET.filter((b) => computeEligibility({ category: b.category, tone: b.tone }).eligible !== b.expected_eligible).map((b) => b.id);
    expect(wrong).toEqual([]);
  });

  it.each(SET.map((b) => [b.id, b.category, b.tone, b.expected_eligible] as const))('%s: %s / %s -> %s', (_id, category, tone, expected) => {
    expect(computeEligibility({ category, tone }).eligible).toBe(expected);
  });
});

describe('v2 rules', () => {
  const e = (category: string, tone: string, regulated?: Parameters<typeof computeEligibility>[0]['regulated']) => computeEligibility({ category, tone, regulated });

  it('the professional tone is formal: not offered by default, but "Try anyway" is allowed', () => {
    expect(e('bakery', 'professional')).toMatchObject({ eligible: false, reason: 'formal', canOverride: true });
    expect(e('bakery', 'friendly')).toMatchObject({ eligible: true, reason: 'ok' });
    expect(e('bakery', 'playful')).toMatchObject({ eligible: true });
  });

  it('a regulated brand is never offered one, with no override, and the owner choice wins', () => {
    expect(e('dental clinic', 'friendly')).toMatchObject({ eligible: false, reason: 'regulated', canOverride: false });
    expect(e('Neighbourhood wine bar', 'playful')).toMatchObject({ reason: 'regulated' });
    expect(e('bakery', 'friendly', 'health')).toMatchObject({ eligible: false, reason: 'regulated', canOverride: false });
    expect(e('bakery', 'professional', 'finance').reason).toBe('regulated'); // regulated beats formal
    expect(e('dental clinic', 'friendly', 'none')).toMatchObject({ eligible: true });
    expect(e('dental clinic', 'friendly', null).reason).toBe('regulated'); // automatic: detected
  });

  it('is stamped with the time it was worked out', () => {
    expect(computeEligibility({ category: 'bakery', tone: 'friendly' }, new Date('2026-10-13T10:00:00Z')).checked_at).toBe('2026-10-13T10:00:00.000Z');
  });
});

describe('settings recompute it (old R15a, v2)', () => {
  let db: MockDb;
  let owner: string;
  beforeAll(async () => {
    db = await openTestDb();
    owner = (await createUser(db)).id;
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  const FORM = {
    business_name: 'Corner Bakery',
    what_sell: 'Sourdough bread, cakes and coffee',
    customers: 'Families and office workers nearby',
    country: 'GB',
    region: 'GB-ENG',
    city: 'London',
    timezone: 'Europe/London',
    goal: 'enquiries',
    tone: 'friendly',
    post_language: 'en-GB',
    minutes_per_post: '30',
    schedule_weekday: 1,
    schedule_time: '08:00',
    link_destination: '',
    regulated: '',
  };
  const stored = async (brand: string) =>
    (await db.withAdmin((tx) => tx.query<{ e: Record<string, unknown> | null }>('select mascot_eligibility as e from public.brand_memory where brand_id = $1', [brand])))[0].e;

  it('stores the result on save, and again when the category, tone or regulated choice changes', async () => {
    const brand = await createBrandFor(db, owner, 'Corner Bakery');
    await saveSettings(owner, brand, FORM);
    expect(await stored(brand)).toMatchObject({ eligible: true, reason: 'ok' });

    await saveSettings(owner, brand, { ...FORM, tone: 'professional' });
    expect(await stored(brand)).toMatchObject({ eligible: false, reason: 'formal', canOverride: true });

    await saveSettings(owner, brand, { ...FORM, what_sell: 'Dental check-ups and whitening' });
    expect(await stored(brand)).toMatchObject({ eligible: false, reason: 'regulated', canOverride: false });

    await saveSettings(owner, brand, { ...FORM, what_sell: 'Dental check-ups and whitening', regulated: 'none' });
    expect(await stored(brand)).toMatchObject({ eligible: true, reason: 'ok' });

    await saveSettings(owner, brand, { ...FORM, regulated: 'finance' });
    expect(await stored(brand)).toMatchObject({ eligible: false, reason: 'regulated' });
    expect((await stored(brand))!.checked_at).toEqual(expect.any(String));
    expect((await getMascotEligibility(owner, brand)).reason).toBe('regulated');
  });

  it('a brand that becomes regulated stops using its mascot in posts, and the switch cannot be turned back on', async () => {
    const brand = await createBrandFor(db, owner, 'Corner Bakery');
    await saveSettings(owner, brand, FORM);
    await insertActiveMascot(db, brand);
    await setMascotInPosts(owner, brand, true);
    expect((await getMascotCard(owner, brand)).inPosts).toBe(true);

    await saveSettings(owner, brand, { ...FORM, regulated: 'health' });
    const [row] = await db.withAdmin((tx) => tx.query<{ on: boolean }>('select mascot_in_posts as on from public.brand_memory where brand_id = $1', [brand]));
    expect(row.on).toBe(false);
    await expect(setMascotInPosts(owner, brand, true)).rejects.toMatchObject({ code: 'not_eligible' });

    // Back to a normal brand: the owner can switch it on again; nothing was lost.
    await saveSettings(owner, brand, { ...FORM, regulated: 'none' });
    await expect(setMascotInPosts(owner, brand, true)).resolves.toBe(true);
  });
});
