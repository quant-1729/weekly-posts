import { createElement, isValidElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/create",
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
// The client components call the server actions; rendering needs only that they exist.
vi.mock("@/app/(app)/create/[briefId]/actions", () => ({
  previewOptionAction: vi.fn(),
  saveWordsAction: vi.fn(),
  setBlockAction: vi.fn(),
  setPhotoAction: vi.fn(),
  chooseDesignAction: vi.fn(),
  confirmFlagAction: vi.fn(),
  removeFlagAction: vi.fn(),
  approvePostAction: vi.fn(),
  approveAllAction: vi.fn(),
  undoApprovalAction: vi.fn(),
  logShareAction: vi.fn(),
  confirmScheduleAction: vi.fn(),
  postNowBriefAction: vi.fn(),
  slotOptionsForPostAction: vi.fn(),
}));

import DesignPage from "@/app/(app)/create/[briefId]/design/page";
import ReviewPage from "@/app/(app)/create/[briefId]/review/page";
import SchedulePage from "@/app/(app)/create/[briefId]/schedule/page";
import { DesignBody, DesignLoading } from "@/components/create/design-body";
import { approveCreatePost, chooseDesign, ensureDraftPosts, loadDesignPage, type DesignPageData } from "@/lib/create";
import type { PostCopy } from "@/lib/ai/schemas-v3";
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
    subline: "Fresh every morning",
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
const params = (briefId: string) => ({ params: Promise.resolve({ briefId }) }) as never;
const html = (el: ReactNode) => renderToString(el);

/** Finds the first element of this component type in a tree (server components can not be rendered by renderToString). */
function find(node: ReactNode, type: unknown): { props: Record<string, unknown> } | null {
  if (!isValidElement(node)) return Array.isArray(node) ? node.map((n) => find(n, type)).find(Boolean) ?? null : null;
  if (node.type === type) return node as never;
  return find((node.props as { children?: ReactNode }).children, type);
}

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  other = await makeOwner(db, { name: "Other Shop", country: "GB" });
  // Both owners finished setup (the pages send everyone else to /setup).
  await db.withAdmin((tx) => tx.query("update public.brand_memory set setup_completed_at = now()"));
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("access", () => {
  it("signed-out visitors go to the sign-in page; another business's brief is not found", async () => {
    const brief = await readyBrief(b, { channels: ["instagram"] });
    session.user = null;
    for (const Page of [DesignPage, ReviewPage, SchedulePage]) await expect(Page(params(brief.id))).rejects.toThrow("REDIRECT /login");
    session.user = { id: other.userId };
    for (const Page of [DesignPage, ReviewPage, SchedulePage]) await expect(Page(params(brief.id))).rejects.toThrow("NOT_FOUND");
    session.user = { id: b.userId };
    for (const Page of [DesignPage, ReviewPage, SchedulePage]) expect(await Page(params(brief.id))).toBeTruthy();
  });
});

describe("design page", () => {
  it("shows the steps with Design current and loads the body while the words are written", async () => {
    session.user = { id: b.userId };
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const el = await DesignPage(params(brief.id));
    const out = html(el.props.children[1]); // the step bar
    expect(out).toMatch(/data-step="design"[^>]*data-state="current"/);
    const body = find(el, DesignBody);
    expect(body?.props).toEqual({ userId: b.userId, brandId: b.brandId, briefId: brief.id });
    expect(html(createElement(DesignLoading))).toContain("Writing your post...");
  });

  it("shows 3 options with their reports, the quick edits, the words and 'Use this design'", async () => {
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"], secondaryUspIds: [b.usps.delivery.id, b.usps.free.id], photoId: b.photoId });
    // The words are cached first, as the first visit would have done.
    await ensureDraftPosts(args(brief.id), deps());
    const out = html(await DesignBody(args(brief.id)));
    expect((out.match(/data-option="\d"/g) ?? []).length).toBe(3);
    expect(out).toContain("Option 1");
    expect(out).toContain("Option 3");
    expect(out).toMatch(/data:image\/jpeg;base64,/);
    expect(out).toContain("Use this design");
    expect(out).toContain("Quick edits");
    expect(out).toContain("Previous layout");
    expect(out).toContain("Next layout");
    expect(out).toContain("Brand colour");
    expect(out).toContain("No photo (design only)");
    expect(out).toContain("Show on the post");
    for (const blk of ["phone", "website", "address"]) expect(out).toContain(`data-block="${blk}"`);
    expect(out).toContain("+44 20 7946 0958");
    expect(out).toContain("Headline (up to 7 words)");
    expect(out).toContain("Cake week is here");
    expect(out).toContain("Caption for Instagram");
    expect(out).toContain("Caption for Facebook");
    expect(out).toContain("Save and check");
    expect(out).toContain("Nothing to check. Every figure and claim comes from your details.");
    expect(out).toContain("We will draw: square (1080 x 1080), portrait (1080 x 1350)");
    // Each option says whether everything fits or what had no room.
    expect((out.match(/Everything fits\.|No room for:|Not shown on this size:/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("lists the flags as 'Please check' and offers the carousel when the points do not fit one picture", async () => {
    const brief = await readyBrief(b, { channels: ["youtube"], secondaryUspIds: [b.usps.delivery.id, b.usps.free.id] });
    await ensureDraftPosts(args(brief.id), deps(copy({ headline: "Cakes from £2.50", captions: [{ channel: "youtube", text: "20% off cakes" }] })));
    const out = html(await DesignBody(args(brief.id)));
    expect(out).toContain("Please check");
    expect(out).toContain("£2.50");
    expect(out).toContain("one point per slide");
    expect(out).toContain("YouTube thumbnail (1280 x 720)");
  });

  it("says why it can not go on: a brief that is not ready, a payment ID that is not confirmed", async () => {
    session.user = { id: b.userId };
    const draft = await (await import("@/lib/briefs/service")).createBrief(b.userId, b.brandId, { postType: "brand", cta: "visit", channels: ["instagram"] }, { now: NOW });
    expect(html(await DesignBody(args(draft.id)))).toContain("This brief is not ready yet");
    const pay = await readyBrief(b, { channels: ["instagram"], qr: { kind: "payment", paymentId: b.paymentId } });
    await db.withAdmin((tx) => tx.query("update public.payment_ids set status = 'retired' where id = $1", [b.paymentId]));
    try {
      const out = html(await DesignBody(args(pay.id)));
      expect(out).toContain("your payment ID is not confirmed");
      expect(out).toContain("Back to the details");
    } finally {
      await db.withAdmin((tx) => tx.query("update public.payment_ids set status = 'active' where id = $1", [b.paymentId]));
    }
  });
});

describe("review page", () => {
  it("before a design is chosen it sends the owner to the design", async () => {
    session.user = { id: b.userId };
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const out = html(await ReviewPage(params(brief.id)));
    expect(out).toContain("There are no posts to review yet");
    expect(out).toContain(`/create/${brief.id}/design`);
    expect(out).toMatch(/data-step="review"[^>]*data-state="current"/);
  });

  it("shows each channel's post with all its sizes, the caption, the flags to confirm or remove, and a blocked Approve", async () => {
    session.user = { id: b.userId };
    const brief = await readyBrief(b, { channels: ["instagram", "facebook", "whatsapp"] });
    const page = (await loadDesignPage(args(brief.id), deps(copy({ headline: "Cakes from £2.50", captions: [{ channel: "instagram", text: "Only £3.99!" }, { channel: "facebook", text: "20% off cakes" }, { channel: "whatsapp", text: "20% off cakes" }] })))) as DesignPageData;
    await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    const out = html(await ReviewPage(params(brief.id)));
    expect((out.match(/data-channel="/g) ?? []).length).toBe(3);
    expect(out).toContain("Instagram post");
    expect(out).toContain("WhatsApp post");
    expect((out.match(/data-format="/g) ?? []).length).toBe(4); // instagram: square + portrait, facebook: square, whatsapp: story
    expect(out).toContain(`/api/files/renders/${b.brandId}/`);
    expect(out).toContain("Only £3.99!");
    expect(out).toContain("Please check");
    expect(out).toContain("This is true");
    expect(out).toContain(">Remove<");
    expect(out).toMatch(/<button[^>]*data-approve[^>]*disabled=""/);
    expect(out).toContain("You can approve once you have answered every item above.");
    expect(out).toContain("Next: Schedule");
    expect(out).not.toContain("Share this post");
  });

  it("an approved post shows Download for each size, Copy caption and Undo approval", async () => {
    session.user = { id: b.userId };
    const brief = await readyBrief(b, { channels: ["instagram"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const out0 = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());
    const tag = /<button[^>]*data-approve[^>]*>/.exec(html(await ReviewPage(params(brief.id))))?.[0] ?? "";
    expect(tag).not.toBe("");
    expect(tag).not.toContain('disabled=""');
    await approveCreatePost({ userId: b.userId, brandId: b.brandId, postId: out0.posts[0].id });
    const out = html(await ReviewPage(params(brief.id)));
    expect(out).toContain("Share this post");
    expect(out).toContain("Download square");
    expect(out).toContain("Download portrait");
    expect(out).toContain("Copy caption");
    expect(out).toContain("Undo approval");
    expect(out).toContain("Approved");
    expect(out).not.toContain("data-approve");
  });
});

describe("schedule page", () => {
  it("nothing approved yet; then the proposed slot for the approved post (the queue itself is tested in tests/queue) and the share kit", async () => {
    session.user = { id: b.userId };
    const brief = await readyBrief(b, { channels: ["instagram", "facebook"] });
    const page = (await loadDesignPage(args(brief.id), deps())) as DesignPageData;
    const designed = await chooseDesign({ ...args(brief.id), option: page.options[0].option }, deps());

    let out = html(await SchedulePage(params(brief.id)));
    expect(out).toMatch(/data-step="schedule"[^>]*data-state="current"/);
    expect(out).toContain("Nothing is approved yet");
    expect(out).toContain(`/create/${brief.id}/review`);
    expect(out).not.toContain("data-schedule-note");

    await approveCreatePost({ userId: b.userId, brandId: b.brandId, postId: designed.posts[1].id });
    out = html(await SchedulePage(params(brief.id)));
    expect(out).toContain("Here is when each post goes out. Nothing is posted until you confirm.");
    expect(out).toMatch(/Facebook: \w{3} \d{1,2} \w{3}, \d\d:\d\d · We&#x27;ll email it to you/);
    expect(out).toContain("Instagram is waiting for your approval.");
    expect(out).toContain("Facebook post");
    expect(out).not.toContain("Instagram post"); // only the approved one
    expect(out).toContain("Download square");
    expect(out).toContain("Copy caption");
  });
});
