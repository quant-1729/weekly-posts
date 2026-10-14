import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));

import {
  approveAllAction,
  approvePostAction,
  chooseDesignAction,
  confirmFlagAction,
  logShareAction,
  previewOptionAction,
  removeFlagAction,
  saveWordsAction,
  setBlockAction,
  setPhotoAction,
  undoApprovalAction,
} from "@/app/(app)/create/[briefId]/actions";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { getBrief } from "@/lib/briefs/service";
import { ensureDraftPosts, getPost, listBriefPosts, loadDesignPage, type DesignPageData } from "@/lib/create";
import type { MockDb } from "@/lib/db/mock";
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

describe("the design step's actions", () => {
  it("refuse a signed-out visitor", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    await ensureDraftPosts(args(brief.id), deps());
    session.user = null;
    expect(await saveWordsAction(brief.id, { headline: "x" })).toMatchObject({ ok: false });
    expect(await setPhotoAction(brief.id, null)).toMatchObject({ ok: false });
    expect(await setBlockAction(brief.id, "phone", false)).toMatchObject({ ok: false });
    expect(await chooseDesignAction(brief.id, { themeId: "clean", layoutId: "x", scheme: "light" })).toMatchObject({ ok: false });
    expect(await approvePostAction(brief.id, brief.id)).toMatchObject({ ok: false });
    expect(await logShareAction(brief.id, "share")).toEqual({ ok: false });
  });

  it("show or hide a line writes back to the brief", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"], blocks: { phone: true, website: true, dates: true } });
    expect(await setBlockAction(brief.id, "phone", false)).toEqual({ ok: true });
    expect((await getBrief(b.userId, b.brandId, brief.id))?.blocks).toMatchObject({ phone: false, website: true });
    expect(await setBlockAction(brief.id, "address", true)).toEqual({ ok: true });
    expect((await getBrief(b.userId, b.brandId, brief.id))?.blocks).toMatchObject({ address: true });
    expect(await setBlockAction(brief.id, "not-a-block", true)).toMatchObject({ ok: false });
    // The brief stays ready.
    expect((await getBrief(b.userId, b.brandId, brief.id))?.status).toBe("ready");
  });

  it("change photo writes back to the brief and 'no photo' clears it; a photo of another business is refused", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    expect(await setPhotoAction(brief.id, b.photoId)).toEqual({ ok: true });
    expect((await getBrief(b.userId, b.brandId, brief.id))?.photoId).toBe(b.photoId);
    expect(await setPhotoAction(brief.id, null)).toEqual({ ok: true });
    expect((await getBrief(b.userId, b.brandId, brief.id))?.photoId).toBeNull();
    const foreign = (await db.withAdmin((tx) => tx.query<{ id: string }>("insert into public.photos (brand_id, storage_path) values ($1, 'photos/x.jpg') returning id", [other.brandId])))[0].id;
    expect(await setPhotoAction(brief.id, foreign)).toMatchObject({ ok: false });
    expect(await setPhotoAction(brief.id, "not-a-uuid")).toMatchObject({ ok: false });
    expect((await getBrief(b.userId, b.brandId, brief.id))?.photoId).toBeNull();
  });

  it("changing the photo or a line after a design was used clears the design; the options change with the photo", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    expect(await chooseDesignAction(brief.id, page.options[0].option)).toEqual({ ok: true });
    expect((await listBriefPosts(b.userId, b.brandId, brief.id))[0].themeId).not.toBeNull();
    expect(await setPhotoAction(brief.id, b.photoId)).toEqual({ ok: true });
    expect((await listBriefPosts(b.userId, b.brandId, brief.id))[0]).toMatchObject({ themeId: null, design: null });
    const again = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    expect(again.photoId).toBe(b.photoId);
    expect(again.options.map((o) => o.option.layoutId)).not.toEqual(page.options.map((o) => o.option.layoutId));
  });

  it("preview gives another picture for another layout, and refuses an option that does not exist", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const o = page.options[0];
    const next = o.layouts.find((l) => l.id !== o.used.layoutId)!;
    const r = await previewOptionAction(brief.id, { ...o.option, layoutId: next.id });
    expect(r.ok && r.view.src).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.ok && r.view.src).not.toBe(o.src);
    expect(r.ok && r.view.used.layoutId).toBe(next.id);
    expect(await chooseDesignAction(brief.id, { ...o.option, layoutId: "nope" })).toMatchObject({ ok: false });
  });

  it("save words checks them again and reports problems in plain words", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    await ensureDraftPosts(args(brief.id), deps());
    const bad = await saveWordsAction(brief.id, { headline: "one two three four five six seven eight", captions: { instagram: "" } });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.ok === false && bad.errors).toEqual(["The headline can have up to 7 words.", "The Instagram caption cannot be empty."]);
    const ok = await saveWordsAction(brief.id, { headline: "Cakes from £2.50" });
    expect(ok).toEqual({ ok: true, changed: true, message: "Saved. We checked the words again." });
    const post = (await listBriefPosts(b.userId, b.brandId, brief.id))[0];
    expect(post.flags.some((f) => f.status === "open" && f.text.includes("2.50"))).toBe(true);
    expect(await saveWordsAction(brief.id, { headline: "Cakes from £2.50" })).toMatchObject({ ok: true, changed: false });
  });
});

