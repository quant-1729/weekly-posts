import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ usd: null as number | null }));
vi.mock("@/lib/ai/client", async (orig) => {
  const m = await orig<typeof import("@/lib/ai/client")>();
  return {
    ...m,
    // In fixture mode there is no cost; a test can pretend the model cost something.
    generateJson: async (a: Parameters<typeof m.generateJson>[0]) => {
      const r = await m.generateJson(a);
      return live.usd === null ? r : { ...r, stats: { model: "test", ms: 1, inputTokens: 10, outputTokens: 10, usd: live.usd } };
    },
  };
});

import type { PostCopy } from "@/lib/ai/schemas-v3";
import { createBrief } from "@/lib/briefs/service";
import { loadCreateBrand } from "@/lib/create/brand";
import { CAPTION_MAX, PostCopyError, copyChannels, trimCaption, validateCopy, visibleLength, wordCount, writePostCopy } from "@/lib/create/copy";
import type { CreateBrand } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { DailyCapError } from "@/lib/usage";
import { WeeklyCapError } from "@/lib/usage/caps";
import { createUsp } from "@/lib/usps/service";
import { closeDb, makeOwner, openDb } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;
let brand: CreateBrand;

const copy = (over: Partial<PostCopy> = {}): PostCopy => ({
  headline: "Cake week is here",
  subline: "Fresh every morning",
  cta_text: "Visit us today",
  captions: [
    { channel: "instagram", text: "Cake week! 20% off cakes until 20 Oct." },
    { channel: "facebook", text: "Cake week at Corner Bakery. 20% off cakes until 20 Oct." },
  ],
  hashtags: ["#cakes", "bakery"],
  bubble: "",
  pose: "",
  ...over,
});

