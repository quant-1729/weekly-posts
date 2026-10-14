import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import {
  approveCreatePost,
  chooseDesign,
  confirmPostFlag,
  ensureDraftPosts,
  getPost,
  listBriefPosts,
  loadReviewData,
  logCreateShare,
  removePostFlag,
  undoCreateApproval,
} from "@/lib/create";
import { loadDesignPage, shareTextFor, type DesignPageData } from "@/lib/create/view";
import type { StoredDesign } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import type { Flag } from "@/lib/guardrail";
import { BrandAccessError } from "@/lib/brand/current";
import { closeDb, makeOwner, openDb, type Owner } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery, uniq } from "./helpers";

let db: MockDb;
let b: Bakery;
let other: Owner;

const copy = (over: Partial<PostCopy> = {}): PostCopy => {
  const t = uniq();
  return {
    headline: "Cake week is here",
    subline: "",
    cta_text: "Visit us today",
    captions: [
      { channel: "instagram", text: `Cake week! 20% off cakes ${t} until 20 Oct.` },
      { channel: "facebook", text: `Cake week ${t} at Corner Bakery. 20% off cakes ${t} until 20 Oct.` },
    ],
    hashtags: ["#cakes"],
    bubble: "",
    pose: "",
    ...over,
  };
};
const deps = (c: PostCopy = copy()) => ({ copy: { fixture: c }, now: NOW });
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });
const rows = <T,>(sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<T>(sql, params));

