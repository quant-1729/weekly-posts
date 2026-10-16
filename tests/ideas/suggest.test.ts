import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/week",
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
// The Queue page's client components call these server actions; rendering needs only that they exist.
vi.mock("@/app/(app)/week/queue-actions", () => ({
  moveItemAction: vi.fn(),
  postNowItemAction: vi.fn(),
  postNowReadyAction: vi.fn(),
  saveQueueSettingsAction: vi.fn(),
  scheduleReadyAction: vi.fn(),
  skipItemAction: vi.fn(),
  slotOptionsAction: vi.fn(),
  unscheduleItemAction: vi.fn(),
  refreshQueueAction: vi.fn(),
}));

import QueuePage from "@/app/(app)/week/page";
import type { MockDb } from "@/lib/db/mock";
import { IDEA_SUGGESTIONS, topIdeaSuggestions } from "@/lib/ideas/suggest";
import { NOW, closeDb, makeShop, openDb, rows, type Shop } from "./helpers";
import { seedCard, seedIdea, seedRun } from "./seed";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
afterEach(() => vi.useRealTimers());

const counts = async (brandId: string) =>
  (
    await rows<{ briefs: number; posts: number; items: number; batches: number }>(
      db,
      `select (select count(*)::int from public.post_briefs where brand_id = $1) as briefs, (select count(*)::int from public.posts where brand_id = $1) as posts,
              (select count(*)::int from public.queue_items where brand_id = $1) as items, (select count(*)::int from public.weekly_batches where brand_id = $1) as batches`,
      [brandId],
    )
  )[0];

describe("ideas as Queue suggestions (R-7)", () => {
  let shop: Shop;
  let other: Shop;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    shop = await makeShop(db);
    other = await makeShop(db);
    const runId = await seedRun(db, shop.brandId, { startedAt: new Date(NOW.getTime() - 3_600_000) });
    // Four cards by score; the best two (80, 60) should lead. The 80 card has two ideas: only one is suggested.
    const top = await seedCard(db, shop.brandId, runId, { title: "Top trend", score: 80 });
    ids.top1 = await seedIdea(db, shop.brandId, top, { angle: "Top idea one", createdAt: new Date(NOW.getTime() - 2000) });
    ids.top2 = await seedIdea(db, shop.brandId, top, { angle: "Top idea two", createdAt: new Date(NOW.getTime() - 1000) });
    const second = await seedCard(db, shop.brandId, runId, { title: "Second trend", score: 60 });
    ids.second = await seedIdea(db, shop.brandId, second, { angle: "Second idea" });
    const third = await seedCard(db, shop.brandId, runId, { title: "Third trend", score: 40 });
    ids.third = await seedIdea(db, shop.brandId, third, { angle: "Third idea" });
    // Not eligible: dismissed card, expired card, used and dismissed ideas, another run's cards.
    const dismissed = await seedCard(db, shop.brandId, runId, { title: "Dismissed trend", score: 99, status: "dismissed" });
    await seedIdea(db, shop.brandId, dismissed, { angle: "Dismissed card idea" });
    const expired = await seedCard(db, shop.brandId, runId, { title: "Expired trend", score: 98, expiresAt: new Date(NOW.getTime() - 1000) });
    await seedIdea(db, shop.brandId, expired, { angle: "Expired card idea" });
    const usedCard = await seedCard(db, shop.brandId, runId, { title: "Used trend", score: 97 });
    await seedIdea(db, shop.brandId, usedCard, { angle: "Used idea", status: "used" });
    await seedIdea(db, shop.brandId, usedCard, { angle: "Dismissed idea", status: "dismissed" });
    const olderRun = await seedRun(db, shop.brandId, { startedAt: new Date(NOW.getTime() - 20 * 86_400_000) });
    const old = await seedCard(db, shop.brandId, olderRun, { title: "Old run trend", score: 96 });
    await seedIdea(db, shop.brandId, old, { angle: "Old run idea" });
    // Another business with a strong card.
    const theirRun = await seedRun(db, other.brandId);
    const theirs = await seedCard(db, other.brandId, theirRun, { title: "Their trend", score: 100 });
    await seedIdea(db, other.brandId, theirs, { angle: "Their idea" });
  });

  it("returns up to two unused ideas from the best live cards, one per card, and nothing else", async () => {
    expect(IDEA_SUGGESTIONS).toBe(2);
    const before = await counts(shop.brandId);
    const out = await topIdeaSuggestions(shop.userId, shop.brandId, NOW);
    expect(out.map((s) => s.angle)).toEqual(["Top idea one", "Second idea"]);
    expect(out.map((s) => s.cardTitle)).toEqual(["Top trend", "Second trend"]);
    expect(out[0]).toMatchObject({ ideaId: ids.top1, postType: "announcement" });
    // Reading suggestions creates nothing: no brief, post, queue item or weekly batch, and the ideas stay unused.
    expect(await counts(shop.brandId)).toEqual(before);
    const [{ n }] = await rows<{ n: number }>(db, "select count(*)::int as n from public.post_ideas where brand_id = $1 and status = 'new'", [shop.brandId]);
    expect(n).toBe(7); // none was marked used or queued by being suggested
  });

  it("returns nothing for a business with no research, and never another business's ideas", async () => {
    const empty = await makeShop(db);
    expect(await topIdeaSuggestions(empty.userId, empty.brandId, NOW)).toEqual([]);
    await expect(topIdeaSuggestions(empty.userId, shop.brandId, NOW)).rejects.toThrow();
  });

  it("the Queue page shows 'From your ideas' with two Make this post buttons under the weekly suggestions, and creates no posts", async () => {
    session.user = { id: shop.userId };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const before = await counts(shop.brandId);
    const html = renderToString(await QueuePage());
    expect(html).toContain("data-idea-suggestions");
    expect(html).toContain("From your ideas");
    expect(html).toContain("Top idea one");
    expect(html).toContain("Second idea");
    expect(html).not.toContain("Third idea");
    expect(html).not.toContain("Their idea");
    expect((html.match(/data-idea-suggestions[\s\S]*?<\/ul>/)?.[0].match(/Make this post/g) ?? []).length).toBe(2);
    // It sits inside the weekly suggestions section, before the suggestions themselves.
    expect(html.indexOf("data-weekly-suggestions")).toBeLessThan(html.indexOf("data-idea-suggestions"));
    expect(await counts(shop.brandId)).toEqual(before);

    // A business without ideas sees no such block.
    session.user = { id: other.userId };
    await rows(db, "update public.post_ideas set status = 'dismissed' where brand_id = $1", [other.brandId]);
    expect(renderToString(await QueuePage())).not.toContain("data-idea-suggestions");
  });
});