describe("the review step's actions", () => {
  it("confirm a flag, approve, share log and undo, each returning the new review data", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    const page = (await loadDesignPage(args(brief.id), deps(copy({ headline: "Cakes from £2.50" })))) as DesignPageData;
    await chooseDesignAction(brief.id, page.options[0].option);
    const posts = await listBriefPosts(b.userId, b.brandId, brief.id);
    const flag = posts[0].flags.find((f) => f.status === "open")!;

    const blocked = await approvePostAction(brief.id, posts[0].id);
    expect(blocked).toMatchObject({ ok: false, message: "Please check the items marked above before approving." });
    expect(blocked.view?.posts[0].openFlags.length).toBeGreaterThan(0);

    const confirmed = await confirmFlagAction(brief.id, posts[0].id, flag.id, false);
    expect(confirmed).toMatchObject({ ok: true, message: "Marked as true." });
    expect(confirmed.ok && confirmed.view.posts.map((p) => p.openFlags.length)).toEqual([0, 0]);

    expect(await logShareAction(posts[0].id, "download", "square")).toEqual({ ok: false }); // not approved yet
    const all = await approveAllAction(brief.id);
    expect(all.ok && all.view.allApproved).toBe(true);
    expect(await logShareAction(posts[0].id, "download", "square")).toEqual({ ok: true });

    const undone = await undoApprovalAction(brief.id, posts[0].id);
    expect(undone.ok && undone.view.posts.map((p) => p.status)).toEqual(["draft", "approved"]);
  });

  it("remove a flag", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps(copy({ captions: [{ channel: "instagram", text: "Only £3.99 for 20% off cakes." }] })))) as DesignPageData;
    await chooseDesignAction(brief.id, page.options[0].option);
    const [post] = await listBriefPosts(b.userId, b.brandId, brief.id);
    const flag = post.flags.find((f) => f.status === "open")!;
    const r = await removeFlagAction(brief.id, post.id, flag.id);
    expect(r).toMatchObject({ ok: true, message: "Removed from the post." });
    expect((await getPost(b.userId, b.brandId, post.id))?.caption).not.toContain("3.99");
  });

  it("another business's owner changes nothing, whatever ids they send", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    await chooseDesignAction(brief.id, page.options[0].option);
    const [post] = await listBriefPosts(b.userId, b.brandId, brief.id);
    session.user = { id: other.userId };
    expect(await approvePostAction(brief.id, post.id)).toMatchObject({ ok: false });
    expect(await confirmFlagAction(brief.id, post.id, "x", false)).toMatchObject({ ok: false });
    expect(await removeFlagAction(brief.id, post.id, "x")).toMatchObject({ ok: false });
    expect(await approveAllAction(brief.id)).toMatchObject({ ok: false });
    expect(await undoApprovalAction(brief.id, post.id)).toMatchObject({ ok: false });
    expect(await setBlockAction(brief.id, "phone", false)).toMatchObject({ ok: false });
    expect(await setPhotoAction(brief.id, null)).toMatchObject({ ok: false });
    expect(await saveWordsAction(brief.id, { headline: "Hijacked" })).toMatchObject({ ok: false });
    expect(await chooseDesignAction(brief.id, page.options[1].option)).toMatchObject({ ok: false });
    expect(await previewOptionAction(brief.id, page.options[1].option)).toMatchObject({ ok: false });
    session.user = { id: b.userId };
    const after = (await getPost(b.userId, b.brandId, post.id))!;
    expect(after.status).toBe("draft");
    expect(after.imageText.headline).toBe("Cake week is here");
    expect(after.design?.option).toEqual(page.options[0].option);
  });
});
