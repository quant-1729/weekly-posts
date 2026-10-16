import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));

import { saveCaptionAction, undoAllAction } from "@/app/(app)/create/[briefId]/actions";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { getBrief } from "@/lib/briefs/service";
import { approveCreatePost, chooseDesign, confirmPostFlag, getPost, listBriefPosts, resetToBase, saveCopy } from "@/lib/create";
import { loadDesignPage, type DesignPageData } from "@/lib/create/view";
import type { StoredDesign } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, openDb } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery, uniq } from "./helpers";

let db: MockDb;
let b: Bakery;

const copy = (over: Partial<PostCopy> = {}): PostCopy => {
  const t = uniq();
  return {
    headline: "Cakes from £2.50",
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

/** A brief with its copy written and the first design chosen. */
async function designed(c: PostCopy = copy(), patch: Record<string, unknown> = {}) {
  const brief = await readyBrief(b, { channels: ["instagram", "facebook"], ...patch });
  const page = (await loadDesignPage(args(brief.id), deps(c))) as DesignPageData;
  const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps(c));
  return { brief, page, posts: out.posts };
}

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});
beforeEach(() => {
  session.user = { id: b.userId };
});

describe("Undo all", () => {
  it("stores the first generated words and the first design as the base, once", async () => {
    const c = copy();
    const { brief, page, posts } = await designed(c);
    const [row] = await rows<{ original: { caption: string; flags: unknown[]; design: { option: unknown; options: unknown[] } } }>("select original from public.posts where id = $1", [posts[0].id]);
    expect(row.original.caption).toBe(posts[0].caption);
    expect(Array.isArray(row.original.flags)).toBe(true);
    expect(row.original.design.option).toEqual(page.options[0].option);
    // Choosing another design later does not replace the base.
    await chooseDesign({ ...args(brief.id), option: page.options[1].option }, deps(c));
    const [again] = await rows<{ original: { design: { option: unknown } } }>("select original from public.posts where id = $1", [posts[0].id]);
    expect(again.original.design.option).toEqual(page.options[0].option);
  });

  it("puts every edit, flag decision, design change and approval back to the base; the brief stays", async () => {
    const c = copy();
    const { brief, page, posts } = await designed(c);
    const base = posts[0];
    const baseOption = (base.design as StoredDesign).option;
    const headlineFlag = base.flags.find((f) => f.status === "open" && f.field === "image_text.headline")!;
    expect(headlineFlag).toBeTruthy();

    // The owner confirms the flag, rewrites the words and caption, picks the second design and approves.
    expect(await confirmPostFlag({ ...b, postId: base.id, flagId: headlineFlag.id })).toEqual({ ok: true });
    const edited = await saveCopy({ ...args(brief.id), edit: { headline: "Fresh cakes daily", captions: { instagram: "My own caption for Instagram" }, hashtagsByChannel: { instagram: "#mine" } } }, deps(c));
    expect(edited.ok).toBe(true);
    await chooseDesign({ ...args(brief.id), option: page.options[1].option }, deps(c));
    for (const p of await listBriefPosts(b.userId, b.brandId, brief.id)) expect(await approveCreatePost({ ...b, postId: p.id })).toMatchObject({ ok: true });
    const mid = (await getPost(b.userId, b.brandId, base.id))!;
    expect(mid).toMatchObject({ status: "approved", caption: "My own caption for Instagram", hashtags: ["#mine"] });
    expect((mid.design as StoredDesign).option).toEqual(page.options[1].option);
    expect(page.options[1].option).not.toEqual(baseOption); // the design really was changed

    const r = await resetToBase(args(brief.id), deps(c));
    expect(r).toEqual({ ok: true, redrawn: true });

    const after = await listBriefPosts(b.userId, b.brandId, brief.id);
    expect(after).toHaveLength(2);
    for (const p of after) {
      const was = posts.find((x) => x.id === p.id)!;
      expect(p).toMatchObject({ status: "draft", approvedAt: null, editedAt: null, caption: was.caption, hashtags: was.hashtags, cta: was.cta });
      expect(p.imageText.headline).toBe("Cakes from £2.50");
      expect((p.design as StoredDesign).option).toEqual(baseOption);
      expect((p.design as StoredDesign).content.headline).toBe("Cakes from £2.50");
      expect(p.flags).toEqual(was.flags); // the decision is gone: the headline flag is open again
    }
    expect(after[0].flags.find((f) => f.id === headlineFlag.id)?.status).toBe("open");
    const images = await rows<{ n: number }>("select count(*)::int as n from public.post_images where post_id = $1", [base.id]);
    expect(images[0].n).toBeGreaterThan(0);
    expect(await getBrief(b.userId, b.brandId, brief.id)).toMatchObject({ id: brief.id, status: "ready" });
    // Approval is withdrawn: it can not be approved while the flag is open.
    expect(await approveCreatePost({ ...b, postId: base.id })).toMatchObject({ ok: false, code: "blocked" });
    const log = await rows<{ action: string; detail: { from?: string } }>("select action::text as action, detail from public.post_actions where post_id = $1 and action = 'undo'", [base.id]);
    expect(log.some((l) => l.detail.from === "all")).toBe(true);
  });

  it("takes the post out of the queue", async () => {
    const { brief, posts } = await designed(copy({ headline: "Cake week is here" }));
    await approveCreatePost({ ...b, postId: posts[0].id });
    await rows(
      `insert into public.queue_items (brand_id, post_id, channel, slot_at, status, mode) values ($1, $2, 'instagram', now() + interval '2 days', 'scheduled', 'deliver')`,
      [b.brandId, posts[0].id],
    );
    expect((await rows("select 1 from public.queue_items where post_id = $1", [posts[0].id])).length).toBe(1);
    expect(await resetToBase(args(brief.id), deps())).toMatchObject({ ok: true });
    expect(await rows("select 1 from public.queue_items where post_id = $1", [posts[0].id])).toEqual([]);
  });

  it("refuses when a post has already been posted", async () => {
    const { brief, posts } = await designed(copy({ headline: "Cake week is here" }));
    await rows("update public.posts set status = 'posted' where id = $1", [posts[0].id]);
    expect(await resetToBase(args(brief.id), deps())).toMatchObject({ ok: false, code: "posted" });
    expect((await getPost(b.userId, b.brandId, posts[0].id))?.status).toBe("posted");
  });

  it("works for a post made before the base was stored: the generated words come back and the current design stays", async () => {
    const { brief, page, posts } = await designed(copy());
    await rows("update public.posts set original = original - 'design' - 'flags' where brief_id = $1", [brief.id]);
    await saveCopy({ ...args(brief.id), edit: { captions: { instagram: "Changed after the fact" } } }, deps());
    await chooseDesign({ ...args(brief.id), option: page.options[1].option }, deps());
    expect(await resetToBase(args(brief.id), deps())).toEqual({ ok: true, redrawn: true });
    const p = (await getPost(b.userId, b.brandId, posts[0].id))!;
    expect(p.caption).toBe(posts[0].caption);
    expect((p.design as StoredDesign).option).toEqual(page.options[1].option);
    expect(p.flags.some((f) => f.status === "open" && f.field === "image_text.headline")).toBe(true); // checked again
  });

  it("is also an action for the signed-in owner, answering with the new review data", async () => {
    const { brief, posts } = await designed(copy({ headline: "Cake week is here" }));
    await approveCreatePost({ ...b, postId: posts[0].id });
    const r = await undoAllAction(brief.id);
    expect(r).toMatchObject({ ok: true, message: "Back to the first version. It needs your approval again." });
    expect(r.view?.posts.map((p) => p.status)).toEqual(["draft", "draft"]);
    session.user = null;
    expect(await undoAllAction(brief.id)).toMatchObject({ ok: false });
  });
});