const usageCount = async (kind = "post_copy") =>
  (await db.withAdmin((tx) => tx.query<{ n: number }>("select count(*)::int as n from public.usage_events where brand_id = $1 and kind = $2::public.usage_kind", [b.brandId, kind])))[0].n;

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  brand = await loadCreateBrand(b.userId, b.brandId);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("validateCopy (lengths repaired in code)", () => {
  const ctx = async (patch: Record<string, unknown> = {}, mascot = false) => {
    const brief = await readyBrief(b, { secondaryUspIds: [b.usps.rating.id], channels: ["instagram", "facebook"], ...patch });
    return { brief, brandName: brand.name, language: "en", channels: ["instagram", "facebook"], mascot, contactLines: ["+44 20 7946 0958"] };
  };

  it("keeps good copy as it is", async () => {
    const r = validateCopy(copy(), await ctx());
    expect(r).toMatchObject({ headline: "Cake week is here", subline: "Fresh every morning", ctaText: "Visit us today", fixes: [] });
    expect(r.captions.instagram).toContain("20% off cakes");
    expect(r.hashtags).toEqual(["#cakes", "#bakery"]);
  });

  it("a headline over 7 words becomes the main point's own words, never a cut sentence", async () => {
    const r = validateCopy(copy({ headline: "Our wonderful amazing cake week is finally here for everybody" }), await ctx());
    expect(r.headline).toBe("20% off cakes");
    expect(r.fixes).toContain("headline_too_long");
    expect(wordCount(r.headline)).toBeLessThanOrEqual(7);
  });

  it("with no main point a long or empty headline becomes the business name", async () => {
    const r = validateCopy(copy({ headline: "" }), await ctx({ postType: "brand", primaryUspId: null, cta: "visit", endsOn: null, secondaryUspIds: [] }));
    expect(r.headline).toBe("Corner Bakery");
    expect(r.fixes).toContain("headline_missing");
  });

  it("a subline over 14 words becomes the first extra point's title, else nothing", async () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
    expect(validateCopy(copy({ subline: long }), await ctx()).subline).toBe("4.8 on Google");
    expect(validateCopy(copy({ subline: long }), await ctx({ secondaryUspIds: [] })).subline).toBe("");
  });

  it("a call to action over 25 characters or missing becomes the standard wording for its kind; no CTA kind, no CTA", async () => {
    const r = validateCopy(copy({ cta_text: "Come and visit our lovely bakery now" }), await ctx());
    expect(r.ctaText).toBe("Visit us");
    expect(r.fixes).toContain("cta_too_long");
    expect(validateCopy(copy({ cta_text: "" }), await ctx()).ctaText).toBe("Visit us");
    expect(validateCopy(copy({ cta_text: "Order now" }), await ctx({ postType: "brand", cta: null, endsOn: null })).ctaText).toBe("");
  });

  it("a caption over its channel's limit is cut at a sentence end; a missing caption is built from the brief's own words", async () => {
    const sentence = "We bake fresh bread every single morning for you. ";
    const r = validateCopy(copy({ captions: [{ channel: "instagram", text: sentence.repeat(40) }] }), await ctx());
    expect(visibleLength(r.captions.instagram)).toBeLessThanOrEqual(CAPTION_MAX.instagram);
    expect(r.captions.instagram.endsWith(".")).toBe(true);
    expect(r.fixes).toContain("caption_too_long:instagram");
    expect(r.fixes).toContain("caption_missing:facebook");
    expect(r.captions.facebook).toContain("Cake week is here");
    expect(r.captions.facebook).toContain("+44 20 7946 0958"); // contact lines the post shows, nothing else
  });

  it("the mascot: only a known pose; a bubble over 30 characters is dropped; no mascot, no bubble", async () => {
    const withMascot = validateCopy(copy({ bubble: "Come and see our cakes today please", pose: "dance" }), await ctx({}, true));
    expect(withMascot).toMatchObject({ bubble: "", pose: "wave" });
    expect(withMascot.fixes).toEqual(expect.arrayContaining(["bubble_too_long", "pose_unknown"]));
    expect(validateCopy(copy({ bubble: "Hi there!", pose: "point" }), await ctx({}, true))).toMatchObject({ bubble: "Hi there!", pose: "point" });
    expect(validateCopy(copy({ bubble: "Hi there!", pose: "point" }), await ctx({}, false))).toMatchObject({ bubble: "", pose: "" });
  });

  it("hashtags are cleaned and limited", async () => {
    const r = validateCopy(copy({ hashtags: ["#Cake Week!", "cake week", "#bread", "##sourdough", "", "a b"] }), await ctx());
    expect(r.hashtags).toEqual(["#CakeWeek", "#bread", "#sourdough", "#ab"]);
  });

  it("trimCaption never cuts inside a word", () => {
    const t = trimCaption("alpha beta gamma delta epsilon zeta eta theta iota kappa", 30);
    expect(t.endsWith("…")).toBe(true);
    expect(t.replace("…", "").split(" ").every((w) => ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"].includes(w))).toBe(true);
  });
});

describe("writePostCopy", () => {
  it("writes the words for the brief's channels and counts one post_copy usage event", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook", "whatsapp"], secondaryUspIds: [b.usps.rating.id] });
    expect(copyChannels(brief)).toEqual(["instagram", "facebook", "whatsapp"]);
    const before = await usageCount();
    const { copy: out, usd } = await writePostCopy({ userId: b.userId, brandId: b.brandId, brief, now: NOW });
    expect(usd).toBe(0);
    expect(Object.keys(out.captions)).toEqual(["instagram", "facebook", "whatsapp"]);
    expect(out.headline).toBe("20% off cakes");
    expect(await usageCount()).toBe(before + 1);
  });

  it("records what the call cost", async () => {
    const brief = await readyBrief(b);
    live.usd = 0.0123;
    try {
      const { usd } = await writePostCopy({ userId: b.userId, brandId: b.brandId, brief, now: NOW }, { fixture: copy() });
      expect(usd).toBe(0.0123);
    } finally {
      live.usd = null;
    }
    const [row] = await db.withAdmin((tx) => tx.query<{ usd: string }>("select usd from public.usage_events where brand_id = $1 and kind = 'post_copy' order by created_at desc, id desc limit 1", [b.brandId]));
    expect(Number(row.usd)).toBeCloseTo(0.0123, 6);
  });

  it("sends the prompt the brief's own facts, and a payment ID the owner typed never reaches the model (input or output)", async () => {
    const id = "corner.bakery@okhdfcbank";
    const sneaky = await createUsp(b.userId, b.brandId, { kind: "custom", title: `Pay ${id} now`.slice(0, 60), details: {} });
    const brief = await readyBrief(b, { primaryUspId: sneaky.id, secondaryUspIds: [], notes: `Our UPI is ${id}, mention it`, postType: "occasion", cta: null, endsOn: null });
    let sent = "";
    const { copy: out } = await writePostCopy(
      { userId: b.userId, brandId: b.brandId, brief, now: NOW },
      {
        fixture: (prompt) => {
          sent = `${prompt.system}\n${prompt.user}`;
          return copy({ captions: [{ channel: "instagram", text: `Pay at ${id} or upi://pay?pa=${id}&pn=Corner` }] });
        },
      },
    );
    expect(sent).toContain("BRIEF:");
    expect(sent).toContain("[payment ID removed]");
    expect(sent.toLowerCase()).not.toContain(id);
    expect(sent.toLowerCase()).not.toContain("okhdfcbank");
    expect(out.captions.instagram.toLowerCase()).not.toContain("okhdfcbank");
    expect(out.captions.instagram).toContain("[payment ID removed]");
  });

  it("fixes a model answer with bad lengths and says what it fixed", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    const { copy: out } = await writePostCopy(
      { userId: b.userId, brandId: b.brandId, brief, now: NOW },
      { fixture: copy({ headline: "This headline has far too many words in it today", cta_text: "Please come and visit our bakery today", captions: [{ channel: "instagram", text: "ok" }] }) },
    );
    expect(out.headline).toBe("20% off cakes");
    expect(out.ctaText).toBe("Visit us");
    expect(out.captions.facebook).toBeTruthy();
    expect(out.fixes).toEqual(expect.arrayContaining(["headline_too_long", "cta_too_long", "caption_missing:facebook"]));
  });

  it("an answer the schema rejects is an error, not a half post", async () => {
    const brief = await readyBrief(b);
    const bad = copy({ headline: "x".repeat(200) });
    await expect(writePostCopy({ userId: b.userId, brandId: b.brandId, brief, now: NOW }, { fixture: bad })).rejects.toBeInstanceOf(PostCopyError);
  });

  it("stops at the weekly count cap (40 a week) without calling the model", async () => {
    const other = await makeOwner(db, { name: "Cap Bakery" });
    const brief = await createBrief(other.userId, other.brandId, { postType: "brand", cta: "visit", channels: ["instagram"], status: "ready" }, { now: NOW });
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 1000 where id = $1", [other.brandId]));
    await db.withAdmin((tx) => tx.query("insert into public.usage_events (brand_id, kind, usd) select $1, 'post_copy'::public.usage_kind, 0 from generate_series(1, 40)", [other.brandId]));
    let called = false;
    await expect(
      writePostCopy({ userId: other.userId, brandId: other.brandId, brief, now: new Date() }, { fixture: () => ((called = true), copy()) }),
    ).rejects.toBeInstanceOf(WeeklyCapError);
    expect(called).toBe(false);
  });

  it("stops at the daily cap", async () => {
    const other = await makeOwner(db, { name: "Daily Cap Bakery" });
    const brief = await createBrief(other.userId, other.brandId, { postType: "brand", cta: "visit", channels: ["instagram"], status: "ready" }, { now: NOW });
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 0 where id = $1", [other.brandId]));
    await expect(writePostCopy({ userId: other.userId, brandId: other.brandId, brief, now: new Date() }, { fixture: copy() })).rejects.toBeInstanceOf(DailyCapError);
  });

  it("refuses a brand the user does not belong to", async () => {
    const other = await makeOwner(db, { name: "Other Bakery" });
    const brief = await readyBrief(b);
    await expect(writePostCopy({ userId: other.userId, brandId: b.brandId, brief, now: NOW }, { fixture: copy() })).rejects.toThrow();
  });
});
