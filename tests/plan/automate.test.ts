// Plan a week, stage 3: partial scheduling (ready days go out, flagged days stay back and are never approved), the button
// labels, the per-day badges, and the success panel worked out from the stored queue (so it survives a reload).
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/plan/actions", () => ({ approveAndScheduleAction: vi.fn() }));
vi.mock("@/app/(app)/create/[briefId]/actions", () => ({ confirmFlagAction: vi.fn(), removeFlagAction: vi.fn(), confirmAllFlagsAction: vi.fn() }));

import { AutomatePanel } from "@/components/plan/automate";
import { DayFlags } from "@/components/plan/day-flags";
import { ScheduleSummary } from "@/components/plan/schedule-summary";
import { confirmPostFlag } from "@/lib/create";
import type { MockDb } from "@/lib/db/mock";
import { approveAndSchedulePlan, getPlan, planStatus } from "@/lib/plans/service";
import { allScheduled, approveButton, dayBadge, summarize, type DayLike, type PlanPostStatus } from "@/lib/plans/status";
import { closeDb, openDb } from "../helpers/details";
import { makeShop, rows, seedBrief, seedPost, type Shop } from "../queue/helpers";

let db: MockDb;
let shop: Shop;
let planId: string;
const posts: string[] = [];
const FLAG = { id: "price_1", text: "£3.99", kind: "price", field: "caption", layer: "code", regulated: false, highlight: true, status: "open", decided_at: null };

const isoDay = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const live = new Set<string>();

beforeAll(async () => {
  db = await openDb();
  shop = await makeShop(db);
  // Four days: 0 and 1 are ready, 2 and 3 have a line to check.
  const days = [];
  for (let i = 0; i < 4; i++) {
    const date = isoDay(3 + i);
    const briefId = await seedBrief(db, shop, { endsOn: isoDay(30) });
    const p = await seedPost(db, shop, briefId, "instagram", { status: "draft", caption: "Cake for £3.99 today" });
    if (i >= 2) await rows(db, "update public.posts set fact_flags = $2::jsonb where id = $1", [p.id, JSON.stringify([FLAG])]);
    posts.push(p.id);
    days.push({ date, weekday: "mon", label: label(date), offer: "10% OFF", offerNote: "", headline: "Special", briefId });
  }
  const [row] = await rows<{ id: string }>(
    db,
    `insert into public.post_plans (brand_id, created_by, title, days, settings, status) values ($1, $2, 'Weekly offers', $3::jsonb, $4::jsonb, 'designed') returning id::text as id`,
    [shop.brandId, shop.userId, JSON.stringify(days), JSON.stringify({ channels: ["instagram"], cta: null, time: "09:00", photoId: null, on: "cakes", timezone: shop.timezone })],
  );
  planId = row.id;
});
afterAll(() => closeDb(db));

const statusNow = async () => planStatus(shop.userId, shop.brandId, (await getPlan(shop.userId, shop.brandId, planId))!);
const post = (over: Partial<PlanPostStatus> = {}): PlanPostStatus => ({ id: randomUUID(), channel: "instagram", status: "draft", postStatus: "draft", queueStatus: null, canApprove: true, image: "/x.png", caption: "", flags: 0, openFlags: [], slot: null, mode: null, slotLabel: null, ...over });
const day = (list: PlanPostStatus[], date = "2026-10-19"): DayLike => ({ date, label: "Mon 19 Oct", posts: list });
const flagged = () => post({ openFlags: [FLAG as never], canApprove: false });

describe("button labels and badges (pure)", () => {
  it("names what the button will do", () => {
    expect(approveButton(summarize([day([post()]), day([post()]), day([post()])]))).toMatchObject({ label: "Approve and schedule the week", disabled: false });
    expect(approveButton(summarize([day([post()]), day([post()]), day([flagged()]), day([flagged()])]))).toMatchObject({ label: "Approve and schedule 2 ready days", disabled: false });
    expect(approveButton(summarize([day([post()]), day([flagged()])])).label).toBe("Approve and schedule 1 ready day");
    const none = approveButton(summarize([day([flagged()]), day([flagged()])]));
    expect(none.disabled).toBe(true);
    expect(none.reason).toMatch(/needs a look|flagged/);
  });

  it("shows a badge for each state", () => {
    expect(dayBadge(day([flagged()]))).toMatchObject({ label: "Needs a look", tone: "warn" });
    expect(dayBadge(day([post({ postStatus: "approved" })])).label).toBe("Approved");
    expect(dayBadge(day([post()])).label).toBe("Ready");
    expect(dayBadge(day([post({ queueStatus: "scheduled", mode: "deliver", slotLabel: "Tue 20 Oct, 09:00" })])).label).toBe("Scheduled · Tue 20 Oct, 09:00");
    expect(dayBadge(day([post({ queueStatus: "published", mode: "publish" })])).label).toBe("Published");
    expect(dayBadge(day([post({ queueStatus: "delivered", mode: "deliver" })])).label).toBe("Delivered");
    expect(dayBadge(day([post({ image: null })])).label).toBe("Not drawn yet");
  });
});

