// A carousel the owner asked for (owner request 2026-10-16): the words of every slide checked in code and by the fact check,
// every channel's slides drawn as one set, review, approval, undo, the queue and publishing all slides as one carousel.
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { saveConnection } from "@/lib/connections/service";
import { SLIDE_BODY_MAX_WORDS, SLIDE_HEAD_MAX_WORDS, fallbackSlides, trimWords, validateCopy, wordCount, writePostCopy } from "@/lib/create/copy";
import { loadCreateBrand } from "@/lib/create/brand";
import { offerLineFor } from "@/lib/create/content";
import {
  approveCreatePost,
  chooseDesign,
  confirmPostFlag,
  ensureDraftPosts,
  listBriefPosts,
  logCreateShare,
  removePostFlag,
  resetToBase,
  saveCopy,
  undoCreateApproval,
} from "@/lib/create";
import { loadDesignPage, loadReviewData, shareTextFor, type DesignPageData } from "@/lib/create/view";
import type { StoredDesign } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { updateBrief } from "@/lib/briefs/service";
import type { SlideText } from "@/lib/design/types";
import { verifyRendered } from "@/lib/qr/decode";
import { createPublisher } from "@/lib/publish";
import { loadForPublish } from "@/lib/publish/load";
import { pickImagePath } from "@/lib/publish/media";
import { scheduleApproved } from "@/lib/queue/service";
import { buildDeliveryEmail, loadDeliveryPost } from "@/lib/queue/deliver";
import { closeDb, openDb } from "../../helpers/details";
import { fakeFetch, stubMetaEnv, when, type Call } from "../../connections/helpers";
import { publicStorage } from "../../publish/helpers";
import { NOW, cleanup, makeBakery, readyBrief, uniq, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;

const slide = (kind: SlideText["kind"], headline: string, body = ""): SlideText => ({ kind, headline, body });
const GOOD: SlideText[] = [
  slide("cover", "Cake week is here", "Fresh every morning"),
  slide("point", "Free delivery in London", "Across the whole city"),
  slide("point", "Only £3.99 a loaf", "Baked every morning"),
  slide("proof", "20% off cakes"),
  slide("cta", "Visit us today"),
];

const copy = (over: Partial<PostCopy> = {}): PostCopy => ({
  headline: "Cake week is here",
  subline: "Fresh every morning",
  cta_text: "Visit us today",
  captions: ["instagram", "facebook", "linkedin", "whatsapp"].map((channel) => ({ channel: channel as "instagram", text: `Cake week at Corner Bakery ${uniq()} with 20% off cakes until 20 Oct.` })),
  hashtags: ["#cakes"],
  bubble: "",
  pose: "",
  slides: GOOD,
  ...over,
});
const deps = (c: PostCopy = copy()) => ({ copy: { fixture: c }, now: NOW });
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });
const carousel = (patch: Record<string, unknown> = {}) =>
  readyBrief(b, { contentFormat: "carousel", slideCount: 5, secondaryUspIds: [b.usps.delivery.id], qr: { kind: "link", target: "website", url: "https://bakery.example.com" }, ...patch });
