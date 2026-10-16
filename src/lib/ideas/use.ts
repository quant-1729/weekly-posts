// What the owner does with ideas (R-6): "Make this post", "Not for me" and dismissing a trend card.
// All as the signed-in owner (row-level security keeps it to the brand). Nothing here makes or schedules a post:
// "Make this post" only starts a draft brief, which the owner edits in Create a post.

import { requireBrandMember } from "@/lib/brand/current";
import { createBrief } from "@/lib/briefs/service";
import type { PostType } from "@/lib/briefs/types";
import { getDb } from "@/lib/db";

export type IdeaErrorCode = "not_found" | "dismissed" | "failed";

export class IdeaError extends Error {
  constructor(public readonly code: IdeaErrorCode) {
    super(`Idea: ${code}`);
    this.name = "IdeaError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IdeaRow {
  id: string;
  post_type: PostType;
  description: string;
  status: string;
  brief_id: string | null;
}

/**
 * Starts a draft brief from an idea: the idea's post type, and its description in the brief's notes (the
 * description of the post). Nothing else is filled in. The idea is marked used with the brief's id. Pressing it
 * again (or a double click) opens the same brief and never makes a second one. Returns the brief id.
 */
export async function makePostFromIdea(userId: string, brandId: string, ideaId: string): Promise<{ briefId: string }> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(ideaId))) throw new IdeaError("not_found");

  // Claim the idea first, so two clicks cannot make two briefs.
  const claimed = await getDb().withUser(userId, async (tx) => {
    const [cur] = await tx.query<IdeaRow>(
      "select id::text as id, post_type::text as post_type, description, status, brief_id::text as brief_id from public.post_ideas where id = $1 and brand_id = $2",
      [ideaId, brandId],
    );
    if (!cur) throw new IdeaError("not_found");
    if (cur.status === "dismissed") throw new IdeaError("dismissed");
    if (cur.status === "used" && cur.brief_id) {
      // The brief may have been deleted since (brief_id is cleared then); only an existing one is reused.
      return { reuse: cur.brief_id, idea: cur };
    }
    const rows = await tx.query<IdeaRow>(
      `update public.post_ideas set status = 'used'
        where id = $1 and brand_id = $2 and status in ('new', 'queued', 'used') returning id::text as id, post_type::text as post_type, description, status, brief_id::text as brief_id`,
      [ideaId, brandId],
    );
    return { reuse: null as string | null, idea: rows[0] ?? cur };
  });
  if (claimed.reuse) return { briefId: claimed.reuse };

  try {
    const brief = await createBrief(userId, brandId, { postType: claimed.idea.post_type, notes: claimed.idea.description, status: "draft" });
    await getDb().withUser(userId, (tx) =>
      tx.query("update public.post_ideas set brief_id = $3 where id = $1 and brand_id = $2", [ideaId, brandId, brief.id]),
    );
    return { briefId: brief.id };
  } catch (e) {
    // Give the idea back so the owner can try again.
    await getDb()
      .withUser(userId, (tx) => tx.query("update public.post_ideas set status = 'new' where id = $1 and brand_id = $2 and brief_id is null", [ideaId, brandId]))
      .catch(() => undefined);
    console.error("[ideas] could not start a post from an idea:", e instanceof Error ? e.name : "error");
    throw new IdeaError("failed");
  }
}

/** "Not for me": the idea is hidden. A used idea stays (its post exists). */
export async function dismissIdea(userId: string, brandId: string, ideaId: string): Promise<void> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(ideaId))) throw new IdeaError("not_found");
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query("update public.post_ideas set status = 'dismissed' where id = $1 and brand_id = $2 and status in ('new', 'queued') returning id", [ideaId, brandId]),
  );
  if (rows.length === 0) throw new IdeaError("not_found");
}

/** Dismisses a whole trend card. Its ideas that were not used are dismissed with it. */
export async function dismissCard(userId: string, brandId: string, cardId: string): Promise<void> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(cardId))) throw new IdeaError("not_found");
  await getDb().withUser(userId, async (tx) => {
    const rows = await tx.query("update public.trend_cards set status = 'dismissed' where id = $1 and brand_id = $2 and status = 'new' returning id", [cardId, brandId]);
    if (rows.length === 0) throw new IdeaError("not_found");
    await tx.query("update public.post_ideas set status = 'dismissed' where card_id = $1 and brand_id = $2 and status in ('new', 'queued')", [cardId, brandId]);
  });
}
