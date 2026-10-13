import { randomUUID } from 'node:crypto';
import type { MockDb } from '@/lib/db/mock';
import { seedWeeklyBrand, BAKERY_FACTS } from '../weekly/helpers';

export interface Seeded {
  userId: string;
  brandId: string;
  postId: string;
  postCode: string;
}

let n = 0;
const nextCode = () => `t${String(++n).padStart(6, '0')}`;

/** A brand with the given link settings and one post. */
export async function seedLinkBrand(
  db: MockDb,
  o: { name?: string; linkDestination?: string | null; websiteUrl?: string | null; channel?: string | null; facts?: typeof BAKERY_FACTS; city?: string } = {},
): Promise<Seeded> {
  const { userId, brandId } = await seedWeeklyBrand(db, { name: o.name, facts: o.facts, city: o.city });
  await db.withAdmin((tx) =>
    tx.query('update public.brand_memory set link_destination = $2, website_url = $3 where brand_id = $1', [
      brandId,
      o.linkDestination ?? null,
      o.websiteUrl ?? null,
    ]),
  );
  const post = await seedPost(db, brandId, userId, { channel: o.channel === undefined ? 'facebook' : o.channel });
  return { userId, brandId, ...post };
}

export async function seedPost(
  db: MockDb,
  brandId: string,
  userId: string,
  o: { channel?: string | null; withBatch?: boolean; weekStart?: string; caption?: string; topic?: string } = {},
): Promise<{ postId: string; postCode: string }> {
  const postCode = nextCode();
  const postId = randomUUID();
  await db.withAdmin(async (tx) => {
    let batchId: string | null = null;
    if (o.withBatch) {
      const [b] = await tx.query<{ id: string }>(
        `insert into public.weekly_batches (brand_id, week_start, status) values ($1, $2::date, 'ready')
         on conflict (brand_id, week_start) do update set status = 'ready' returning id`,
        [brandId, o.weekStart ?? '2026-10-05'],
      );
      batchId = b.id;
    }
    await tx.query(
      `insert into public.posts (id, brand_id, created_by, batch_id, status, post_code, channel, caption, original)
       values ($1, $2, $3, $4, 'draft', $5, $6::public.post_channel, $7, $8::jsonb)`,
      [postId, brandId, userId, batchId, postCode, o.channel ?? null, o.caption ?? 'Fresh bread today', JSON.stringify({ topic: o.topic ?? 'Fresh bread' })],
    );
  });
  return { postId, postCode };
}
