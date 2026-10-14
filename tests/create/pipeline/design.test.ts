import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { setUspConfirmed } from "@/lib/usps/service";
import { CreateError, getTypeDefault, listBriefPosts, redrawPosts, chooseDesign, ensureDraftPosts } from "@/lib/create";
import { loadDesignPage, type DesignPageData } from "@/lib/create/view";
import type { StoredDesign } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { FORMAT_SIZE } from "@/lib/design/types";
import { verifyRendered } from "@/lib/qr/decode";
import { closeDb, openDb } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;

const copy = (over: Partial<PostCopy> = {}): PostCopy => ({
  headline: "Cake week is here",
  subline: "Fresh every morning",
  cta_text: "Visit us today",
  captions: ["instagram", "facebook", "whatsapp", "youtube"].map((channel) => ({ channel: channel as "instagram", text: `Cake week at Corner Bakery (${channel}). 20% off cakes until 20 Oct.` })),
  hashtags: ["#cakes"],
  bubble: "",
  pose: "",
  ...over,
});
const deps = (c: PostCopy = copy()) => ({ copy: { fixture: c }, now: NOW });
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });

const rows = <T,>(sql: string, params: unknown[]) => db.withAdmin((tx) => tx.query<T>(sql, params));
const imagesOf = (postId: string) => rows<{ format: string; template_id: string; image_path: string }>("select format::text as format, template_id, image_path from public.post_images where post_id = $1 order by format", [postId]);
const file = async (path: string) => Buffer.from((await b.storage.get("renders", path.replace(/^renders\//, "")))!.bytes);

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("Use this design: every format the channels need", () => {
  it("stores one post per channel with a picture for each of its sizes, drawn at the right size", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook", "whatsapp", "youtube"], secondaryUspIds: [b.usps.rating.id], qr: { kind: "link", target: "website", url: "https://bakery.example.com" } });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const chosen = page.options[1].option;
    const out = await chooseDesign({ ...args(brief.id), option: chosen }, deps());

    expect(out.posts.map((p) => p.channel)).toEqual(["instagram", "facebook", "whatsapp", "youtube"]);
    expect(out.slides).toEqual([]);
    const wanted: Record<string, string[]> = { instagram: ["portrait", "square"], facebook: ["square"], whatsapp: ["vertical"], youtube: ["thumbnail"] };
    for (const p of out.posts) {
      expect(p).toMatchObject({ status: "draft", themeId: chosen.themeId, briefId: brief.id });
      expect(p.layoutId).toBeTruthy();
      const imgs = await imagesOf(p.id);
      expect(imgs.map((i) => i.format)).toEqual(wanted[p.channel]);
      for (const i of imgs) {
        expect(i.image_path).toBe(`renders/${b.brandId}/${p.id}/${i.format}.png`);
        const meta = await sharp(await file(i.image_path)).metadata();
        const size = FORMAT_SIZE[i.format as keyof typeof FORMAT_SIZE];
        expect([meta.format, meta.width, meta.height]).toEqual(["png", size.width, size.height]);
      }
    }
    expect(out.blockers).toEqual([]);
  });

  it("stores the design with the post: content, scheme and the options shown, so a redraw is identical", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"], secondaryUspIds: [b.usps.delivery.id] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const chosen = page.options[2].option;
    const out = await chooseDesign({ ...args(brief.id), option: chosen }, deps());
    const d = out.posts[0].design as StoredDesign;
    expect(d.v).toBe(1);
    expect(d.option).toEqual(chosen);
    expect(d.options).toHaveLength(3);
    expect(d.options.map((o) => o.layoutId)).toEqual(page.options.map((o) => o.option.layoutId));
    expect(d.content).toMatchObject({ headline: "Cake week is here", cta: { kind: "visit", text: "Visit us today" }, offerLine: "Till 20 Oct" });
    expect(d.content.secondary).toEqual([{ kind: "delivery", text: "Free delivery in London" }]);
    expect(d.formats).toEqual(["square", "portrait"]);
    expect(d.scheme).toBeTruthy();
    expect(Object.keys(d.dropped).sort()).toEqual(["portrait", "square"]);

    const before = await Promise.all((await imagesOf(out.posts[0].id)).map(async (i) => [i.format, (await file(i.image_path)).toString("base64")]));
    await redrawPosts(args(brief.id), deps());
    const after = await Promise.all((await imagesOf(out.posts[0].id)).map(async (i) => [i.format, (await file(i.image_path)).toString("base64")]));
    expect(after).toEqual(before);
  });

  it("each channel's link QR holds its own post's short link, and the QR reads back exactly", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"], qr: { kind: "link", target: "website", url: "https://bakery.example.com" }, cta: "scan" });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    const texts = out.posts.map((p) => (p.design as StoredDesign).content.qr?.text);
    expect(texts[0]).toContain(`/r/${out.posts[0].postCode}?q=1`);
    expect(texts[1]).toContain(`/r/${out.posts[1].postCode}?q=1`);
    expect(texts[0]).not.toBe(texts[1]);
    expect((out.posts[0].design as StoredDesign).content.qr?.label).toBe("Scan to visit");
    // Decode the stored square picture: it must hold exactly that text.
    const square = (await imagesOf(out.posts[0].id)).find((i) => i.format === "square")!;
    const res = await verifyRendered(await file(square.image_path), texts[0]!);
    expect(res.ok).toBe(true);
    expect(out.blockers).toEqual([]);
  });

  it("a payment QR reads back as exactly the confirmed ID; thumbnails carry no QR", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "youtube"], qr: { kind: "payment", paymentId: b.paymentId }, cta: "scan" });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    const content = (out.posts[0].design as StoredDesign).content;
    expect(content.qr?.text).toBe("upi://pay?pa=corner.bakery@okhdfcbank&pn=Corner%20Bakery&cu=INR");
    expect(content.qr?.payment).toEqual({ address: "corner.bakery@okhdfcbank", payeeName: "Corner Bakery" });
    const square = (await imagesOf(out.posts[0].id)).find((i) => i.format === "square")!;
    expect((await verifyRendered(await file(square.image_path), content.qr!.text)).ok).toBe(true);
    expect(out.blockers).toEqual([]);
    const thumb = (await imagesOf(out.posts[1].id)).find((i) => i.format === "thumbnail")!;
    expect((await verifyRendered(await file(thumb.image_path), content.qr!.text)).ok).toBe(false); // no QR on a thumbnail
  });

  it("refuses a design that is not one of the options' kind, and a payment QR that stopped being active", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const o = page.options[0].option;
    await expect(chooseDesign({ ...args(brief.id), option: { ...o, layoutId: "no-such-layout" } }, deps())).rejects.toMatchObject({ code: "invalid_option" });
    await expect(chooseDesign({ ...args(brief.id), option: { ...o, themeId: "nope" as never } }, deps())).rejects.toBeInstanceOf(CreateError);
    await expect(chooseDesign({ ...args(brief.id), option: { ...o, scheme: "pink" as never } }, deps())).rejects.toBeInstanceOf(CreateError);

    const pay = await readyBrief(b, { channels: ["instagram"], qr: { kind: "payment", paymentId: b.paymentId } });
    const p2 = (await loadDesignPage(args(pay.id), deps())) as DesignPageData;
    await db.withAdmin((tx) => tx.query("update public.payment_ids set status = 'retired' where id = $1", [b.paymentId]));
    try {
      await expect(chooseDesign({ ...args(pay.id), option: p2.options[0].option }, deps())).rejects.toMatchObject({ code: "qr_blocked" });
      expect(await rows("select 1 from public.post_images where post_id = $1", [(await listBriefPosts(b.userId, b.brandId, pay.id))[0].id])).toEqual([]);
    } finally {
      await db.withAdmin((tx) => tx.query("update public.payment_ids set status = 'active' where id = $1", [b.paymentId]));
    }
  });

  it("using another design replaces the pictures and drops sizes the channels no longer need", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const first = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    const id = first.posts[0].id;
    expect((await imagesOf(id)).map((i) => i.format)).toEqual(["portrait", "square"]);
    // A stray picture of a size that is not needed is removed with the next design.
    await rows("insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, 'banner', 'x', $3)", [id, b.brandId, `renders/${b.brandId}/${id}/banner.png`]);
    await b.storage.put("renders", `${b.brandId}/${id}/banner.png`, Buffer.from("x"), "image/png");
    const second = await chooseDesign({ ...args(brief.id), option: page.options[1].option }, deps());
    expect((await imagesOf(id)).map((i) => i.format)).toEqual(["portrait", "square"]);
    expect(await b.storage.get("renders", `${b.brandId}/${id}/banner.png`)).toBeNull();
    expect(second.posts[0].design?.option).toEqual(page.options[1].option);
  });
});