describe("saving a caption in the review step", () => {
  it("changes only that channel; the other channel's approval and every picture stay", async () => {
    const c = copy({ headline: "Cake week is here" });
    const { brief, posts } = await designed(c);
    for (const p of posts) expect(await approveCreatePost({ ...b, postId: p.id })).toMatchObject({ ok: true });
    const r = await saveCaptionAction(brief.id, "facebook", "A new Facebook caption about our cakes.", "#fresh #cakes");
    expect(r).toMatchObject({ ok: true });
    const [ig, fb] = await listBriefPosts(b.userId, b.brandId, brief.id);
    expect(ig).toMatchObject({ status: "approved", caption: posts[0].caption });
    expect(fb).toMatchObject({ status: "draft", caption: "A new Facebook caption about our cakes.", hashtags: ["#fresh", "#cakes"] });
    expect(fb.design).not.toBeNull(); // a caption is not on the picture: no new design needed
    expect(fb.themeId).not.toBeNull();
    expect(r.ok && r.view.posts.map((p) => p.status)).toEqual(["approved", "draft"]);
  });

  it("checks the new words again: a price that is not in the brief is flagged", async () => {
    const { brief, posts } = await designed(copy({ headline: "Cake week is here" }));
    const r = await saveCaptionAction(brief.id, "instagram", "Everything only £0.99 today!", "");
    expect(r.ok).toBe(true);
    const ig = (await getPost(b.userId, b.brandId, posts[0].id))!;
    expect(ig.flags.some((f) => f.status === "open" && f.field === "caption" && f.text.includes("0.99"))).toBe(true);
    const view = r.ok ? r.view.posts[0] : null;
    expect(view?.canApprove).toBe(false);
  });

  it("explains a problem in words and keeps the old caption", async () => {
    const { brief, posts } = await designed(copy({ headline: "Cake week is here" }));
    expect(await saveCaptionAction(brief.id, "instagram", "   ", "")).toMatchObject({ ok: false, message: "The Instagram caption cannot be empty." });
    expect(await saveCaptionAction(brief.id, "instagram", "ok caption", "#a #b #c #d #e #f #g #h #i")).toMatchObject({ ok: false, message: expect.stringContaining("at most") });
    expect((await getPost(b.userId, b.brandId, posts[0].id))?.caption).toBe(posts[0].caption);
    session.user = null;
    expect(await saveCaptionAction(brief.id, "instagram", "x", "")).toMatchObject({ ok: false });
  });
});
