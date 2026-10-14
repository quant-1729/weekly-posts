import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { chooseDesign, ensureDraftPosts, loadDesignPage, saveCopy, type DesignPageData } from "@/lib/create";
import type { StoredDesign } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, openDb } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;

const copy = (over: Partial<PostCopy> = {}): PostCopy => ({
  headline: "Cake week is here",
  subline: "",
  cta_text: "Visit us today",
  captions: [{ channel: "instagram", text: "Cake week! 20% off cakes until 20 Oct." }],
  hashtags: [],
  bubble: "Come say hi!",
  pose: "point",
  ...over,
});
const deps = (c: PostCopy = copy()) => ({ copy: { fixture: c }, now: NOW });
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("the mascot (Tween) in posts", () => {
  it("is not on a post while the brand has it switched off, whatever the model says", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const { posts } = await ensureDraftPosts(args(brief.id), deps());
    expect(posts[0].mascotId).toBeNull();
    expect(posts[0].imageText).toMatchObject({ bubble: "", pose: "" });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    expect(page.hasMascot).toBe(false);
  });

  it("is on when the brand switched it on and has an active mascot: the line and the pose are kept, drawn and checked", async () => {
    await db.withAdmin((tx) => tx.query("update public.brand_memory set mascot_in_posts = true where brand_id = $1", [b.brandId]));
    const mascot = (await db.withAdmin((tx) => tx.query<{ id: string }>("insert into public.mascots (brand_id, status, name, concept, spec) values ($1, 'active', 'Tween', '{}'::jsonb, '{}'::jsonb) returning id", [b.brandId])))[0].id;
    const brief = await readyBrief(b, { channels: ["instagram", "youtube"] });
    const c = copy({ captions: [{ channel: "instagram", text: "20% off cakes" }, { channel: "youtube", text: "20% off cakes" }] });
    const page = (await loadDesignPage(args(brief.id), deps(c))) as DesignPageData;
    expect(page.hasMascot).toBe(true);
    expect(page.words.bubble).toBe("Come say hi!");

    const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps(c));
    for (const p of out.posts) {
      expect(p.mascotId).toBe(mascot);
      expect(p.imageText).toMatchObject({ bubble: "Come say hi!", pose: "point" });
      expect((p.design as StoredDesign).content.bubble).toBe("Come say hi!");
    }
    expect(out.blockers).toEqual([]);

    // The mascot's line is checked like the rest: an invented price in it is flagged.
    const saved = await saveCopy({ ...args(brief.id), edit: { bubble: "Only £1.50 today!" } }, deps());
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    expect(saved.posts[0].flags.some((f) => f.status === "open" && f.field === "image_text.bubble" && f.text.includes("1.50"))).toBe(true);
  });

  it("a pose that is not one of Tween's becomes 'wave'", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const { posts } = await ensureDraftPosts(args(brief.id), deps(copy({ pose: "breakdance" })));
    expect(posts[0].imageText.pose).toBe("wave");
  });
});
