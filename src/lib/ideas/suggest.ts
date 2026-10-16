// Ideas as Queue suggestions (R-7): the best unused ideas, shown under "This week" with "Make this post". Reading
// only: nothing is created, scheduled or approved here.

import { requireBrandMember } from "@/lib/brand/current";
import type { PostType } from "@/lib/briefs/types";
import { getDb } from "@/lib/db";

/** Suggestions from ideas on the Queue page. */
export const IDEA_SUGGESTIONS = 2;

export interface IdeaSuggestion {
  ideaId: string;
  angle: string;
  postType: PostType;
  cardTitle: string;
}

/**
 * Up to `limit` unused ideas, from the highest-scored live trend cards of the latest finished run, one idea per card
 * so the suggestions differ.
 */
export async function topIdeaSuggestions(userId: string, brandId: string, now: Date = new Date(), limit: number = IDEA_SUGGESTIONS): Promise<IdeaSuggestion[]> {
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ idea_id: string; angle: string; post_type: PostType; title: string }>(
      `select idea_id, angle, post_type, title from (
         select distinct on (c.id) i.id::text as idea_id, i.angle, i.post_type::text as post_type, c.title, c.score, c.created_at
           from public.post_ideas i
           join public.trend_cards c on c.id = i.card_id and c.brand_id = i.brand_id
          where i.brand_id = $1 and i.status = 'new' and c.status = 'new' and c.expires_at > $2::timestamptz
            and c.run_id = (select r.id from public.research_runs r where r.brand_id = $1 and r.status = 'done' order by r.started_at desc limit 1)
          order by c.id, i.created_at, i.id
       ) t
       order by score desc, created_at desc, idea_id
       limit $3`,
      [brandId, now.toISOString(), Math.max(0, Math.min(limit, 5))],
    ),
  );
  return rows.map((r) => ({ ideaId: r.idea_id, angle: r.angle, postType: r.post_type, cardTitle: r.title }));
}