describe("approve and schedule", () => {
  it("schedules the ready days, leaves flagged days alone and never approves them", async () => {
    const r = await approveAndSchedulePlan(shop.userId, shop.brandId, planId);
    expect(r.scheduled).toBe(2);
    expect(r.needsCheck).toHaveLength(2);
    expect(r.failed).toEqual([]);
    const st = await rows<{ id: string; status: string }>(db, "select id::text as id, status::text as status from public.posts where id = any($1::uuid[])", [posts]);
    const by = Object.fromEntries(st.map((x) => [x.id, x.status]));
    expect([by[posts[0]], by[posts[1]]]).toEqual(["approved", "approved"]);
    expect([by[posts[2]], by[posts[3]]]).toEqual(["draft", "draft"]);
    const q = await rows<{ post_id: string }>(db, "select post_id::text as post_id from public.queue_items where brand_id = $1", [shop.brandId]);
    expect(q.map((x) => x.post_id).sort()).toEqual([posts[0], posts[1]].sort());
    expect((await getPlan(shop.userId, shop.brandId, planId))!.status).toBe("designed");
  });

  it("works out the badges, the button and the success panel from the stored queue (after a reload)", async () => {
    const days = await statusNow(); // a fresh read, as a page reload does
    expect(days.map((d) => dayBadge(d).state)).toEqual(["scheduled", "scheduled", "needs_look", "needs_look"]);
    expect(dayBadge(days[0]).label).toMatch(/^Scheduled · .*09:00$/);
    const sum = summarize(days);
    expect(sum).toMatchObject({ scheduled: 2, scheduledPosts: 2, needsLook: 2, ready: 0 });
    expect(approveButton(sum)).toMatchObject({ disabled: true });
    const html = renderToStaticMarkup(createElement(ScheduleSummary, { days, live }));
    expect(html).toContain("2 posts scheduled");
    expect(html).toContain("2 days need a look");
    expect(html).toContain(`href="#plan-day-${days[2].date}"`);
    expect(html).toContain('href="/week"');
    expect(html).toContain("emailed to you");
    expect(html).toContain('data-complete="false"');
  });

  it("lets the owner resolve a day, then schedules it; the last one makes the week complete", async () => {
    let days = await statusNow();
    // The per-day panel shows the line-by-line actions and "These are all fine".
    const panel = renderToStaticMarkup(createElement(DayFlags, { briefId: days[2].briefId, date: days[2].date, posts: days[2].posts.map((p) => ({ id: p.id, channel: p.channel, openFlags: p.openFlags })) }));
    expect(panel).toContain("true");
    expect(panel).toContain("Remove");
    expect(panel).toContain("These are all fine");

    const c = await confirmPostFlag({ userId: shop.userId, brandId: shop.brandId, postId: posts[2], flagId: FLAG.id, regulatedAck: false });
    expect(c.ok).toBe(true);
    days = await statusNow();
    expect(days.map((d) => dayBadge(d).state)).toEqual(["scheduled", "scheduled", "ready", "needs_look"]);
    expect(approveButton(summarize(days)).label).toBe("Approve and schedule 1 ready day");

    const r = await approveAndSchedulePlan(shop.userId, shop.brandId, planId);
    expect(r.scheduled).toBe(1);
    expect(r.needsCheck).toHaveLength(1);

    await confirmPostFlag({ userId: shop.userId, brandId: shop.brandId, postId: posts[3], flagId: FLAG.id, regulatedAck: false });
    expect(approveButton(summarize(await statusNow())).label).toBe("Approve and schedule 1 ready day");
    await approveAndSchedulePlan(shop.userId, shop.brandId, planId);

    days = await statusNow();
    const sum = summarize(days);
    expect(allScheduled(sum)).toBe(true);
    expect((await getPlan(shop.userId, shop.brandId, planId))!.status).toBe("scheduled");
    const html = renderToStaticMarkup(createElement(ScheduleSummary, { days, live }));
    expect(html).toContain("Your week is scheduled");
    expect(html).not.toContain("need a look");
    expect(html).toContain('data-complete="true"');
    // The button is gone once the week is in the queue.
    expect(renderToStaticMarkup(createElement(AutomatePanel, { planId, summary: sum, time: "09:00" }))).toBe("");
  });
});

describe("the bar", () => {
  it("shows the label and, when nothing is ready, a disabled button with the reason", () => {
    const off = renderToStaticMarkup(createElement(AutomatePanel, { planId: "p", summary: summarize([day([flagged()])]), time: "09:00" }));
    expect(off).toContain(`disabled=""`);
    expect(off).toContain("Every day left still needs a look");
    const part = renderToStaticMarkup(createElement(AutomatePanel, { planId: "p", summary: summarize([day([post()]), day([flagged()])]), time: "09:00" }));
    expect(part).toContain("Approve and schedule 1 ready day");
    expect(part).not.toContain(`disabled=""`);
  });
});