const rows = <T,>(sql: string, params: unknown[]) => db.withAdmin((tx) => tx.query<T>(sql, params));
const file = async (path: string) => Buffer.from((await b.storage.get("renders", path.replace(/^renders\//, "")))!.bytes);

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

// ---------------------------------------------------------------------------------------------

describe("the slides the model returns are checked in code", () => {
  let brief: Awaited<ReturnType<typeof carousel>>;
  const ctx = () => ({ brief, brandName: "Corner Bakery", language: "en", channels: ["instagram"], mascot: false, contactLines: [] as string[] });
  const run = (slides: PostCopy["slides"], over: Partial<PostCopy> = {}) => validateCopy(copy({ slides, ...over }), ctx());

  beforeAll(async () => {
    brief = await carousel();
  });

  it("keeps a good set: the cover first, the call to action last, in the model's order", () => {
    const r = run(GOOD);
    expect(r.slides).toEqual(GOOD);
    expect(r.fixes.filter((f) => f.startsWith("slide"))).toEqual([]);
  });

  it("a post (not a carousel) has no slides, whatever the model sent", async () => {
    const post = await readyBrief(b);
    expect(validateCopy(copy(), { ...ctx(), brief: post }).slides).toEqual([]);
  });

  it("adds the cover when the first slide is not one, and the call to action when the last is not one", () => {
    const r = run([slide("point", "Free delivery in London"), slide("point", "Fresh every morning")]);
    expect(r.slides[0]).toMatchObject({ kind: "cover", headline: "Cake week is here" });
    expect(r.slides.at(-1)).toMatchObject({ kind: "cta", headline: "Visit us today" });
    expect(r.slides.map((x) => x.kind)).toEqual(["cover", "point", "point", "cta"]);
    expect(r.fixes).toEqual(expect.arrayContaining(["slide_cover_added", "slide_cta_added"]));
  });

  it("turns a cover or call to action in the middle into a point", () => {
    const r = run([slide("cover", "Cake week"), slide("cta", "Order now"), slide("cover", "Hello again"), slide("cta", "Visit us today")]);
    expect(r.slides.map((x) => x.kind)).toEqual(["cover", "point", "point", "cta"]);
  });

  it("never returns more slides than asked: the cover and the call to action stay, the last points go", () => {
    const many = [slide("cover", "Cake week"), ...Array.from({ length: 7 }, (_, i) => slide("point", `Point number ${i + 1}`)), slide("cta", "Visit us today")];
    const r = run(many);
    expect(r.slides).toHaveLength(5);
    expect(r.slides[0].kind).toBe("cover");
    expect(r.slides.at(-1)).toMatchObject({ kind: "cta", headline: "Visit us today" });
    expect(r.slides.slice(1, 4).map((x) => x.headline)).toEqual(["Point number 1", "Point number 2", "Point number 3"]);
    expect(r.fixes).toContain("slides_too_many");
  });

  it("trims long words by the word count: a headline to its limit, a body to its limit at a sentence end or with an ellipsis", () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen";
    const body = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const r = run([slide("cover", long, body), slide("point", long, body), slide("cta", "Visit us today now please call")]);
    for (const x of r.slides) {
      expect(wordCount(x.headline)).toBeLessThanOrEqual(SLIDE_HEAD_MAX_WORDS[x.kind]);
      expect(wordCount(x.body)).toBeLessThanOrEqual(SLIDE_BODY_MAX_WORDS[x.kind]);
    }
    expect(r.slides[1].headline).toBe("one two three four five six");
    expect(r.slides[1].body.endsWith("…")).toBe(true);
    expect(r.fixes).toContain("slide_trimmed");
    expect(trimWords("First sentence here. Second sentence goes on and on.", 5, "en", { ellipsis: true })).toBe("First sentence here.");
  });

  it("drops a slide with no headline", () => {
    const r = run([slide("cover", "Cake week"), slide("point", "", "A body with no headline"), slide("point", "Free delivery in London"), slide("cta", "Visit us today")]);
    expect(r.slides.map((x) => x.headline)).toEqual(["Cake week", "Free delivery in London", "Visit us today"]);
  });

  it("too few slides (none, or one) are replaced by slides made only from the brief, never invented", () => {
    for (const few of [[], [slide("cover", "Only one")]]) {
      const r = run(few);
      expect(r.fixes).toContain("slides_fallback");
      expect(r.slides.length).toBeGreaterThanOrEqual(2);
      expect(r.slides.length).toBeLessThanOrEqual(5);
      expect(r.slides[0]).toMatchObject({ kind: "cover", headline: r.headline });
      expect(r.slides.at(-1)).toMatchObject({ kind: "cta", headline: r.ctaText });
      // Every word on a fallback slide is the post's headline, a selling point's own title, the offer line or the call to action.
      const allowed = new Set([r.headline, r.ctaText, r.subline, offerLineFor(brief, "en") ?? "", ...brief.uspSnapshot.map((u) => u.title)]);
      for (const x of r.slides) expect([x.headline, x.body].filter(Boolean).every((t) => allowed.has(t))).toBe(true);
      // The proof is the offer line, only when the brief has one.
      expect(r.slides.some((x) => x.kind === "proof" && x.headline === offerLineFor(brief, "en"))).toBe(true);
    }
  });

  it("a brief with nothing to say still gets a cover and a closing slide", () => {
    const bare = { ...brief, uspSnapshot: [], cta: null, endsOn: null, startsOn: null, blocks: {} };
    const out = fallbackSlides({ brief: bare, brandName: "Corner Bakery", language: "en", headline: "Hello", subline: "", ctaText: "", want: 5 });
    expect(out.map((x) => x.kind)).toEqual(["cover", "cta"]);
    expect(out[1].headline).toBe("Corner Bakery");
  });
});

describe("writePostCopy asks for the slides", () => {
  it("passes the slide count in the prompt for a carousel, and none for a post", async () => {
    const brand = await loadCreateBrand(b.userId, b.brandId);
    const seen: string[] = [];
    const fixture = (p: { user: string }) => {
      seen.push(p.user);
      return copy();
    };
    const c = await carousel({ slideCount: 7 });
    const r = await writePostCopy({ userId: b.userId, brandId: b.brandId, brief: c, brand, now: NOW }, { fixture });
    expect(seen[0]).toContain("CAROUSEL: 7 slides");
    expect(r.copy.slides.length).toBe(5); // the fixture returned 5: fewer than asked is accepted, never padded with invented text
    const post = await readyBrief(b);
    const r2 = await writePostCopy({ userId: b.userId, brandId: b.brandId, brief: post, brand, now: NOW }, { fixture });
    expect(seen[1]).toContain("CAROUSEL: none");
    expect(r2.copy.slides).toEqual([]);
  });

  it("without a fixture (offline mode) writes slides from the brief", async () => {
    const brand = await loadCreateBrand(b.userId, b.brandId);
    const c = await carousel({ slideCount: 4 });
    const r = await writePostCopy({ userId: b.userId, brandId: b.brandId, brief: c, brand, now: NOW });
    expect(r.copy.slides.length).toBeGreaterThanOrEqual(2);
    expect(r.copy.slides.length).toBeLessThanOrEqual(4);
    expect(r.copy.slides[0].kind).toBe("cover");
    expect(r.copy.slides.at(-1)!.kind).toBe("cta");
  });
});

// ---------------------------------------------------------------------------------------------

describe("one carousel through Design, Review, approval, the queue and publishing", () => {
  let briefId: string;
  let ig: string; // post ids
  let fb: string;
  const flagOf = (flags: { slide?: number; kind: string }[], slideNo: number) => flags.filter((f) => f.slide === slideNo);

  beforeAll(async () => {
    briefId = (await carousel({ channels: ["instagram", "facebook"] })).id;
  });

  it("checks each slide's words with the fact check: the unbacked price on slide 3 is flagged, the rest are not", async () => {
    const { posts, created } = await ensureDraftPosts(args(briefId), deps());
    expect(created).toBe(true);
    expect(posts.map((p) => p.channel)).toEqual(["instagram", "facebook"]);
    [ig, fb] = posts.map((p) => p.id);
    for (const p of posts) {
      expect(p.imageText.slides).toEqual(GOOD); // stored on the post, so a redraw and "Undo all" use them
      const slideFlags = p.flags.filter((f) => f.slide !== undefined);
      expect(slideFlags).toHaveLength(1);
      expect(slideFlags[0]).toMatchObject({ slide: 2, kind: "price", status: "open", field: "image_text.headline", text: "£3.99" });
      expect(slideFlags[0].id.startsWith("s2_")).toBe(true);
      // The words that are the brief's own (free delivery, 20% off) raise nothing.
      expect(flagOf(p.flags, 1)).toEqual([]);
      expect(flagOf(p.flags, 3)).toEqual([]);
      // And no flag leaked into the picture words or the caption.
      expect(p.flags.filter((f) => f.slide === undefined && /3\.99/.test(f.text))).toEqual([]);
    }
  });

  it("the design step shows every option as a strip of all five slides in one design", async () => {
    const page = (await loadDesignPage(args(briefId), deps())) as DesignPageData;
    expect(page.slideCount).toBe(5);
    expect(page.carousel).toBe(false);
    expect(page.format).toBe("portrait");
    expect(page.options).toHaveLength(3);
    for (const o of page.options) {
      expect(o.slides).toHaveLength(5);
      expect(o.src).toBe(o.slides![0]);
      for (const src of o.slides!) expect(src.startsWith("data:image/jpeg;base64,")).toBe(true);
      expect(o.lines.problems).toEqual([]);
    }
    // The flag is listed on the design step with its slide.
    expect(page.flags.some(({ flag }) => flag.slide === 2)).toBe(true);
  });

  it("'Use this design' draws a slide set per channel: portrait for Instagram and Facebook, one picture each, the cover on the post", async () => {
    const page = (await loadDesignPage(args(briefId), deps())) as DesignPageData;
    const out = await chooseDesign({ ...args(briefId), option: page.options[1].option }, deps());
    expect(out.posts.map((p) => p.channel)).toEqual(["instagram", "facebook"]);
    expect(out.slides).toHaveLength(10);
    expect(out.blockers).toEqual([]);
    for (const p of out.posts) {
      const design = p.design as StoredDesign;
      expect(design.carousel).toMatchObject({ slides: 5 });
      expect(design.formats).toEqual(["portrait"]);
      const mine = out.slides.filter((s) => s.carouselId === design.carousel!.id);
      expect(mine.map((s) => s.slideIndex)).toEqual([0, 1, 2, 3, 4]);
      expect(mine.every((s) => s.channel === p.channel && s.themeId === p.themeId)).toBe(true);
      expect(new Set(mine.map((s) => (s.design as StoredDesign).scheme)).size).toBe(1);
      mine.forEach((s, i) => expect((s.design as StoredDesign).slide).toMatchObject({ index: i, total: 5, kind: GOOD[i].kind }));
      // The post's own picture is the cover, in the slide size; every slide has one picture of that size.
      const own = await rows<{ format: string; image_path: string }>("select format::text as format, image_path from public.post_images where post_id = $1", [p.id]);
      expect(own.map((i) => i.format)).toEqual(["portrait"]);
      for (const s of mine) {
        const imgs = await rows<{ format: string; image_path: string }>("select format::text as format, image_path from public.post_images where post_id = $1", [s.id]);
        expect(imgs.map((i) => i.format)).toEqual(["portrait"]);
        const meta = await sharp(await file(imgs[0].image_path)).metadata();
        expect([meta.width, meta.height]).toEqual([1080, 1350]);
      }
      // The QR is on the closing slide only and reads back as this channel's short link.
      const last = mine.at(-1)!;
      const qr = (last.design as StoredDesign).content.qr!;
      expect(qr.text).toContain(`/r/${p.postCode}`);
      const lastImg = (await rows<{ image_path: string }>("select image_path from public.post_images where post_id = $1", [last.id]))[0];
      expect((await verifyRendered(await file(lastImg.image_path), qr.text, { left: 0, top: 0, width: 1080, height: 1350 })).ok).toBe(true);
      mine.slice(0, -1).forEach((s) => expect((s.design as StoredDesign).content.qr).toBeNull());
    }
    // Instagram and Facebook have their own short links, so their closing slides differ; the other slides are drawn once and shared.
    const q = (p: (typeof out.posts)[number]) => (p.design as StoredDesign).content.qr!.text;
    expect(q(out.posts[0])).not.toBe(q(out.posts[1]));
  }, 120_000);

  it("review shows the slide strip with the flag on slide 3, and the post cannot be approved until it is answered", async () => {
    const review = (await loadReviewData(b.userId, b.brandId, briefId))!;
    for (const p of review.posts) {
      expect(p.carouselAsked).toBe(true);
      expect(p.slides).toHaveLength(5);
      expect(p.images.map((i) => i.format)).toEqual(["portrait"]);
      expect(p.openFlags.map((f) => f.slide)).toEqual([2]);
      expect(p.canApprove).toBe(false);
    }
    expect((await approveCreatePost({ ...args(briefId), postId: ig, now: NOW })).ok).toBe(false);
  });

  it("'Remove' on a slide flag cuts the text out of that slide on every channel and draws the slides again", async () => {
    const before = await listBriefPosts(b.userId, b.brandId, briefId);
    const flag = before[0].flags.find((f) => f.slide === 2)!;
    const out = await removePostFlag({ ...args(briefId), postId: ig, flagId: flag.id, now: NOW }, deps());
    expect(out).toMatchObject({ ok: true, redrawn: true });
    const after = await listBriefPosts(b.userId, b.brandId, briefId);
    for (const p of after) {
      expect(p.imageText.slides[2].headline).toBe("Only a loaf");
      expect(p.imageText.slides[1].headline).toBe("Free delivery in London"); // the other slides are untouched
      expect(p.flags.find((f) => f.id === flag.id)?.status).toBe("removed");
      expect(p.status).toBe("draft");
    }
    const slides = (await listBriefPosts(b.userId, b.brandId, briefId, { slides: true })).filter((p) => p.carouselId !== null);
    expect(slides).toHaveLength(10);
    expect(slides.filter((s) => s.slideIndex === 2).every((s) => (s.design as StoredDesign).content.headline === "Only a loaf")).toBe(true);
  }, 120_000);

  it("'Undo all' brings the slide words and their flag back, and draws the set again", async () => {
    const r = await resetToBase(args(briefId), deps());
    expect(r).toMatchObject({ ok: true, redrawn: true });
    const posts = await listBriefPosts(b.userId, b.brandId, briefId);
    for (const p of posts) {
      expect(p.imageText.slides).toEqual(GOOD);
      expect(p.flags.filter((f) => f.slide === 2 && f.status === "open")).toHaveLength(1);
    }
    const all = await listBriefPosts(b.userId, b.brandId, briefId, { slides: true });
    expect(all.filter((p) => p.carouselId !== null)).toHaveLength(10);
  }, 120_000);

  it("confirming the slide flag on one channel confirms it on the other; then both can be approved, slides included", async () => {
    const posts = await listBriefPosts(b.userId, b.brandId, briefId);
    const flag = posts[0].flags.find((f) => f.slide === 2)!;
    expect(await confirmPostFlag({ ...args(briefId), userId: b.userId, postId: ig, flagId: flag.id, now: NOW })).toEqual({ ok: true });
    const after = await listBriefPosts(b.userId, b.brandId, briefId);
    expect(after.map((p) => p.flags.find((f) => f.id === flag.id)?.status)).toEqual(["confirmed", "confirmed"]);

    for (const id of [ig, fb]) expect(await approveCreatePost({ ...args(briefId), postId: id, now: NOW })).toEqual({ ok: true, changed: true });
    const status = await rows<{ status: string; n: number }>("select status::text as status, count(*)::int as n from public.posts where brief_id = $1 group by status", [briefId]);
    expect(status).toEqual([{ status: "approved", n: 12 }]); // 2 posts and 10 slides
    // Share is logged for the post (the owner's Share or Download of all slides).
    expect(await logCreateShare({ userId: b.userId, brandId: b.brandId, postId: ig, kind: "share", format: "portrait" })).toEqual({ ok: true });
    // Undo approval takes the slides back to draft with the post.
    expect(await undoCreateApproval({ ...args(briefId), postId: fb })).toEqual({ ok: true, changed: true });
    expect((await rows<{ n: number }>("select count(*)::int as n from public.posts where brief_id = $1 and status = 'approved'", [briefId]))[0].n).toBe(6);
    await approveCreatePost({ ...args(briefId), postId: fb, now: NOW });
  });

  it("editing a caption keeps the slides and their flags", async () => {
    const posts = await listBriefPosts(b.userId, b.brandId, briefId);
    const r = await saveCopy({ ...args(briefId), edit: { captions: { instagram: `${posts[0].caption} Come by.` } } }, deps());
    expect(r.ok).toBe(true);
    const after = await listBriefPosts(b.userId, b.brandId, briefId);
    expect(after[0].imageText.slides).toEqual(GOOD);
    expect(after[0].flags.find((f) => f.slide === 2)?.status).toBe("confirmed");
    // The edited post goes back to draft (as for any edit); approve it again for the queue test below.
    expect(after[0].status).toBe("draft");
    expect(await approveCreatePost({ ...args(briefId), postId: ig, now: NOW })).toEqual({ ok: true, changed: true });
  });

  it("the delivery email and the ready page know all five slides, in the slide size", async () => {
    const post = (await loadDeliveryPost(b.brandId, ig))!;
    expect(post.formats).toEqual(["portrait"]);
    expect(post.slideIds).toHaveLength(5);
    const mail = await buildDeliveryEmail({ brand: { id: b.brandId, name: "Corner Bakery" }, post, slotAt: NOW.toISOString(), timezone: "Europe/London", kind: "delivery", now: NOW });
    expect(mail.html).toContain("A carousel of 5 slides");
    expect(mail.html.match(/alt="Slide \d"/g)).toHaveLength(5);
    expect(shareTextFor({ ...(await listBriefPosts(b.userId, b.brandId, briefId))[0], aiFace: false }, "https://app.example.com")).toContain("Cake week");
  });

  describe("one queue item per channel publishes all the slides as one carousel", () => {
    const IG = "17841400000000001";
    const PAGE = "1001";
    beforeEach(() => stubMetaEnv());
    afterEach(() => vi.unstubAllEnvs());

    it("schedules two items, and the publisher posts five pictures to each", async () => {
      resetTokenKeyForTests();
      stubMetaEnv();
      await saveConnection({ brandId: b.brandId, userId: b.userId, provider: "instagram", accountId: IG, accountName: "@cornerbakery", scopes: [], platformUserId: null, expiresAt: new Date(Date.now() + 40 * 86400_000), token: "IGAAlong-lived-token-ZZZZ1234567890" });
      await saveConnection({ brandId: b.brandId, userId: b.userId, provider: "facebook", accountId: PAGE, accountName: "Corner Bakery", scopes: [], platformUserId: null, expiresAt: null, token: "EAAPageAccessToken-QQQQ1234567890" });

      const r = await scheduleApproved({ userId: b.userId, brandId: b.brandId, briefId, now: NOW });
      expect(r.ok && r.outcome.items).toHaveLength(2);
      const items = await rows<{ id: string; channel: string; post_id: string }>("select id::text as id, channel::text as channel, post_id::text as post_id from public.queue_items where brand_id = $1 order by channel", [b.brandId]);
      expect(items.map((i) => i.channel)).toEqual(["facebook", "instagram"]);

      let n = 0;
      const f = fakeFetch([
        when("GET", /\/content_publishing_limit$/, { body: { data: [{ quota_usage: 1, config: { quota_total: 100 } }] } }),
        when("POST", /\/media$/, () => ({ body: { id: `C${++n}` } })),
        when("GET", /\/C\d+$/, { body: { status_code: "FINISHED" } }),
        when("POST", /\/media_publish$/, { body: { id: "M1" } }),
        when("GET", /\/M1$/, { body: { permalink: "https://www.instagram.com/p/ABC123/" } }),
        when("POST", /\/photos$/, (c: Call) => ({ body: { id: `P${c.params.get("url")!.length}${++n}` } })),
        when("POST", /\/feed$/, { body: { id: `${PAGE}_777` } }),
        when("GET", /\/1001_\d+$/, { body: { permalink_url: "https://www.facebook.com/Page/posts/777" } }),
      ]);
      const publish = createPublisher({ fetch: f.fetch, sleep: async () => undefined, storage: publicStorage(), now: () => NOW });

      const igItem = items.find((i) => i.channel === "instagram")!;
      const loaded = (await loadForPublish(igItem.id, b.brandId))!;
      expect(loaded.slides).toHaveLength(5);
      expect(loaded.slides.every((s) => Object.keys(s).join() === "portrait")).toBe(true);
      expect(pickImagePath(loaded.slides[0], "instagram")).toMatch(/portrait\.png$/);
      expect(loaded.images.portrait).toBeTruthy(); // the post's own picture is its cover

      expect(await publish({ itemId: igItem.id, brandId: b.brandId })).toMatchObject({ ok: true, platformPostId: "M1" });
      const creates = f.calls.filter((c) => c.method === "POST" && c.path.endsWith("/media"));
      expect(creates).toHaveLength(6); // 5 slides + the carousel itself
      creates.slice(0, 5).forEach((c) => expect(c.params.get("is_carousel_item")).toBe("true"));
      expect(creates[5].params.get("media_type")).toBe("CAROUSEL");
      expect(creates[5].params.get("children")!.split(",")).toHaveLength(5);
      expect(creates[5].params.get("caption")).toContain("Cake week at Corner Bakery");
      const slideIds = (await rows<{ id: string }>("select id::text as id from public.posts where carousel_id = (select (design->'carousel'->>'id')::uuid from public.posts where id = $1) order by slide_index", [igItem.post_id])).map((x) => x.id);
      creates.slice(0, 5).forEach((c, i) => expect(c.params.get("image_url")).toContain(`${slideIds[i]}/portrait.png`));

      const fbItem = items.find((i) => i.channel === "facebook")!;
      expect(await publish({ itemId: fbItem.id, brandId: b.brandId })).toMatchObject({ ok: true });
      const photos = f.calls.filter((c) => c.method === "POST" && c.path.endsWith("/photos"));
      expect(photos).toHaveLength(5);
      photos.forEach((c) => expect(c.params.get("published")).toBe("false"));
      const feed = f.calls.find((c) => c.path.endsWith("/feed"))!;
      expect([0, 1, 2, 3, 4].every((i) => feed.params.has(`attached_media[${i}]`))).toBe(true);
      expect(feed.params.has("attached_media[5]")).toBe(false);
    }, 120_000);
  });
});

// ---------------------------------------------------------------------------------------------

describe("channels that are not Instagram or Facebook get square slides", () => {
  it("draws LinkedIn and WhatsApp carousels in square, next to Instagram in portrait", async () => {
    const brief = await carousel({ channels: ["instagram", "linkedin", "whatsapp"], slideCount: 3, qr: null });
    const three = [slide("cover", "Cake week is here", "Fresh every morning"), slide("point", "Free delivery in London"), slide("cta", "Visit us today")];
    const page = (await loadDesignPage(args(brief.id), deps(copy({ slides: three })))) as DesignPageData;
    expect(page.options[0].slides).toHaveLength(3);
    const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps(copy({ slides: three })));
    const sizes: Record<string, string[]> = {};
    for (const p of out.posts) {
      const imgs = await rows<{ format: string; image_path: string }>("select format::text as format, image_path from public.post_images where post_id = $1", [p.id]);
      sizes[p.channel] = imgs.map((i) => i.format);
    }
    expect(sizes).toEqual({ instagram: ["portrait"], linkedin: ["square"], whatsapp: ["square"] });
    expect(out.slides).toHaveLength(9);
    const sq = out.slides.find((s) => s.channel === "linkedin")!;
    const img = (await rows<{ image_path: string }>("select image_path from public.post_images where post_id = $1", [sq.id]))[0];
    const meta = await sharp(await file(img.image_path)).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1080]);
    const email = await loadDeliveryPost(b.brandId, out.posts.find((p) => p.channel === "linkedin")!.id);
    expect(email!.formats).toEqual(["square"]);
    expect(email!.slideIds).toHaveLength(3);
  }, 120_000);
});

describe("changing the format or the slide count writes the words again", () => {
  it("a new count is a new fingerprint: the old posts and slides are replaced", async () => {
    const brief = await carousel({ slideCount: 5 });
    const first = await ensureDraftPosts(args(brief.id), deps());
    expect(first.posts[0].imageText.slides).toHaveLength(5);
    await updateBrief(b.userId, b.brandId, brief.id, { slideCount: 4, status: "ready" }, { now: NOW });
    const four = [slide("cover", "Cake week is here"), slide("point", "Free delivery in London"), slide("point", "Baked every morning"), slide("cta", "Visit us today")];
    const again = await ensureDraftPosts(args(brief.id), deps(copy({ slides: four })));
    expect(again.created).toBe(true);
    expect(again.posts[0].imageText.slides).toHaveLength(4);
    await updateBrief(b.userId, b.brandId, brief.id, { contentFormat: "post", status: "ready" }, { now: NOW });
    const post = await ensureDraftPosts(args(brief.id), deps());
    expect(post.created).toBe(true);
    expect(post.posts[0].imageText.slides).toEqual([]);
  });
});
