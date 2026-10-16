import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { chooseDesign, CreateError, filterOf, listBriefPosts, redrawPosts, setPostFilter } from "@/lib/create";
import type { StoredDesign } from "@/lib/create/types";
import { loadDesignPage, type DesignPageData } from "@/lib/create/view";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, openDb } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;

const copy = (): PostCopy => ({
  headline: "Cake week is here",
  subline: "Fresh every morning",
  cta_text: "Visit us today",
  captions: ["instagram", "facebook"].map((channel) => ({ channel: channel as "instagram", text: `Cake week at Corner Bakery (${channel}). 20% off cakes until 20 Oct.` })),
  hashtags: ["#cakes"],
  bubble: "",
  pose: "",
});
const deps = { copy: { fixture: copy() }, now: NOW };
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });
const imageBytes = async (postId: string, format: string) => Buffer.from((await b.storage.get("renders", `${b.brandId}/${postId}/${format}.png`))!.bytes);

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("post filter (UX-2)", () => {
  it("defaults to none and tells the Design step whether a filter applies (a photo is on the post)", async () => {
    const withPhoto = await readyBrief(b, { channels: ["instagram"], photoId: b.photoId });
    const a = (await loadDesignPage(args(withPhoto.id), deps)) as DesignPageData;
    expect(a.filter).toEqual({ preset: "none", intensity: 100 });
    expect(a.filterApplies).toBe(true);
    const noPhoto = await readyBrief(b, { channels: ["instagram"] });
    expect(((await loadDesignPage(args(noPhoto.id), deps)) as DesignPageData).filterApplies).toBe(false);
  });

  it("previews an option with a filter before the design is used, without storing anything", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"], photoId: b.photoId });
    const page = (await loadDesignPage(args(brief.id), deps)) as DesignPageData;
    const option = page.options[0].option;
    const r = await setPostFilter({ ...args(brief.id), filter: { preset: "mono", intensity: 100 }, option }, deps);
    expect(r.redrawn).toBe(false);
    expect(r.images).toEqual([]);
    expect(r.preview?.src).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.preview?.src).not.toBe(page.options[0].src);
    expect(filterOf((await listBriefPosts(b.userId, b.brandId, brief.id))[0])).toEqual({ preset: "none", intensity: 100 });
  });

  it("stores the filter with the design, redraws every picture and returns the new URLs; none brings the old bytes back", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"], photoId: b.photoId });
    const page = (await loadDesignPage(args(brief.id), deps)) as DesignPageData;
    const chosen = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps);
    const before = await imageBytes(chosen.posts[0].id, "square");
    expect(filterOf(chosen.posts[0])).toEqual({ preset: "none", intensity: 100 });

    const set = await setPostFilter({ ...args(brief.id), filter: { preset: "vintage", intensity: 80 } }, deps);
    expect(set).toMatchObject({ redrawn: true, filter: { preset: "vintage", intensity: 80 }, preview: null });
    expect(set.images.length).toBeGreaterThanOrEqual(3);
    for (const i of set.images) expect(i.url).toMatch(new RegExp(`^/api/files/renders/${b.brandId}/${i.postId}/${i.format}\\.png\\?v=\\d+$`));
    const posts = await listBriefPosts(b.userId, b.brandId, brief.id);
    for (const p of posts) {
      expect((p.design as StoredDesign).filter).toEqual({ preset: "vintage", intensity: 80 });
      expect(p.status).toBe("draft");
    }
    const filtered = await imageBytes(posts[0].id, "square");
    expect(filtered.equals(before)).toBe(false);

    // A later redraw (words changed, flag removed) keeps the filter.
    await redrawPosts(args(brief.id), deps);
    expect(filterOf((await listBriefPosts(b.userId, b.brandId, brief.id))[0])).toEqual({ preset: "vintage", intensity: 80 });
    expect((await imageBytes(posts[0].id, "square")).equals(filtered)).toBe(true);

    // Choosing another layout keeps the filter too.
    const again = await chooseDesign({ ...args(brief.id), option: page.options[1].option }, deps);
    expect(filterOf(again.posts[0])).toEqual({ preset: "vintage", intensity: 80 });

    await setPostFilter({ ...args(brief.id), filter: { preset: "none", intensity: 100 } }, deps);
    const chosenAgain = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps);
    expect((await imageBytes(chosenAgain.posts[0].id, "square")).equals(before)).toBe(true);
  });

  it("chooseDesign takes the filter picked on the design step", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"], photoId: b.photoId });
    const page = (await loadDesignPage(args(brief.id), deps)) as DesignPageData;
    const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option, filter: { preset: "cool", intensity: 60 } }, deps);
    expect(filterOf(out.posts[0])).toEqual({ preset: "cool", intensity: 60 });
  });

  it("rejects a filter that is not a preset with an intensity of 0 to 100", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"], photoId: b.photoId });
    for (const bad of [{ preset: "sepia", intensity: 50 }, { preset: "warm", intensity: 101 }, { preset: "warm" }, "warm", null]) {
      await expect(setPostFilter({ ...args(brief.id), filter: bad }, deps)).rejects.toBeInstanceOf(CreateError);
    }
  });
});
