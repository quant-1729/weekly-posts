import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/week",
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
// The client components call these server actions; rendering needs only that they exist.
vi.mock("@/app/(app)/week/queue-actions", () => ({
  moveItemAction: vi.fn(),
  postNowItemAction: vi.fn(),
  postNowReadyAction: vi.fn(),
  saveQueueSettingsAction: vi.fn(),
  scheduleReadyAction: vi.fn(),
  skipItemAction: vi.fn(),
  slotOptionsAction: vi.fn(),
  unscheduleItemAction: vi.fn(),
  refreshQueueAction: vi.fn(),
}));
vi.mock("@/app/(app)/create/[briefId]/actions", () => ({
  confirmScheduleAction: vi.fn(),
  postNowBriefAction: vi.fn(),
  slotOptionsForPostAction: vi.fn(),
  logShareAction: vi.fn(),
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
}));

import QueuePage from "@/app/(app)/week/page";
import SchedulePage from "@/app/(app)/create/[briefId]/schedule/page";
import { QueueScreen } from "@/components/queue/queue-screen";
import type { MockDb } from "@/lib/db/mock";
import { scheduleApproved, loadQueueView, saveQueueSettings } from "@/lib/queue";
import { closeDb, openDb } from "../helpers/details";
import { NOW, connect, makeShop, rows, seedApproved, seedItem, type Shop } from "./helpers";

let db: MockDb;
let shop: Shop;
let other: Shop;

const html = (el: ReactNode) => renderToString(el);
const params = (briefId: string) => ({ params: Promise.resolve({ briefId }) }) as never;

beforeAll(async () => {
  db = await openDb();
  shop = await makeShop(db);
  other = await makeShop(db, { name: "Other Shop" });
});
afterAll(async () => {
  await closeDb(db);
});
afterEach(() => vi.useRealTimers());

const atNow = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
};

describe("the Queue page (/week)", () => {
  it("sends a signed-out visitor to sign in, and an unfinished setup to /setup", async () => {
    session.user = null;
    await expect(QueuePage()).rejects.toThrow("REDIRECT /login");
    await rows(db, "update public.brand_memory set setup_completed_at = null where brand_id = $1", [other.brandId]);
    session.user = { id: other.userId };
    await expect(QueuePage()).rejects.toThrow("REDIRECT /setup");
    await rows(db, "update public.brand_memory set setup_completed_at = now() where brand_id = $1", [other.brandId]);
  });

  it("an empty queue says what to do and still shows the settings and the weekly suggestions", async () => {
    session.user = { id: other.userId };
    atNow();
    const out = html(await QueuePage());
    expect(out).toContain("<h1");
    expect(out).toMatch(/<h1[^>]*>Queue<\/h1>/);
    expect(out).toContain("Coming up");
    expect(out).toContain("Nothing is scheduled yet");
    expect(out).toContain("Ready to schedule");
    expect(out).toContain("Queue settings");
    expect(out).toContain("Posts per week");
    expect(out).toContain("Auto-approve posts with no flags");
    expect(out).toContain("Posts with a &quot;Please check&quot; flag always wait for you"); // the plain warning
    expect(out).toContain("Email me posts I share myself");
    expect(out).toContain("Pause the queue");
    expect(out).toContain("This week"); // the v2 weekly suggestions section
    expect(out).toContain("Generate this week");
    expect(out).toContain("data-create-button");
    expect(out).not.toContain("data-queue-attention");
  });

  it("lists upcoming items by day with channel, time, mode badge and actions; missed items under 'Needs your attention'; ready posts with a Schedule button", async () => {
    session.user = { id: shop.userId };
    atNow();
    await connect(db, shop, "instagram");
    const a = await seedApproved(db, shop, ["instagram", "whatsapp"], { endsOn: "2026-10-31" });
    await scheduleApproved({ userId: shop.userId, brandId: shop.brandId, briefId: a.briefId, now: NOW });
    const missed = await seedApproved(db, shop, ["facebook"]);
    await seedItem(db, shop, missed.posts[0], { slotAt: "2026-10-12T09:00:00Z", status: "missed" });
    await seedApproved(db, shop, ["gbp"]); // approved, not queued

    const out = html(await QueuePage());
    expect(out).toContain("data-queue-upcoming");
    expect(out).toContain('data-day="2026-10-15"');
    expect(out).toContain("Thu 15 Oct");
    expect(out).toContain("Thu 15 Oct, 10:00");
    expect(out).toMatch(/data-mode="publish"[^>]*data-channel="instagram"/);
    expect(out).toMatch(/data-mode="deliver"[^>]*data-channel="whatsapp"/);
    expect(out).toContain("Auto-publish");
    expect(out).toContain("We&#x27;ll email it to you");
    expect(out).toContain("Scheduled");
    for (const action of ["Move", "Post now", "Skip", "Take out of the queue"]) expect(out).toContain(action);

    expect(out).toContain("data-queue-attention");
    expect(out).toContain("Needs your attention");
    expect(out).toContain("Its time passed before it was sent.");
    expect(out).toContain("Skip, post now, or move");
    expect(out).toMatch(/data-status="missed"/);

    expect(out).toContain("data-queue-ready");
    expect(out).toMatch(/<button[^>]*data-tween-target="schedule"[^>]*>Schedule<\/button>/);
    expect(out).toContain("Pick a time");
    expect((out.match(/data-tween-target="schedule"/g) ?? []).length).toBe(1);
    // The queue is phone-friendly: cards stack, and go two across from wide screens.
    expect(out).toContain("lg:grid-cols-2");
  });

  it("shows the pause banner and the saved settings", async () => {
    session.user = { id: shop.userId };
    atNow();
    await saveQueueSettings(shop.userId, shop.brandId, { paused: true, postsPerWeek: 5, times: { instagram: "08:30" } });
    const out = html(await QueuePage());
    expect(out).toContain("data-queue-paused");
    expect(out).toContain("The queue is paused");
    expect(out).toContain('value="08:30"');
    await saveQueueSettings(shop.userId, shop.brandId, { paused: false, postsPerWeek: 3, times: {} });
  });

  it("the screen renders from a view alone (no server needed)", async () => {
    atNow();
    const view = await loadQueueView(shop.userId, shop.brandId, NOW);
    const out = html(createElement(QueueScreen, { initial: view }));
    expect(out).toContain("data-queue");
    expect(out).toContain("Instagram");
    expect(out).toContain("Connected: posts are published for you.");
    expect(out).toContain("Not connected: we email the post to you.");
  });
});

