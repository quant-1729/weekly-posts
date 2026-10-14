import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { createBrief, updateBrief } from "@/lib/briefs/service";
import { CreateError, briefFingerprint, checkCopyEdit, ensureDraftPosts, listBriefPosts, saveCopy, chooseDesign } from "@/lib/create";
import { loadDesignPage, previewForOption, type DesignPageData } from "@/lib/create/view";
import type { MockDb } from "@/lib/db/mock";
import { QR_LABEL } from "@/lib/create/content";
import { closeDb, openDb } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery, uniq } from "./helpers";

let db: MockDb;
let b: Bakery;

const copy = (over: Partial<PostCopy> = {}): PostCopy => {
  const t = uniq();
  return {
    headline: "Cake week is here",
    subline: "Fresh every morning",
    cta_text: "Visit us today",
    captions: [
      { channel: "instagram", text: `Cake week! 20% off cakes ${t} until 20 Oct.` },
      { channel: "facebook", text: `Cake week ${t} at Corner Bakery. 20% off cakes ${t} until 20 Oct.` },
    ],
    hashtags: ["#cakes", "#bakery"],
    bubble: "",
    pose: "",
    ...over,
  };
};

const usage = async (kind: string) =>
  (await db.withAdmin((tx) => tx.query<{ n: number }>("select count(*)::int as n from public.usage_events where brand_id = $1 and kind = $2::public.usage_kind", [b.brandId, kind])))[0].n;

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });
const deps = (c: PostCopy = copy()) => ({ copy: { fixture: c }, now: NOW });

describe("the copy is written once and cached as draft posts", () => {
  it("creates one draft post per channel and does not call the AI again on a second visit", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    const before = await usage("post_copy");
    const first = await ensureDraftPosts(args(brief.id), deps());
    expect(first.created).toBe(true);
    expect(first.posts.map((p) => p.channel)).toEqual(["instagram", "facebook"]);
    expect(await usage("post_copy")).toBe(before + 1);

    const second = await ensureDraftPosts(args(brief.id), deps(copy({ headline: "Something else entirely" })));
    expect(second.created).toBe(false);
    expect(second.posts.map((p) => p.id)).toEqual(first.posts.map((p) => p.id));
    expect(second.posts[0].imageText.headline).toBe("Cake week is here");
    expect(await usage("post_copy")).toBe(before + 1);

    for (const p of first.posts) {
      expect(p).toMatchObject({ briefId: brief.id, brandId: b.brandId, status: "draft", themeId: null, layoutId: null, design: null, carouselId: null });
      expect(p.postCode).toMatch(/^[a-z0-9]{7}$/);
      expect(p.cta).toBe("Visit us today");
      expect(p.hashtags.length).toBeGreaterThan(0);
    }
    const [row] = await db.withAdmin((tx) => tx.query<{ batch_id: string | null; original: { caption: string } }>("select batch_id, original from public.posts where id = $1", [first.posts[0].id]));
    expect(row.batch_id).toBeNull();
    expect(row.original.caption).toContain("Cake week");
  });

  it("writes the words again when the details changed since, and not when only the photo or a line did", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const first = await ensureDraftPosts(args(brief.id), deps());
    const before = await usage("post_copy");
    // A photo or a line switched on or off does not need new words.
    const tweaked = await updateBrief(b.userId, b.brandId, brief.id, { photoId: b.photoId, blocks: { phone: false } }, { now: NOW });
    expect(briefFingerprint(tweaked)).toBe(briefFingerprint(brief));
    expect((await ensureDraftPosts(args(brief.id), deps())).posts.map((p) => p.id)).toEqual(first.posts.map((p) => p.id));
    expect(await usage("post_copy")).toBe(before);
    // A different call to action is a different post.
    const changed = await updateBrief(b.userId, b.brandId, brief.id, { cta: "call" }, { now: NOW });
    expect(briefFingerprint(changed)).not.toBe(briefFingerprint(brief));
    const second = await ensureDraftPosts(args(brief.id), deps(copy({ headline: "Call us for cake" })));
    expect(second.created).toBe(true);
    expect(second.posts.map((p) => p.id)).not.toEqual(first.posts.map((p) => p.id));
    expect(second.posts[0].imageText.headline).toBe("Call us for cake");
    expect(await usage("post_copy")).toBe(before + 1);
    expect(await listBriefPosts(b.userId, b.brandId, brief.id, { slides: true })).toHaveLength(1);
    expect(await db.withAdmin((tx) => tx.query("select 1 from public.posts where id = $1", [first.posts[0].id]))).toEqual([]);
  });

  it("two visits at once still write the copy once", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "whatsapp"] });
    const before = await usage("post_copy");
    const [x, y] = await Promise.all([ensureDraftPosts(args(brief.id), deps()), ensureDraftPosts(args(brief.id), deps())]);
    expect(x.posts.map((p) => p.id)).toEqual(y.posts.map((p) => p.id));
    expect(await usage("post_copy")).toBe(before + 1);
    expect(await listBriefPosts(b.userId, b.brandId, brief.id)).toHaveLength(2);
  });

  it("flags an invented price in the copy on every channel's post, and keeps the flags with the draft", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    const { posts } = await ensureDraftPosts(args(brief.id), deps(copy({ headline: "Cakes from £2.50", captions: [{ channel: "instagram", text: "Only £3.99!" }, { channel: "facebook", text: "20% off cakes" }] })));
    const open = (i: number) => posts[i].flags.filter((f) => f.status === "open");
    expect(open(0).some((f) => f.field === "image_text.headline" && f.text.includes("2.50"))).toBe(true);
    expect(open(0).some((f) => f.field === "caption" && f.text.includes("3.99"))).toBe(true);
    expect(open(1).some((f) => f.field === "image_text.headline")).toBe(true);
    expect(open(1).some((f) => f.field === "caption")).toBe(false);
    // The same flag id on both channels: confirming one on the picture's words can confirm both.
    const idOn = (i: number) => open(i).find((f) => f.field === "image_text.headline")!.id;
    expect(idOn(0)).toBe(idOn(1));
  });

  it("a draft brief is not designed", async () => {
    const draft = await createBrief(b.userId, b.brandId, { postType: "brand", cta: "visit", channels: ["instagram"] }, { now: NOW });
    await expect(ensureDraftPosts(args(draft.id), deps())).rejects.toMatchObject({ code: "brief_not_ready" });
    expect(await loadDesignPage(args(draft.id), deps())).toEqual({ state: "not_ready" });
  });

  it("a payment QR whose ID is not active blocks before any AI is paid for", async () => {
    const brief = await readyBrief(b, { qr: { kind: "payment", paymentId: b.paymentId }, channels: ["instagram"] });
    await db.withAdmin((tx) => tx.query("update public.payment_ids set status = 'retired' where id = $1", [b.paymentId]));
    try {
      const before = await usage("post_copy");
      await expect(ensureDraftPosts(args(brief.id), deps())).rejects.toBeInstanceOf(CreateError);
      await expect(ensureDraftPosts(args(brief.id), deps())).rejects.toMatchObject({ code: "qr_blocked" });
      expect(await usage("post_copy")).toBe(before);
      expect(await loadDesignPage(args(brief.id), deps())).toMatchObject({ state: "blocked" });
      expect(await listBriefPosts(b.userId, b.brandId, brief.id)).toEqual([]);
    } finally {
      await db.withAdmin((tx) => tx.query("update public.payment_ids set status = 'active' where id = $1", [b.paymentId]));
    }
  });
});