/** A brief that has its copy and a chosen design, ready for the review step. */
async function designed(c: PostCopy, patch: Record<string, unknown> = {}) {
  const brief = await readyBrief(b, { channels: ["instagram", "facebook"], ...patch });
  const page = (await loadDesignPage(args(brief.id), deps(c))) as DesignPageData;
  const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps(c));
  return { brief, posts: out.posts, slides: out.slides };
}

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  other = await makeOwner(db, { name: "Other Shop", country: "GB" });
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("approval", () => {
  it("is blocked while a flag is open, and works once the owner confirmed it; a flag on the picture's words is confirmed on every channel", async () => {
    const { posts } = await designed(copy({ headline: "Cakes from £2.50" }));
    expect(posts[0].flags.some((f) => f.status === "open" && f.field === "image_text.headline")).toBe(true);
    const blocked = await approveCreatePost({ ...b, postId: posts[0].id });
    expect(blocked).toMatchObject({ ok: false, code: "blocked" });
    expect(blocked.ok === false && blocked.flags?.length).toBeGreaterThan(0);
    expect((await getPost(b.userId, b.brandId, posts[0].id))?.status).toBe("draft");

    const flag = posts[0].flags.find((f) => f.status === "open" && f.field === "image_text.headline")!;
    expect(await confirmPostFlag({ ...b, postId: posts[0].id, flagId: flag.id })).toEqual({ ok: true });
    for (const p of posts) {
      const now = (await getPost(b.userId, b.brandId, p.id))!;
      expect(now.flags.find((f) => f.id === flag.id)?.status).toBe("confirmed");
    }
    const ok = await approveCreatePost({ ...b, postId: posts[0].id, now: NOW });
    expect(ok).toEqual({ ok: true, changed: true });
    const after = (await getPost(b.userId, b.brandId, posts[0].id))!;
    expect(after.status).toBe("approved");
    expect(after.approvedAt).toBe(NOW.toISOString());
    expect(await approveCreatePost({ ...b, postId: posts[0].id })).toEqual({ ok: true, changed: false });
    // The other channel's post is its own: still a draft.
    expect((await getPost(b.userId, b.brandId, posts[1].id))?.status).toBe("draft");
    const actions = await rows<{ action: string; via: string }>("select action::text as action, via from public.post_actions where post_id = $1 order by id", [posts[0].id]);
    expect(actions.map((a) => a.action)).toEqual(["edit", "approve"]);
    expect(actions.every((a) => a.via === "dashboard")).toBe(true);
  });

  it("a flag in one caption is removed from that caption only; the post can then be approved", async () => {
    const { posts } = await designed(copy({ captions: [{ channel: "instagram", text: "Cake week! Only £3.99 today, 20% off cakes." }, { channel: "facebook", text: "20% off cakes until 20 Oct." }] }));
    const flag = posts[0].flags.find((f) => f.status === "open" && f.field === "caption")!;
    expect(flag.text).toContain("3.99");
    const r = await removePostFlag({ ...b, postId: posts[0].id, flagId: flag.id }, deps());
    expect(r).toEqual({ ok: true, redrawn: false });
    const after = (await getPost(b.userId, b.brandId, posts[0].id))!;
    expect(after.caption).not.toContain("3.99");
    expect(after.caption).toContain("20% off cakes");
    expect(after.flags.find((f) => f.id === flag.id)?.status).toBe("removed");
    expect((await getPost(b.userId, b.brandId, posts[1].id))?.caption).toBe("20% off cakes until 20 Oct.");
    expect(await approveCreatePost({ ...b, postId: posts[0].id })).toMatchObject({ ok: true });
    // A flag that is not open can not be removed again.
    expect(await removePostFlag({ ...b, postId: posts[0].id, flagId: flag.id }, deps())).toMatchObject({ ok: false, code: "not_open" });
  });

  it("removing a flag on the headline cuts it on every channel and draws the pictures again", async () => {
    const { posts } = await designed(copy({ headline: "Cakes only £2.50 today" }));
    const flag = posts[0].flags.find((f) => f.status === "open" && f.field === "image_text.headline")!;
    const before = (await rows<{ image_path: string }>("select image_path from public.post_images where post_id = $1 and format = 'square'", [posts[0].id]))[0].image_path;
    const bytesBefore = Buffer.from((await b.storage.get("renders", before.replace(/^renders\//, "")))!.bytes);
    const r = await removePostFlag({ ...b, postId: posts[0].id, flagId: flag.id }, deps());
    expect(r).toEqual({ ok: true, redrawn: true });
    for (const p of posts) {
      const now = (await getPost(b.userId, b.brandId, p.id))!;
      expect(now.imageText.headline).toBe("Cakes only today");
      expect((now.design as StoredDesign).content.headline).toBe("Cakes only today");
      expect(now.flags.find((f) => f.id === flag.id)?.status).toBe("removed");
    }
    const bytesAfter = Buffer.from((await b.storage.get("renders", before.replace(/^renders\//, "")))!.bytes);
    expect(bytesAfter.equals(bytesBefore)).toBe(false);
    expect(await approveCreatePost({ ...b, postId: posts[0].id })).toMatchObject({ ok: true });
  });

  it("a regulated claim needs the extra tick", async () => {
    const { posts } = await designed(copy());
    const flag: Flag = { id: "f_reg", text: "heals fast", kind: "claim", field: "caption", layer: "ai", regulated: true, highlight: true, status: "open", decided_at: null };
    await rows("update public.posts set fact_flags = $2::jsonb where id = $1", [posts[0].id, JSON.stringify([flag])]);
    expect(await confirmPostFlag({ ...b, postId: posts[0].id, flagId: "f_reg" })).toMatchObject({ ok: false, code: "ack_required" });
    expect(await confirmPostFlag({ ...b, postId: posts[0].id, flagId: "f_reg", regulatedAck: true })).toEqual({ ok: true });
  });

  it("is blocked by a design problem: text that does not fit, or a QR that does not read back as intended", async () => {
    const { posts } = await designed(copy());
    for (const blocker of [
      { format: "square", code: "overflow", detail: "headline" },
      { format: "portrait", code: "qr_mismatch", detail: "upi://pay?pa=someone.else@bank" },
    ]) {
      const design = { ...(posts[0].design as StoredDesign), blockers: [blocker] };
      await rows("update public.posts set design = $2::jsonb where id = $1", [posts[0].id, JSON.stringify(design)]);
      const r = await approveCreatePost({ ...b, postId: posts[0].id });
      expect(r).toMatchObject({ ok: false, code: "design" });
      expect(r.ok === false && r.blockers).toEqual([blocker]);
      expect((await getPost(b.userId, b.brandId, posts[0].id))?.status).toBe("draft");
      const view = await loadReviewData(b.userId, b.brandId, posts[0].briefId);
      expect(view?.posts[0]).toMatchObject({ canApprove: false, blockers: [blocker] });
    }
  });

  it("is blocked until a design has been chosen", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const { posts } = await ensureDraftPosts(args(brief.id), deps());
    expect(await approveCreatePost({ ...b, postId: posts[0].id })).toMatchObject({ ok: false, code: "design" });
    expect((await loadReviewData(b.userId, b.brandId, brief.id))?.posts[0]).toMatchObject({ designed: false, canApprove: false });
  });

  it("the carousel slides are approved and undone with their post; undo goes back to draft", async () => {
    const { posts, slides } = await designed(copy({ captions: [{ channel: "youtube", text: "20% off cakes" }] }), {
      channels: ["youtube"],
      secondaryUspIds: [b.usps.free.id, b.usps.delivery.id],
    });
    expect(slides).toHaveLength(4);
    expect(await approveCreatePost({ ...b, postId: posts[0].id })).toMatchObject({ ok: true });
    const statuses = async () => (await listBriefPosts(b.userId, b.brandId, posts[0].briefId, { slides: true })).map((p) => p.status);
    expect(await statuses()).toEqual(Array(5).fill("approved"));
    expect(await undoCreateApproval({ ...b, postId: posts[0].id })).toEqual({ ok: true, changed: true });
    expect(await statuses()).toEqual(Array(5).fill("draft"));
    expect((await getPost(b.userId, b.brandId, posts[0].id))?.approvedAt).toBeNull();
  });
});

describe("share log and the review data", () => {
  it("only an approved post can be shared or downloaded, and each is logged", async () => {
    const { posts } = await designed(copy());
    expect(await logCreateShare({ ...b, postId: posts[0].id, kind: "download", format: "square" })).toMatchObject({ ok: false, code: "not_approved" });
    await approveCreatePost({ ...b, postId: posts[0].id });
    expect(await logCreateShare({ ...b, postId: posts[0].id, kind: "download", format: "square" })).toEqual({ ok: true });
    expect(await logCreateShare({ ...b, postId: posts[0].id, kind: "share", format: "portrait" })).toEqual({ ok: true });
    const log = await rows<{ action: string; detail: { format?: string } }>("select action::text as action, detail from public.post_actions where post_id = $1 and action in ('share', 'download') order by id", [posts[0].id]);
    expect(log.map((l) => [l.action, l.detail.format])).toEqual([["download", "square"], ["share", "portrait"]]);
  });

  it("lists every channel's post with its sizes in order, its caption, flags and what Copy and Share send", async () => {
    const { brief, posts } = await designed(copy(), { channels: ["instagram", "facebook", "whatsapp"] });
    const view = (await loadReviewData(b.userId, b.brandId, brief.id))!;
    expect(view.briefId).toBe(brief.id);
    expect(view.posts.map((p) => p.channel)).toEqual(["instagram", "facebook", "whatsapp"]);
    expect(view.posts.map((p) => p.images.map((i) => i.format))).toEqual([["square", "portrait"], ["square"], ["vertical"]]);
    expect(view.posts[0].images[0].url).toMatch(new RegExp(`^/api/files/renders/${b.brandId}/${posts[0].id}/square\\.png\\?v=\\d+$`));
    expect(view.posts[0]).toMatchObject({ label: "Instagram", status: "draft", designed: true, canApprove: true, openFlags: [], blockers: [] });
    expect(view.posts[0].caption).toContain("Cake week");
    // Instagram captions carry no link; Facebook and WhatsApp end with the call to action and the post's short link.
    expect(view.posts[0].shareText).not.toContain("/r/");
    expect(view.posts[1].shareText).toContain(`Visit us today http://localhost:3000/r/${posts[1].postCode}`);
    expect(view.allApproved).toBe(false);
    for (const p of posts) await approveCreatePost({ ...b, postId: p.id });
    expect((await loadReviewData(b.userId, b.brandId, brief.id))?.allApproved).toBe(true);
    expect(shareTextFor({ channel: "gbp", caption: "A", cta: "Call", hashtags: ["#x"], postCode: "abc1234" }, "https://app.example/")).toBe("A\n\nCall https://app.example/r/abc1234\n\n#x");
  });

  it("a brief with no posts yet has no review data", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    expect(await loadReviewData(b.userId, b.brandId, brief.id)).toBeNull();
  });
});

describe("another business cannot reach any of it (row-level security)", () => {
  it("cannot read, change, approve or confirm this brand's brief or posts", async () => {
    const { brief, posts } = await designed(copy());
    const mine = { userId: other.userId, brandId: other.brandId };

    // As the other brand's owner, with their own brand id: nothing is found.
    expect(await listBriefPosts(other.userId, other.brandId, brief.id, { slides: true })).toEqual([]);
    expect(await getPost(other.userId, other.brandId, posts[0].id)).toBeNull();
    expect(await loadReviewData(other.userId, other.brandId, brief.id)).toBeNull();
    await expect(ensureDraftPosts({ ...mine, briefId: brief.id }, deps())).rejects.toMatchObject({ code: "brief_not_found" });
    expect(await approveCreatePost({ ...mine, postId: posts[0].id })).toMatchObject({ ok: false, code: "not_found" });
    expect(await confirmPostFlag({ ...mine, postId: posts[0].id, flagId: "x" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await removePostFlag({ ...mine, postId: posts[0].id, flagId: "x" }, deps())).toMatchObject({ ok: false, code: "not_found" });
    expect(await undoCreateApproval({ ...mine, postId: posts[0].id })).toMatchObject({ ok: false, code: "not_found" });
    expect(await logCreateShare({ ...mine, postId: posts[0].id, kind: "share" })).toMatchObject({ ok: false, code: "not_found" });

    // With this brand's id: not a member.
    await expect(listBriefPosts(other.userId, b.brandId, brief.id)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(loadReviewData(other.userId, b.brandId, brief.id)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(ensureDraftPosts({ userId: other.userId, brandId: b.brandId, briefId: brief.id }, deps())).rejects.toBeInstanceOf(BrandAccessError);
    await expect(approveCreatePost({ userId: other.userId, brandId: b.brandId, postId: posts[0].id })).rejects.toBeInstanceOf(BrandAccessError);

    // And the database itself shows them nothing.
    const seen = await db.withUser(other.userId, (tx) => tx.query("select id from public.posts where brief_id = $1", [brief.id]));
    expect(seen).toEqual([]);
    const images = await db.withUser(other.userId, (tx) => tx.query("select 1 from public.post_images where post_id = $1", [posts[0].id]));
    expect(images).toEqual([]);
    expect((await getPost(b.userId, b.brandId, posts[0].id))?.status).toBe("draft");
  });
});
