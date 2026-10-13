import type { MockDb } from '@/lib/db/mock';
import { seedPost } from '../shortlinks/helpers';

export interface SeedPostOpts {
  topic?: string;
  caption?: string;
  channel?: string;
  /** posted_at, an ISO instant. */
  postedAt?: string;
  /** Instants of `share` actions. */
  shares?: string[];
  /** Instants of clicks. */
  clicks?: string[];
  /** Remove original.topic so the caption's first line is used. */
  noTopic?: boolean;
  suggestedDay?: string;
}

/** A post for a brand with the given posted_at, share actions and clicks. */
export async function seedResultPost(db: MockDb, brandId: string, userId: string, o: SeedPostOpts = {}): Promise<string> {
  const { postId } = await seedPost(db, brandId, userId, { channel: o.channel ?? 'facebook', topic: o.topic, caption: o.caption });
  await db.withAdmin(async (tx) => {
    if (o.postedAt) await tx.query('update public.posts set posted_at = $2::timestamptz where id = $1', [postId, o.postedAt]);
    if (o.noTopic) await tx.query(`update public.posts set original = '{}'::jsonb where id = $1`, [postId]);
    if (o.suggestedDay) await tx.query('update public.posts set suggested_day = $2::date where id = $1', [postId, o.suggestedDay]);
    for (const at of o.shares ?? []) {
      await tx.query(
        `insert into public.post_actions (post_id, brand_id, action, via, user_id, created_at) values ($1, $2, 'share', 'dashboard', $3, $4::timestamptz)`,
        [postId, brandId, userId, at],
      );
    }
    for (const at of o.clicks ?? []) {
      await tx.query('insert into public.clicks (post_id, brand_id, clicked_at, user_agent) values ($1, $2, $3::timestamptz, $4)', [postId, brandId, at, 'Mozilla/5.0']);
    }
  });
  return postId;
}

export async function setMinutes(db: MockDb, brandId: string, minutes: number | null): Promise<void> {
  await db.withAdmin((tx) => tx.query('update public.brand_memory set minutes_per_post = $2 where brand_id = $1', [brandId, minutes]));
}

export async function addCheckin(db: MockDb, brandId: string, weekStart: string, answer: 'none' | 'few' | 'many'): Promise<void> {
  await db.withAdmin((tx) =>
    tx.query(`insert into public.checkins (brand_id, week_start, answer, via) values ($1, $2::date, $3::public.checkin_answer, 'email_link')`, [brandId, weekStart, answer]),
  );
}