describe("three options", () => {
  it("shows 3 distinct options at the first channel's main size, each with a preview and a report", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"], secondaryUspIds: [b.usps.rating.id] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    expect(page.state).toBe("ready");
    expect(page.format).toBe("square");
    expect(page.formats).toEqual(["square", "portrait"]);
    expect(page.options).toHaveLength(3);
    const keys = page.options.map((o) => `${o.option.themeId}/${o.option.layoutId}/${o.option.scheme}`);
    expect(new Set(keys).size).toBe(3);
    for (const o of page.options) {
      expect(o.src).toMatch(/^data:image\/jpeg;base64,/);
      expect(o.src.length).toBeGreaterThan(2000);
      expect(o.lines).toEqual(expect.objectContaining({ noRoom: expect.any(Array), notShown: expect.any(Array), problems: expect.any(Array) }));
      expect(o.layouts.length).toBeGreaterThan(0);
      expect(o.layouts.map((l) => l.id)).toContain(o.used.layoutId);
    }
    // The previews are really different pictures.
    expect(new Set(page.options.map((o) => o.src)).size).toBe(3);
    expect(page.carousel).toBe(false);
    expect(page.designed).toBe(false);
    expect(page.words.headline).toBe("Cake week is here");
    expect(page.captions.map((c) => c.channel)).toEqual(["instagram", "facebook"]);
  });

  it("the options are the same every time (nothing random, no new AI call)", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const before = await usage("post_copy");
    const one = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const two = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    expect(one.options.map((o) => o.option)).toEqual(two.options.map((o) => o.option));
    expect(await usage("post_copy")).toBe(before + 1);
  });

  it("with a photo the layouts are the photo ones; 'no photo' gives typography-only layouts", async () => {
    const withPhoto = await readyBrief(b, { channels: ["instagram"], photoId: b.photoId });
    const a = (await loadDesignPage(args(withPhoto.id), deps())) as DesignPageData;
    expect(a.photoId).toBe(b.photoId);
    expect(a.photos.map((p) => p.id)).toContain(b.photoId);
    const without = await readyBrief(b, { channels: ["instagram"] });
    const c = (await loadDesignPage(args(without.id), deps())) as DesignPageData;
    expect(c.options.map((o) => o.option.layoutId)).not.toEqual(a.options.map((o) => o.option.layoutId));
  });

  it("swapping to the next layout gives another picture (the buttons call this)", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const o = page.options[0];
    const at = o.layouts.findIndex((l) => l.id === o.used.layoutId);
    const next = o.layouts[(at + 1) % o.layouts.length];
    const swapped = await previewForOption({ ...args(brief.id), option: { ...o.option, layoutId: next.id } }, deps());
    expect(swapped.src).not.toBe(o.src);
    const recoloured = await previewForOption({ ...args(brief.id), option: { ...o.option, scheme: o.option.scheme === "dark" ? "light" : "dark" } }, deps());
    expect(recoloured.src).not.toBe(o.src);
  });

  it("shows the dropped items as 'No room for' lines when a layout cannot hold everything", async () => {
    const brief = await readyBrief(b, { channels: ["youtube"], secondaryUspIds: [b.usps.rating.id, b.usps.delivery.id] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    expect(page.format).toBe("thumbnail");
    expect(page.carousel).toBe(true); // two extra points on a thumbnail that holds one
    const lines = page.options.flatMap((o) => [...o.lines.noRoom, ...o.lines.notShown]);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(/^secondary line/);
  });
});