describe("the Schedule step of /create", () => {
  it("is protected like the other steps", async () => {
    const x = await seedApproved(db, shop, ["whatsapp"]);
    session.user = null;
    await expect(SchedulePage(params(x.briefId))).rejects.toThrow("REDIRECT /login");
    session.user = { id: other.userId };
    await expect(SchedulePage(params(x.briefId))).rejects.toThrow("NOT_FOUND");
  });

  it("says nothing is approved yet when nothing is", async () => {
    const x = await seedApproved(db, shop, ["whatsapp"]);
    await rows(db, "update public.posts set status = 'draft' where brief_id = $1", [x.briefId]);
    session.user = { id: shop.userId };
    atNow();
    const out = html(await SchedulePage(params(x.briefId)));
    expect(out).toMatch(/data-step="schedule"[^>]*data-state="current"/);
    expect(out).toContain("Nothing is approved yet");
    expect(out).toContain(`/create/${x.briefId}/review`);
    expect(out).not.toContain("data-confirm");
  });

  it("proposes a slot per channel with its mode, and offers Confirm, Post now and Pick another time", async () => {
    await connect(db, shop, "instagram");
    const x = await seedApproved(db, shop, ["instagram", "whatsapp"], { endsOn: "2026-12-31" });
    session.user = { id: shop.userId };
    atNow();
    const out = html(await SchedulePage(params(x.briefId)));
    expect(out).toContain("data-schedule-proposals");
    expect((out.match(/data-proposal="true"/g) ?? []).length).toBe(2);
    expect(out).toMatch(/Instagram: \w{3} \d{1,2} \w{3}, 10:00 · We&#x27;ll publish it/);
    expect(out).toMatch(/WhatsApp: \w{3} \d{1,2} \w{3}, 10:00 · We&#x27;ll email it to you/);
    expect(out).toContain("data-confirm");
    expect(out).toContain("Confirm");
    expect(out).toContain("data-post-now");
    expect(out).toContain("Post now");
    expect(out).toContain("Pick another time");
    expect(out).toContain("Download or share a post yourself now");
  });

  it("with no slot before the offer ends it says so and still offers Post now", async () => {
    const x = await seedApproved(db, shop, ["whatsapp"], { endsOn: "2026-10-14" });
    session.user = { id: shop.userId };
    atNow();
    const out = html(await SchedulePage(params(x.briefId)));
    expect(out).toContain("data-no-slot");
    expect(out).toContain("there is no free time before this offer ends");
    expect(out).toContain("data-post-now");
    expect(out).not.toContain("data-confirm");
  });

  it("lists posts that are already in the queue as scheduled, with a link to the Queue", async () => {
    const x = await seedApproved(db, shop, ["whatsapp"], { endsOn: "2026-12-31" });
    await scheduleApproved({ userId: shop.userId, brandId: shop.brandId, briefId: x.briefId, now: NOW });
    session.user = { id: shop.userId };
    atNow();
    const out = html(await SchedulePage(params(x.briefId)));
    expect(out).toContain("data-scheduled");
    expect(out).toMatch(/WhatsApp: \w{3} \d{1,2} \w{3}, 10:00 · We&#x27;ll email it to you/);
    expect(out).toContain('href="/week"');
    expect(out).not.toContain("data-proposal");
  });
});
