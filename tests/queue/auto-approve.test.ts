import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The server action calls getCurrentUser(); these tests drive the library, so only the module graph needs it.
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => null }));

import type { PostCopy } from "@/lib/ai/schemas-v3";
import { chooseDesign, getPost, loadDesignPage, type DesignPageData } from "@/lib/create";
import type { MockDb } from "@/lib/db/mock";
import { autoApproveBrief, saveQueueSettings } from "@/lib/queue";
import { closeDb, openDb } from "../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, uniq, type Bakery } from "../create/pipeline/helpers";
import { itemOf, postStatus } from "./helpers";

let db: MockDb;
let b: Bakery;

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
const deps = (c: PostCopy) => ({ copy: { fixture: c }, now: NOW });
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });

/** A brief with its copy and a chosen design: drafts, ready for the review step (or for auto-approve). */
async function designed(c: PostCopy) {
  const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
  const page = (await loadDesignPage(args(brief.id), deps(c))) as DesignPageData;
  const out = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps(c));
  return { brief, posts: out.posts };
}

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("auto-approve posts with no flags (S-4, C-28)", () => {
  it("is off by default: nothing is approved by itself", async () => {
    const { brief, posts } = await designed(copy());
    expect(posts.every((p) => p.flags.filter((f) => f.status === "open").length === 0)).toBe(true);
    const r = await autoApproveBrief({ ...args(brief.id), now: NOW });
    expect(r.approved).toEqual([]);
    expect(r.waiting.map((w) => w.reason)).toEqual(["off", "off"]);
    for (const p of posts) expect(await postStatus(db, p.id)).toBe("draft");
    expect(r.scheduled).toBeNull();
  });

  it("approves and queues a clean post on a channel that has it on; the other channel still waits for the owner", async () => {
    await saveQueueSettings(b.userId, b.brandId, { autoApprove: { instagram: true } });
    const { brief, posts } = await designed(copy());
    const r = await autoApproveBrief({ ...args(brief.id), now: NOW });
    const ig = posts.find((p) => p.channel === "instagram")!;
    const fb = posts.find((p) => p.channel === "facebook")!;
    expect(r.approved).toEqual([ig.id]);
    expect(r.waiting).toEqual([{ postId: fb.id, channel: "facebook", reason: "off" }]);
    expect(await postStatus(db, ig.id)).toBe("approved");
    expect(await postStatus(db, fb.id)).toBe("draft");
    expect((await getPost(b.userId, b.brandId, ig.id))?.approvedAt).toBeTruthy();
    // And it is in the queue, in the next free slot (Thursday 15 Oct, 10:00 London time = 09:00 UTC).
    const item = await itemOf(db, ig.id);
    expect(item).toMatchObject({ status: "scheduled", channel: "instagram", mode: "deliver" });
    expect(new Date(item.slot_at).toISOString()).toBe("2026-10-15T09:00:00.000Z");
    expect(await itemOf(db, fb.id)).toBeNull();
    // A second call changes nothing.
    const again = await autoApproveBrief({ ...args(brief.id), now: NOW });
    expect(again.approved).toEqual([]);
    expect(again.scheduled).toBeNull();
  });

  it("a post with an open flag always waits for the owner, even on a channel with auto-approve on", async () => {
    await saveQueueSettings(b.userId, b.brandId, { autoApprove: { instagram: true, facebook: true } });
    const { brief, posts } = await designed(copy({ headline: "Cakes from £2.50" })); // a price that is not in the brief
    expect(posts[0].flags.some((f) => f.status === "open")).toBe(true);
    const r = await autoApproveBrief({ ...args(brief.id), now: NOW });
    expect(r.approved).toEqual([]);
    expect(r.waiting.map((w) => w.reason)).toEqual(["flags", "flags"]);
    for (const p of posts) {
      expect(await postStatus(db, p.id)).toBe("draft");
      expect(await itemOf(db, p.id)).toBeNull();
    }
  });
});
