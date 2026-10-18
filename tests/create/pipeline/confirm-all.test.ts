import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));

import { confirmAllFlagsAction, confirmFlagAction, undoAllAction } from "@/app/(app)/create/[briefId]/actions";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { ensureDraftPosts, listBriefPosts, loadDesignPage, type DesignPageData } from "@/lib/create";
import type { MockDb } from "@/lib/db/mock";
import type { Flag } from "@/lib/guardrail";
import { closeDb, makeOwner, openDb, type Owner } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery, uniq } from "./helpers";

let db: MockDb;
let b: Bakery;
let other: Owner;

const copy = (): PostCopy => {
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
  };
};
const deps = () => ({ copy: { fixture: copy() }, now: NOW });
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });

const flag = (over: Partial<Flag>): Flag => ({ id: "x", text: "x", kind: "claim", field: "caption", layer: "code", regulated: false, highlight: true, status: "open", decided_at: null, ...over });

/** Replaces the flags of every post of the brief (the same list on each channel, like the picture's words). */
async function seed(briefId: string, flags: Flag[]) {
  await db.withAdmin((tx) => tx.query("update public.posts set fact_flags = $2::jsonb where brief_id = $1 and carousel_id is null", [briefId, JSON.stringify(flags)]));
}

const open = async (briefId: string) => (await listBriefPosts(b.userId, b.brandId, briefId)).map((p) => p.flags.filter((f) => f.status === "open").map((f) => f.id).sort());

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

const FLAGS = [
  flag({ id: "price1", text: "£3.99", kind: "price" }),
  flag({ id: "slide1", text: "heals in a day", kind: "claim", field: "image_text.subline", slide: 1, regulated: true }),
  flag({ id: "repeat1", text: "cake week is here today", kind: "repeat" }),
  flag({ id: "head1", text: "Best in town", kind: "claim", field: "image_text.headline" }),
];

describe("These are all fine (the design step's confirm-all)", () => {
  it("confirms every open flag of every post through the review path: caption, slide, repeat and regulated ones", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    await ensureDraftPosts(args(brief.id), deps());
    await seed(brief.id, FLAGS);
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    expect(page.flags.map((f) => f.flag.id).sort()).toEqual(["head1", "price1", "repeat1", "slide1"]);

    // The regulated one cannot be confirmed one by one without the extra tick; the dialog's confirm counts as it.
    const [first] = await listBriefPosts(b.userId, b.brandId, brief.id);
    expect(await confirmFlagAction(brief.id, first.id, "slide1", false)).toMatchObject({ ok: false });

    const r = await confirmAllFlagsAction(brief.id);
    expect(r).toMatchObject({ ok: true, remaining: [] });
    expect(r.ok && r.confirmed).toBeGreaterThanOrEqual(4);
    expect(await open(brief.id)).toEqual([[], []]);
    const posts = await listBriefPosts(b.userId, b.brandId, brief.id);
    for (const p of posts) {
      expect(p.flags.map((f) => [f.id, f.status])).toEqual(FLAGS.map((f) => [f.id, "confirmed"]));
      expect(p.flags.every((f) => f.decided_at !== null)).toBe(true);
    }
    // The design page has no box left, and Review shows no open flags.
    expect(((await loadDesignPage(args(brief.id), deps())) as DesignPageData).flags).toEqual([]);
  });

  it("a word to avoid cannot be confirmed: it stays open and is reported", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    await ensureDraftPosts(args(brief.id), deps());
    await seed(brief.id, [flag({ id: "price1", kind: "price" }), flag({ id: "avoid1", text: "cheap", kind: "avoid" })]);
    const r = await confirmAllFlagsAction(brief.id);
    expect(r).toMatchObject({ ok: true, remaining: ["avoid1"] });
    expect(await open(brief.id)).toEqual([["avoid1"]]);
  });

  it("Undo all still works afterwards (it goes back to the first generated version)", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    await ensureDraftPosts(args(brief.id), deps());
    const posts = await listBriefPosts(b.userId, b.brandId, brief.id);
    await seed(brief.id, [flag({ id: "price1", kind: "price" })]);
    await confirmAllFlagsAction(brief.id);
    expect(await open(brief.id)).toEqual([[]]);
    const undone = await undoAllAction(brief.id);
    expect(undone.ok).toBe(true);
    expect(undone.ok && undone.view.posts.map((p) => p.id)).toEqual(posts.map((p) => p.id));
  });

  it("changes nothing for a signed-out visitor or another business's owner", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    await ensureDraftPosts(args(brief.id), deps());
    await seed(brief.id, FLAGS);
    session.user = null;
    expect(await confirmAllFlagsAction(brief.id)).toMatchObject({ ok: false });
    session.user = { id: other.userId };
    expect(await confirmAllFlagsAction(brief.id)).toMatchObject({ ok: false });
    expect(await confirmAllFlagsAction("not-a-uuid")).toMatchObject({ ok: false });
    session.user = { id: b.userId };
    expect(await open(brief.id)).toEqual([["head1", "price1", "repeat1", "slide1"], ["head1", "price1", "repeat1", "slide1"]]);
  });
});
