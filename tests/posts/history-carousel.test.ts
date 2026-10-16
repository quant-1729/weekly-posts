// History and Home show a small "Carousel · N slides" badge for a carousel the owner asked for.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecentPosts } from "@/components/home/recent-posts";
import type { MockDb } from "@/lib/db/mock";
import { listPosts } from "@/lib/posts/history";
import { historyView } from "@/lib/posts/history-view";
import { closeDb, openDb } from "../helpers/details";
import { makeShop, rows, seedApproved, type Shop } from "../queue/helpers";

let db: MockDb;
let shop: Shop;

beforeAll(async () => {
  db = await openDb();
  shop = await makeShop(db);
});
afterAll(() => closeDb(db));

describe("the carousel badge", () => {
  it("is 'Carousel · 5 slides' for a carousel brief and absent for a post", async () => {
    const car = await seedApproved(db, shop, ["instagram"]);
    await rows(db, "update public.post_briefs set content_format = 'carousel', slide_count = 5 where id = $1", [car.briefId]);
    const post = await seedApproved(db, shop, ["instagram"]);
    const list = (await listPosts(shop.userId, shop.brandId, { limit: 50 })).posts;
    const a = list.find((p) => p.id === car.posts[0].id)!;
    const b = list.find((p) => p.id === post.posts[0].id)!;
    expect(a.v3?.carouselSlides).toBe(5);
    expect(b.v3?.carouselSlides).toBeNull();
    expect(historyView(a).formatLabel).toBe("Carousel · 5 slides");
    expect(historyView(b).formatLabel).toBeNull();

    const home = renderToString(createElement(RecentPosts, { posts: [a, b] }));
    expect(home.match(/data-format-badge/g)).toHaveLength(1);
    expect(home).toContain("Carousel · 5 slides");
  });
});
