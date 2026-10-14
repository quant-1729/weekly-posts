import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { approveCreatePost, chooseDesign, ensureDraftPosts, loadDesignPage, saveCopy, type DesignPageData } from "@/lib/create";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, openDb } from "../../helpers/details";
import { cleanup, makeBakery, readyBrief, uniq, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;

const copy = (instagram: string, facebook: string): PostCopy => ({
  headline: "Fresh bread every day",
  subline: "",
  cta_text: "Visit us today",
  captions: [
    { channel: "instagram", text: instagram },
    { channel: "facebook", text: facebook },
  ],
  hashtags: [],
  bubble: "",
  pose: "",
});
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });
const deps = (c: PostCopy) => ({ copy: { fixture: c }, now: new Date() });
const repeats = (flags: { kind: string; status: string; field: string }[]) => flags.filter((f) => f.kind === "repeat" && f.status === "open" && f.field === "caption");

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("repetition (C-3) for posts made from briefs", () => {
  const phrase = "we bake our sourdough loaves slowly overnight in a stone oven";

  it("a new brief that repeats a 6+ word phrase from an earlier approved post is flagged; a different caption is not", async () => {
    const t = uniq();
    const first = await readyBrief(b, { channels: ["instagram", "facebook"] });
    const page = (await loadDesignPage(args(first.id), deps(copy(`Hello ${t}! ${phrase}. 20% off cakes.`, `Cakes ${t} are on offer. 20% off cakes.`)))) as DesignPageData;
    const out = await chooseDesign({ ...args(first.id), option: page.options[0].option }, deps(copy("", "")));
    expect(out.posts.every((p) => repeats(p.flags).length === 0)).toBe(true);
    expect(await approveCreatePost({ ...b, postId: out.posts[0].id })).toMatchObject({ ok: true });

    const second = await readyBrief(b, { channels: ["instagram", "facebook"] });
    const u = uniq();
    const { posts } = await ensureDraftPosts(args(second.id), deps(copy(`News ${u}: ${phrase}, every day. 20% off cakes.`, `Fresh ${u} treats for you today. 20% off cakes.`)));
    const hit = repeats(posts[0].flags);
    expect(hit).toHaveLength(1);
    expect((hit[0] as unknown as { text: string }).text.toLowerCase()).toContain("sourdough loaves slowly overnight");
    expect(repeats(posts[1].flags)).toHaveLength(0);
    // A repeat is a "Please check": it blocks approval until the owner decides.
    expect(posts[0].flags.some((f) => f.kind === "repeat" && f.status === "open")).toBe(true);
  });

  it("two channels of one brief that share a sentence do not flag each other", async () => {
    const t = uniq();
    const shared = `Our ${t} bakers shape every loaf by hand before sunrise each day`;
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    const { posts } = await ensureDraftPosts(args(brief.id), deps(copy(`${shared}. 20% off cakes.`, `${shared}! Visit us. 20% off cakes.`)));
    expect(posts.map((p) => repeats(p.flags).length)).toEqual([0, 0]);
  });

  it("a brief's own earlier words are not history for it: saving the same caption again is not a repeat", async () => {
    const t = uniq();
    const sentence = `Today ${t} our ovens glow while the city is still asleep outside`;
    const brief = await readyBrief(b, { channels: ["instagram"] });
    await ensureDraftPosts(args(brief.id), deps(copy(`${sentence}. 20% off cakes.`, "")));
    const saved = await saveCopy({ ...args(brief.id), edit: { captions: { instagram: `${sentence}. Visit us soon. 20% off cakes.` } } }, deps(copy("", "")));
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    expect(repeats(saved.posts[0].flags)).toHaveLength(0);
  });
});
