import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WeeklyFact } from '@/lib/ai/prompts/v2-weekly';
import type { MockDb } from '@/lib/db/mock';
import type { GuardrailPostInput } from '@/lib/guardrail';

const DATA = path.join(process.cwd(), 'test-data', 'v2');

export interface TestFact {
  kind: string;
  label: string;
  value: string;
}
export interface TestBrand {
  id: string;
  business_name: string;
  what_they_sell: string;
  customers: string;
  regulated: 'none' | 'health' | 'finance' | 'alcohol' | 'legal' | 'other';
  website: string | null;
  facts: TestFact[];
}

export const brands: TestBrand[] = JSON.parse(readFileSync(path.join(DATA, 'brands.json'), 'utf8'));

/** A test brand's facts: the ones in brands.json plus the website's expected facts, as the setup would store them. */
export function brandFactRows(brandId: string, inline?: { facts?: TestFact[] }): TestFact[] {
  let all: TestFact[] = inline?.facts ?? [];
  const b = brands.find((x) => x.id === brandId);
  if (b) {
    all = [...b.facts];
    if (b.website) {
      const raw = JSON.parse(readFileSync(path.join(DATA, 'websites', b.website, 'expected-facts.json'), 'utf8'));
      all.push(...(Array.isArray(raw) ? raw : raw.facts));
    }
  }
  return all;
}

export const asWeeklyFacts = (rows: TestFact[], neverUse = false): WeeklyFact[] =>
  rows.map((f, i) => ({ id: `f${i + 1}`, kind: f.kind, label: f.label, value: f.value, neverUse }));

/** Same as a facts-only brand: for the pure layers. */
export const factsOf = (brandId: string, inline?: { facts?: TestFact[] }) => asWeeklyFacts(brandFactRows(brandId, inline));

let counter = 0;

/** A user, a brand with the given memory and facts. Returns both ids. */
export async function seedBrand(
  db: MockDb,
  opts: { name?: string; category?: string; regulated?: string | null; wordsToAvoid?: string[]; facts?: Array<TestFact & { outcome_promise?: boolean }> },
): Promise<{ userId: string; brandId: string }> {
  counter += 1;
  const email = `owner${counter}@example.com`;
  const userId = await db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
    await tx.query('insert into public.profiles (id, email, consent_at) values ($1, $2, now())', [u.id, email]);
    return u.id;
  });
  const brandId = await db.withUser(userId, async (tx) => {
    const [b] = await tx.query<{ id: string }>('select public.create_brand($1) as id', [opts.name ?? 'Test brand']);
    await tx.query(
      `update public.brand_memory set category = $2, regulated = $3::public.regulated_category, words_to_avoid = $4::text[] where brand_id = $1`,
      [b.id, opts.category ?? '', opts.regulated ?? null, opts.wordsToAvoid ?? []],
    );
    for (const f of opts.facts ?? []) {
      await tx.query(
        `insert into public.brand_facts (brand_id, kind, label, value, source_type, outcome_promise)
         values ($1, $2::public.fact_kind, $3, $4, 'owner', $5)`,
        [b.id, f.kind, f.label, f.value, f.outcome_promise ?? false],
      );
    }
    return b.id;
  });
  return { userId, brandId };
}

/** Inserts a stored post (and its batch) so it counts as history. */
export async function seedHistoryPost(db: MockDb, brandId: string, userId: string, weekStart: string, caption: string, status = 'ready'): Promise<string> {
  return db.withAdmin(async (tx) => {
    const [b] = await tx.query<{ id: string }>(
      `insert into public.weekly_batches (brand_id, week_start, status) values ($1, $2::date, 'ready')
       on conflict (brand_id, week_start) do update set status = 'ready' returning id`,
      [brandId, weekStart],
    );
    counter += 1;
    const [p] = await tx.query<{ id: string }>(
      `insert into public.posts (brand_id, created_by, batch_id, caption, status, post_code)
       values ($1, $2, $3, $4, $5::public.post_status, $6) returning id`,
      [brandId, userId, b.id, caption, status, `h${String(counter).padStart(6, '0')}`],
    );
    return p.id;
  });
}

export const post = (o: Partial<GuardrailPostInput> & { headline?: string; subline?: string } = {}): GuardrailPostInput => ({
  channel: o.channel ?? 'facebook',
  caption: o.caption ?? 'Fresh bread every morning.',
  cta: o.cta ?? 'Come and visit us.',
  hashtags: o.hashtags ?? ['#bread', '#fresh', '#local'],
  image_text: o.image_text ?? { headline: o.headline ?? 'Fresh bread', subline: o.subline ?? '' },
  ...(o.id ? { id: o.id } : {}),
});