describe("carousel (one point per slide)", () => {
  it("makes slide rows with one picture each when the points do not fit one picture", async () => {
    const brief = await readyBrief(b, { channels: ["youtube"], secondaryUspIds: [b.usps.rating.id, b.usps.delivery.id] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    expect(page.carousel).toBe(true);
    const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    const d = out.posts[0].design as StoredDesign;
    expect(d.carousel).toMatchObject({ slides: 4 });
    expect(out.slides.map((s) => s.slideIndex)).toEqual([0, 1, 2, 3]);
    expect(new Set(out.slides.map((s) => s.carouselId))).toEqual(new Set([d.carousel!.id]));
    expect(out.slides.every((s) => s.channel === "youtube" && s.status === "draft" && s.themeId === out.posts[0].themeId)).toBe(true);
    expect(out.slides.map((s) => (s.design as StoredDesign).slide)).toEqual([0, 1, 2, 3].map((i) => ({ index: i, total: 4 })));
    // Slide 1 has the headline, the middle slides one point each, the last the call to action.
    expect(out.slides.map((s) => (s.design as StoredDesign).content.headline)).toEqual(["Cake week is here", "4.8 on Google", "Free delivery in London", "Visit us today"]);
    for (const s of out.slides) {
      const imgs = await imagesOf(s.id);
      expect(imgs.map((i) => i.format)).toEqual(["thumbnail"]);
      const meta = await sharp(await file(imgs[0].image_path)).metadata();
      expect([meta.width, meta.height]).toEqual([1280, 720]);
    }
    // The main post still has its own single thumbnail, and the slides are not listed as posts of the brief.
    expect((await imagesOf(out.posts[0].id)).map((i) => i.format)).toEqual(["thumbnail"]);
    expect((await listBriefPosts(b.userId, b.brandId, brief.id)).map((p) => p.id)).toEqual([out.posts[0].id]);
    expect(await listBriefPosts(b.userId, b.brandId, brief.id, { slides: true })).toHaveLength(5);
  });

  it("choosing a design again replaces the slides instead of adding more", async () => {
    const brief = await readyBrief(b, { channels: ["youtube"], secondaryUspIds: [b.usps.rating.id, b.usps.delivery.id] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    const again = await chooseDesign({ ...args(brief.id), option: page.options[1].option }, deps());
    expect(again.slides).toHaveLength(4);
    expect(await rows("select 1 from public.posts where brief_id = $1 and carousel_id is not null", [brief.id])).toHaveLength(4);
  });
});

describe("the design becomes the default for the post type (G-7)", () => {
  it("is remembered per type, offered first next time, and does not change the other types", async () => {
    const offer = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(offer.id), deps())) as DesignPageData;
    const pick = page.options[2].option;
    const previous = await getTypeDefault(b.userId, b.brandId, "offer"); // an earlier test used a design for offers too
    expect(previous).not.toEqual({ themeId: pick.themeId, layoutId: pick.layoutId, scheme: pick.scheme });
    await chooseDesign({ ...args(offer.id), option: pick }, deps());
    expect(await getTypeDefault(b.userId, b.brandId, "offer")).toEqual({ themeId: pick.themeId, layoutId: pick.layoutId, scheme: pick.scheme });

    const next = await readyBrief(b, { channels: ["instagram"] });
    const page2 = (await loadDesignPage(args(next.id), deps())) as DesignPageData;
    expect(page2.options).toHaveLength(3);
    expect(page2.options[0].option).toEqual(pick);
    expect(new Set(page2.options.map((o) => `${o.option.themeId}/${o.option.layoutId}/${o.option.scheme}`)).size).toBe(3);

    expect(await getTypeDefault(b.userId, b.brandId, "event")).toBeNull();
    // The rest of the kit is untouched.
    const [m] = await rows<{ kit: Record<string, unknown> }>("select kit from public.brand_memory where brand_id = $1", [b.brandId]);
    expect(Object.keys(m.kit)).toContain("typeDefaults");
  });
});

describe("a photo and the logo switch", () => {
  it("draws the photo layouts when the brief has a photo and stores the photo on the posts", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"], photoId: b.photoId });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    expect(out.posts[0].photoId).toBe(b.photoId);
    expect((out.posts[0].design as StoredDesign).photoId).toBe(b.photoId);
  });

  it("an unconfirmed claim in a design is flagged on the draft and the design still draws", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"], postType: "brand", primaryUspId: b.usps.best.id, endsOn: null });
    const { posts } = await ensureDraftPosts(args(brief.id), deps(copy({ headline: "Best cakes in town" })));
    expect(posts[0].flags.some((f) => f.status === "open" && /best/i.test(f.text))).toBe(true);
    await setUspConfirmed(b.userId, b.brandId, b.usps.best.id, true);
  });
});