describe("quick edits of the words (re-checked by the guardrail)", () => {
  it("rejects what is too long and saves nothing", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    await ensureDraftPosts(args(brief.id), deps());
    const bad = { headline: "one two three four five six seven eight nine", ctaText: "x".repeat(30), captions: { instagram: "" } };
    expect(checkCopyEdit(bad, "en", ["instagram"]).length).toBe(3);
    const r = await saveCopy({ ...args(brief.id), edit: bad }, deps());
    expect(r).toMatchObject({ ok: false });
    expect((await listBriefPosts(b.userId, b.brandId, brief.id))[0].imageText.headline).toBe("Cake week is here");
  });

  it("saves, checks again, and flags an invented price in the new headline; fixing it clears the flag", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    await ensureDraftPosts(args(brief.id), deps());
    const bad = await saveCopy({ ...args(brief.id), edit: { headline: "Cakes from £2.50", captions: { facebook: "Visit us for 20% off cakes until 20 Oct." } } }, deps());
    expect(bad.ok && bad.changed).toBe(true);
    if (!bad.ok) throw new Error("unreachable");
    expect(bad.posts.every((p) => p.imageText.headline === "Cakes from £2.50")).toBe(true);
    expect(bad.posts[1].caption).toBe("Visit us for 20% off cakes until 20 Oct.");
    expect(bad.posts.every((p) => p.flags.some((f) => f.status === "open" && f.field === "image_text.headline"))).toBe(true);
    const fixed = await saveCopy({ ...args(brief.id), edit: { headline: "20% off cakes" } }, deps());
    if (!fixed.ok) throw new Error("unreachable");
    expect(fixed.posts.every((p) => p.flags.filter((f) => f.status === "open").length === 0)).toBe(true);
  });

  it("an unchanged save changes nothing; hashtags follow each channel's limit", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "whatsapp"] });
    await ensureDraftPosts(args(brief.id), deps());
    const same = await saveCopy({ ...args(brief.id), edit: { headline: "Cake week is here" } }, deps());
    expect(same).toMatchObject({ ok: true, changed: false });
    const tags = await saveCopy({ ...args(brief.id), edit: { hashtags: "#a #b, c" } }, deps());
    if (!tags.ok) throw new Error("unreachable");
    expect(tags.posts[0].hashtags).toEqual(["#a", "#b", "#c"]);
    expect(tags.posts[1].hashtags).toEqual([]); // WhatsApp posts take no hashtags
  });

  it("changing the words after a design was used clears the design (the pictures no longer match)", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    if (page.state !== "ready") throw new Error(JSON.stringify(page));
    await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    expect((await listBriefPosts(b.userId, b.brandId, brief.id))[0].themeId).not.toBeNull();
    const r = await saveCopy({ ...args(brief.id), edit: { headline: "New headline now" } }, deps());
    if (!r.ok) throw new Error("unreachable");
    expect(r.posts[0]).toMatchObject({ themeId: null, layoutId: null, design: null, status: "draft" });
    const images = await db.withAdmin((tx) => tx.query("select 1 from public.post_images where post_id = $1", [r.posts[0].id]));
    expect(images).toEqual([]);
  });

  it("the QR label is the one the guardrail expects", () => {
    expect(QR_LABEL).toEqual({ visit: "Scan to visit", pay: "Scan to pay" });
  });
});
