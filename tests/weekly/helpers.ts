import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MockDb } from '@/lib/db/mock';
import { samplePhoto } from '@/lib/render/fixtures';
import { createMockStorage } from '@/lib/storage/mock';
import type { Storage } from '@/lib/storage';
import { seedBrand } from '../guardrail/helpers';

export const BAKERY_FACTS = [
  { kind: 'price', label: 'Sourdough loaf', value: '£4.50' },
  { kind: 'hours', label: 'Hours', value: 'Monday to Friday, 7am to 6pm' },
  { kind: 'phone', label: 'Phone', value: '+44 20 7946 0183' },
];

export interface WeeklyBrandOpts {
  name?: string;
  timezone?: string;
  weekday?: number;
  time?: string;
  country?: string;
  region?: string | null;
  city?: string;
  setup?: boolean;
  pausedUntil?: string | null;
  unsubscribed?: boolean;
  wordsToAvoid?: string[];
  category?: string;
  regulated?: string | null;
  facts?: typeof BAKERY_FACTS;
  photos?: number;
  storage?: Storage;
}

/** A brand with finished setup, a schedule and (optionally) photos stored in the given storage. */
export async function seedWeeklyBrand(db: MockDb, opts: WeeklyBrandOpts = {}): Promise<{ userId: string; brandId: string; photoIds: string[] }> {
  const { userId, brandId } = await seedBrand(db, {
    name: opts.name ?? 'Corner Bakery',
    category: opts.category ?? 'bakery',
    regulated: opts.regulated ?? null,
    wordsToAvoid: opts.wordsToAvoid ?? [],
    facts: opts.facts ?? BAKERY_FACTS,
  });
  await db.withAdmin((tx) =>
    tx.query(
      `update public.brand_memory set
         business_name = $2, country = $3, region = $4, city = $5, timezone = $6,
         schedule_weekday = $7, schedule_time = $8::time, goal = 'enquiries', post_language = 'en',
         audience = 'local families', voice_description = 'Warm and plain.',
         setup_completed_at = $9::timestamptz, email_paused_until = $10::date, email_unsubscribed_at = $11::timestamptz
       where brand_id = $1`,
      [
        brandId,
        opts.name ?? 'Corner Bakery',
        opts.country ?? 'GB',
        opts.region ?? null,
        opts.city ?? 'London',
        opts.timezone ?? 'Europe/London',
        opts.weekday ?? 1,
        opts.time ?? '08:00',
        opts.setup === false ? null : '2026-01-01T00:00:00Z',
        opts.pausedUntil ?? null,
        opts.unsubscribed ? '2026-01-02T00:00:00Z' : null,
      ],
    ),
  );
  const photoIds: string[] = [];
  for (let i = 0; i < (opts.photos ?? 0); i++) {
    const id = randomUUID();
    await opts.storage!.put('photos', `${brandId}/${id}.jpg`, await samplePhoto(1200, 900), 'image/jpeg');
    await db.withAdmin((tx) =>
      tx.query(
        `insert into public.photos (id, brand_id, kind, storage_path, width, height, description, usable, created_at)
         values ($1, $2, 'photo', $3, 1200, 900, $4, true, now() + ($5 || ' seconds')::interval)`,
        [id, brandId, `photos/${brandId}/${id}.jpg`, `Photo number ${i + 1} of the shop`, String(i)],
      ),
    );
    photoIds.push(id);
  }
  return { userId, brandId, photoIds };
}

export async function tempStorage(): Promise<{ storage: Storage; root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'weekly-test-'));
  return { storage: createMockStorage(root), root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export async function insertBatch(
  db: MockDb,
  brandId: string,
  weekStart: string,
  o: { status: 'ready' | 'failed' | 'generating'; error?: string | null; createdAt?: string; attempts?: number; regens?: number; claimedAt?: string | null },
): Promise<string> {
  const [r] = await db.withAdmin((tx) =>
    tx.query<{ id: string }>(
      `insert into public.weekly_batches (brand_id, week_start, status, error, attempts, regens, claimed_at, created_at)
       values ($1, $2::date, $3::public.batch_status, $4, $5, $6, $7::timestamptz, coalesce($8::timestamptz, now())) returning id::text as id`,
      [brandId, weekStart, o.status, o.error ?? null, o.attempts ?? 0, o.regens ?? 0, o.claimedAt ?? null, o.createdAt ?? null],
    ),
  );
  return r.id;
}

export const count = async (db: MockDb, sql: string, params: unknown[] = []): Promise<number> => {
  const [r] = await db.withAdmin((tx) => tx.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`, params));
  return r.n;
};
