import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));

import { GET } from "@/app/api/posts/[briefId]/pdf/route";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { approveCreatePost, chooseDesign, ensureDraftPosts, listBriefPosts, loadDesignPage, loadReviewData, type DesignPageData } from "@/lib/create";
import type { MockDb } from "@/lib/db/mock";
import { pdfFilename } from "@/lib/share/pdf";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, uniq, type Bakery } from "../create/pipeline/helpers";

let db: MockDb;
let b: Bakery;
let other: Owner;

const copy = (): PostCopy => ({
  headline: "Cake week is here",
  subline: "Fresh every morning",
  cta_text: "Visit us today",
  captions: ["instagram", "facebook"].map((channel) => ({ channel: channel as "instagram", text: `Cake week at Corner Bakery ${uniq()} with 20% off cakes until 20 Oct.` })),
  hashtags: ["#cakes"],
  bubble: "",
  pose: "",
  slides: [
    { kind: "cover", headline: "Cake week is here", body: "Fresh every morning" },
    { kind: "point", headline: "Free delivery in London", body: "Across the whole city" },
    { kind: "point", headline: "Free coffee with every cake", body: "Baked every morning" },
    { kind: "proof", headline: "20% off cakes", body: "" },
    { kind: "cta", headline: "Visit us today", body: "" },
  ],
});
const deps = () => ({ copy: { fixture: copy() }, now: NOW });
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });
const rows = <T,>(sql: string, params: unknown[]) => db.withAdmin((tx) => tx.query<T>(sql, params));
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } }).png().toBuffer();

/** Gives a stored picture a known size, so the order of the PDF's pages can be read back. */
async function resize(imagePath: string, w: number, h: number) {
  await b.storage.put("renders", imagePath.replace(/^renders\//, ""), await png(w, h), "image/png");
}

async function approvedBrief(patch: Record<string, unknown> = {}, channels = ["instagram"]) {
  const brief = await readyBrief(b, { channels, ...patch });
  const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
  await chooseDesign({ ...args(brief.id), option: page.options[0].option });
  for (const p of await listBriefPosts(b.userId, b.brandId, brief.id)) {
    const r = await approveCreatePost({ userId: b.userId, brandId: b.brandId, postId: p.id });
    expect(r.ok).toBe(true);
  }
  return brief;
}

const get = (briefId: string, query = "") => GET(new NextRequest(`http://localhost:3000/api/posts/${briefId}/pdf${query}`), { params: Promise.resolve({ briefId }) } as never);
const pages = async (res: Response) => {
  const pdf = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
  return { pdf, sizes: pdf.getPages().map((p) => p.getSize()) };
};

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  other = await makeOwner(db, { name: "Other Shop", country: "GB" });
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});
beforeEach(() => {
  session.user = { id: b.userId };
});

describe("Download PDF", () => {
  it("one page per picture of a single post, main size first, at each picture's own size; PDF headers, title and author", async () => {
    const brief = await approvedBrief();
    const [post] = await listBriefPosts(b.userId, b.brandId, brief.id);
    const review = (await loadReviewData(b.userId, b.brandId, brief.id))!.posts[0];
    expect(review.images.length).toBe(2);
    const imgs = await rows<{ format: string; image_path: string }>("select format::text as format, image_path from public.post_images where post_id = $1", [post.id]);
    const size = (format: string) => ({ width: format === review.images[0].format ? 300 : 200, height: 250 });
    for (const i of imgs) await resize(i.image_path, size(i.format).width, size(i.format).height);

    const res = await get(brief.id, `?post=${post.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="corner-bakery-\d{4}-\d{2}-\d{2}\.pdf"$/);
    const { pdf, sizes } = await pages(res);
    expect(sizes).toEqual([{ width: 300, height: 250 }, { width: 200, height: 250 }]); // the main size first
    expect(pdf.getTitle()).toBe("Corner Bakery posts");
    expect(pdf.getAuthor()).toBe("Corner Bakery");
  });

  it("a carousel gives every slide in slide order, one page each", async () => {
    const brief = await approvedBrief({ contentFormat: "carousel", slideCount: 5, secondaryUspIds: [b.usps.delivery.id], qr: { kind: "link", target: "website", url: "https://bakery.example.com" } });
    const all = await listBriefPosts(b.userId, b.brandId, brief.id, { slides: true });
    const slides = all.filter((p) => p.carouselId !== null).sort((x, y) => (x.slideIndex ?? 0) - (y.slideIndex ?? 0));
    expect(slides.length).toBe(5);
    for (const [i, sl] of slides.entries()) {
      const [img] = await rows<{ image_path: string }>("select image_path from public.post_images where post_id = $1", [sl.id]);
      await resize(img.image_path, 100 + i * 10, 140);
    }
    const res = await get(brief.id);
    expect(res.status).toBe(200);
    expect((await pages(res)).sizes.map((s) => s.width)).toEqual([100, 110, 120, 130, 140]);
  });

  it("covers every channel's post of the brief, or just the one asked for", async () => {
    const brief = await approvedBrief({}, ["instagram", "facebook"]);
    const posts = await listBriefPosts(b.userId, b.brandId, brief.id);
    const review = (await loadReviewData(b.userId, b.brandId, brief.id))!.posts;
    const total = review.reduce((n, p) => n + p.images.length, 0);
    expect((await pages(await get(brief.id))).sizes.length).toBe(total);
    const fb = posts.find((p) => p.channel === "facebook")!;
    expect((await pages(await get(brief.id, `?post=${fb.id}`))).sizes.length).toBe(review.find((p) => p.id === fb.id)!.images.length);
  });

  it("refuses a signed-out visitor and other businesses; a post not approved yet is not handed out", async () => {
    const brief = await approvedBrief();
    session.user = null;
    expect((await get(brief.id)).status).toBe(401);
    session.user = { id: other.userId };
    const res = await get(brief.id);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toBe("application/pdf");
    expect((await get("not-a-uuid")).status).toBe(404);
    session.user = { id: b.userId };
    expect((await get(brief.id, "?post=nope")).status).toBe(404);

    const draft = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(draft.id), deps())) as DesignPageData;
    await chooseDesign({ ...args(draft.id), option: page.options[0].option });
    expect((await get(draft.id)).status).toBe(409);
    const only = await readyBrief(b, { channels: ["instagram"] });
    await ensureDraftPosts(args(only.id), deps());
    expect((await get(only.id)).status).toBe(409);
  });

  it("names the file after the business and the date", () => {
    expect(pdfFilename("Corner Bakery", new Date("2026-10-18T09:00:00Z"))).toBe("corner-bakery-2026-10-18.pdf");
    expect(pdfFilename("Café Zoë & Sons!", new Date("2026-10-18T09:00:00Z"))).toBe("cafe-zoe-sons-2026-10-18.pdf");
    expect(pdfFilename("चाय की दुकान", new Date("2026-10-18T09:00:00Z"))).toBe("posts-2026-10-18.pdf");
  });
});
