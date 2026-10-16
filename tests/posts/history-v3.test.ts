import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecentPosts } from "@/components/home/recent-posts";
import { channelFormats } from "@/lib/create/content";
import type { MockDb } from "@/lib/db/mock";
import { deriveV3Status, listPosts } from "@/lib/posts/history";
import { historyView } from "@/lib/posts/history-view";
import { closeDb, openDb } from "../helpers/details";
import { makeShop, rows, seedApproved, seedBrief, seedItem, seedPost, type Shop } from "../queue/helpers";
import { seedPost as seedV1Post } from "./seed";

// History and Home "Recent posts" read posts made by the v3 flow (brief -> posts -> queue), not only v1 outputs.

let db: MockDb;
let shop: Shop;
let other: Shop;

beforeAll(async () => {
  db = await openDb();
  shop = await makeShop(db);
  other = await makeShop(db, { name: "Other Shop" });
});
afterAll(async () => {
  await closeDb(db);
});

const setCreated = (postId: string, at: string) => rows(db, "update public.posts set created_at = $2::timestamptz where id = $1", [postId, at]);
const find = async (userId: string, brandId: string, id: string) => (await listPosts(userId, brandId, { limit: 50 })).posts.find((p) => p.id === id);

describe("History with v3 posts", () => {
  it("shows the caption, the main picture and a status for each queue state", async () => {
    const cases: { queue: string | null; post?: string; expect: string; label: RegExp; at?: boolean }[] = [
      { queue: "scheduled", expect: "scheduled", label: /^Scheduled Fri 16 Oct$/ },
      { queue: "publishing", expect: "scheduled", label: /^Scheduled Fri 16 Oct$/ },
      { queue: "published", post: "posted", expect: "published", label: /^Published Fri 16 Oct$/ },
      { queue: "delivered", post: "posted", expect: "delivered", label: /^Delivered$/ },
      { queue: "skipped", expect: "skipped", label: /^Skipped$/ },
      { queue: "failed", expect: "failed", label: /^Failed$/ },
      { queue: null, post: "approved", expect: "approved", label: /^Approved$/ },
      { queue: null, post: "draft", expect: "needs_approval", label: /^Needs approval$/ },
    ];
    for (const c of cases) {
      const { briefId, posts } = await seedApproved(db, shop, ["instagram"]);
      const [post] = posts;
      if (c.post) await rows(db, "update public.posts set status = $2::public.post_status where id = $1", [post.id, c.post]);
      if (c.queue) {
        const itemId = await seedItem(db, shop, post, { slotAt: "2026-10-16T09:00:00Z", status: c.queue });
        if (c.queue === "published") await rows(db, "update public.queue_items set done_at = '2026-10-16T09:00:05Z', permalink = 'https://instagram.com/p/abc' where id = $1", [itemId]);
        if (c.queue === "delivered") await rows(db, "update public.queue_items set done_at = '2026-10-16T09:00:05Z' where id = $1", [itemId]);
      }
      const h = await find(shop.userId, shop.brandId, post.id);
      expect(h, c.expect).toBeDefined();
      expect(h!.title).toBe("Fresh bread every morning at Corner Bakery.");
      expect(h!.thumbnail?.path).toBe(`renders/${shop.brandId}/${post.id}/${channelFormats("instagram")[0]}.png`);
      expect(h!.thumbnail?.version).toMatch(/^\d+$/);
      expect(h!.v3).toMatchObject({ briefId, status: c.expect, channel: "instagram" });
      const view = historyView(h!);
      expect(view.label).toMatch(c.label);
      expect(view.href).toBe(`/create/${briefId}/review`);
      if (c.expect === "published") expect(view.permalink).toBe("https://instagram.com/p/abc");
      else expect(view.permalink).toBeNull();
    }
  });

  it("shows a post with no design yet as a Draft", async () => {
    const { posts } = await seedApproved(db, shop, ["instagram"]);
    await rows(db, "update public.posts set status = 'draft', theme_id = null, design = null, approved_at = null where id = $1", [posts[0].id]);
    const h = await find(shop.userId, shop.brandId, posts[0].id);
    expect(historyView(h!).label).toBe("Draft");
  });

  it("lists one entry per brief (first channel), without carousel slides", async () => {
    const { briefId, posts } = await seedApproved(db, shop, ["facebook", "instagram"], { carousel: 2, caption: "Carousel brief caption" });
    const all = (await listPosts(shop.userId, shop.brandId, { limit: 50 })).posts.filter((p) => p.v3?.briefId === briefId);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(posts[0].id); // the brief's first channel
    expect(all[0].v3?.channel).toBe("facebook");
    expect(all[0].title).toBe("Carousel brief caption");
  });

  it("keeps v1 posts unchanged next to v3 posts", async () => {
    const id = await seedV1Post(db, shop.brandId, shop.userId, {
      createdAt: "2026-10-13 10:00:00+05:30",
      status: "ready",
      outputs: [{ channel: "ig_feed", language: "hi", caption: "Old caption\nsecond" }],
    });
    const h = await find(shop.userId, shop.brandId, id);
    expect(h?.v3).toBeUndefined();
    expect(h?.title).toBe("Old caption");
    expect(h?.status).toBe("ready");
    expect(h?.thumbnail?.path).toBe(`renders/${shop.brandId}/${id}/ig_feed.png`);
    const view = historyView(h!);
    expect(view).toMatchObject({ href: `/review/${id}`, label: "Ready to post" });
  });

  it("does not show another brand's posts, and filters by date and language", async () => {
    const mine = await seedApproved(db, shop, ["instagram"], { caption: "Mine only" });
    const theirs = await seedApproved(db, other, ["instagram"], { caption: "Theirs only" });
    await setCreated(mine.posts[0].id, "2026-03-05T10:00:00Z");
    await setCreated(theirs.posts[0].id, "2026-03-05T10:00:00Z");

    expect(await find(other.userId, other.brandId, mine.posts[0].id)).toBeUndefined();
    expect(await find(shop.userId, shop.brandId, theirs.posts[0].id)).toBeUndefined();
    expect((await listPosts(other.userId, shop.brandId)).posts).toEqual([]); // not a member of this brand
    expect(await find(other.userId, other.brandId, theirs.posts[0].id)).toBeDefined();

    const day = { from: new Date("2026-03-05T00:00:00Z"), to: new Date("2026-03-06T00:00:00Z") };
    const inDay = (await listPosts(shop.userId, shop.brandId, day)).posts;
    expect(inDay.map((p) => p.id)).toEqual([mine.posts[0].id]);
    expect(inDay[0].languages).toEqual(["en"]);
    expect((await listPosts(shop.userId, shop.brandId, { ...day, language: "en" })).posts).toHaveLength(1);
    expect((await listPosts(shop.userId, shop.brandId, { ...day, language: "hi" })).posts).toHaveLength(0);
  });

  it("pages through v3 posts without repeats", async () => {
    const brand = await makeShop(db, { name: "Pager" });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const b = await seedBrief(db, brand, { channels: ["instagram"] });
      const p = await seedPost(db, brand, b, "instagram");
      await setCreated(p.id, `2026-04-0${i + 1}T10:00:00Z`);
      ids.push(p.id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listPosts>> = await listPosts(brand.userId, brand.brandId, { limit: 2, cursor });
      seen.push(...page.posts.map((p) => p.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());
  });
});

describe("Home recent posts with v3 posts", () => {
  it("renders the caption, the picture and the status badge, linking to the review page", async () => {
    const brand = await makeShop(db, { name: "Home Shop" });
    const { briefId, posts } = await seedApproved(db, brand, ["instagram"], { caption: "Warm rolls at seven" });
    await seedItem(db, brand, posts[0], { slotAt: "2026-10-16T09:00:00Z", status: "scheduled" });
    const { posts: recent } = await listPosts(brand.userId, brand.brandId, { limit: 3 });
    expect(recent).toHaveLength(1);
    const html = renderToString(createElement(RecentPosts, { posts: recent }));
    expect(html).toContain("Warm rolls at seven");
    expect(html).toContain(`/api/files/renders/${brand.brandId}/${posts[0].id}/${channelFormats("instagram")[0]}.png?v=`);
    expect(html).toContain("Scheduled Fri 16 Oct");
    expect(html).toContain(`href="/create/${briefId}/review"`);
    expect(html).not.toContain("No caption");
    expect(html).not.toContain("No image");
  });
});

describe("deriveV3Status", () => {
  const base = { postStatus: "draft", designed: true, queueStatus: null, slotIso: null, doneIso: null, postedIso: null };
  it("maps approval and queue states", () => {
    expect(deriveV3Status(base).status).toBe("needs_approval");
    expect(deriveV3Status({ ...base, designed: false }).status).toBe("draft");
    expect(deriveV3Status({ ...base, postStatus: "approved" }).status).toBe("approved");
    expect(deriveV3Status({ ...base, postStatus: "skipped" }).status).toBe("skipped");
    expect(deriveV3Status({ ...base, postStatus: "posted", postedIso: "2026-10-14T10:00:00.000Z" })).toEqual({ status: "published", at: "2026-10-14T10:00:00.000Z" });
    expect(deriveV3Status({ ...base, queueStatus: "missed" }).status).toBe("missed");
    expect(deriveV3Status({ ...base, queueStatus: "expired" }).status).toBe("expired");
  });
});

