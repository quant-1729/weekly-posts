import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }), redirect: () => undefined, usePathname: () => "/create" }));
vi.mock("@/app/(app)/create/actions", () => ({ saveBriefAction: vi.fn(), describePostAction: vi.fn(), checkQrLinkAction: vi.fn(), addUspAction: vi.fn(), confirmUspHereAction: vi.fn() }));
vi.mock("@/app/(app)/brand/details-actions", () => ({ createUspAction: vi.fn(), confirmUspAction: vi.fn() }));

import { HistoryCard } from "@/app/(app)/history/history-card";
import { HistoryTable } from "@/app/(app)/history/history-table";
import { BriefEditor } from "@/components/create/brief-editor";
import { DatesPicker } from "@/components/create/dates-picker";
import { DescribeBox } from "@/components/create/describe-box";
import { checkCompleteness } from "@/lib/briefs/completeness";
import { loadEditorData } from "@/lib/briefs/editor-data";
import { applyDescription, datesText, defaultChannels, draftToInput, emptyDraft, missingForNext } from "@/lib/briefs/editor-state";
import { briefFromText } from "@/lib/briefs/from-text";
import { BriefValidationError } from "@/lib/briefs/errors";
import { BRIEF_CHANNELS, createBrief, getBrief, updateBrief } from "@/lib/briefs/service";
import type { Brief } from "@/lib/briefs/types";
import { createContact } from "@/lib/contacts/service";
import type { ContactPoint } from "@/lib/contacts/types";
import type { MockDb } from "@/lib/db/mock";
import type { HistoryPost } from "@/lib/posts/history";
import { NEEDS_CONFIRMATION } from "@/lib/usps/types";
import { createUsp } from "@/lib/usps/service";
import type { Usp } from "@/lib/usps/types";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let o: Owner;
let discount: Usp;
let family: Usp;
let open: Usp;
const NOW = new Date("2026-10-14T12:00:00Z");

beforeAll(async () => {
  db = await openDb();
  o = await makeOwner(db, { name: "Corner Bakery", country: "GB", timezone: "Europe/London" });
  discount = await createUsp(o.userId, o.brandId, { kind: "discount", title: "20% off cakes", details: { percent: 20, on: "cakes" } });
  family = await createUsp(o.userId, o.brandId, { kind: "custom", title: "Family run", details: {} });
  open = await createUsp(o.userId, o.brandId, { kind: "custom", title: "Open late", details: {} });
  await createContact(o.userId, o.brandId, { kind: "whatsapp", value: "+44 20 7946 0958", isDefault: true });
});
afterAll(() => closeDb(db));

const contact = (kind: ContactPoint["kind"]): ContactPoint => ({ id: kind, brandId: "b", kind, value: "x", display: null, details: {}, isDefault: true, verifiedAt: null, source: "owner" });
const bare = (patch: Partial<Brief> = {}): Brief => ({
  id: "b", brandId: "b", postType: "offer", primaryUspId: "u", secondaryUspIds: [], uspSnapshot: [{ uspId: "u", kind: "discount", title: "t", details: {}, confirmed: false, role: "primary" }],
  cta: "visit", blocks: {}, qr: null, photoId: null, language: "en", startsOn: null, endsOn: null, openEnded: false, timezone: "UTC", channels: [], notes: null, status: "draft", ...patch,
});

describe("channels: WhatsApp and YouTube", () => {
  it("the brief accepts all six", async () => {
    expect([...BRIEF_CHANNELS]).toEqual(["instagram", "facebook", "whatsapp", "youtube", "linkedin", "gbp"]);
    const b = await createBrief(o.userId, o.brandId, { postType: "brand", channels: ["whatsapp", "youtube", "gbp"] }, { now: NOW });
    expect((await getBrief(o.userId, o.brandId, b.id))?.channels.sort()).toEqual(["gbp", "whatsapp", "youtube"]);
    await expect(createBrief(o.userId, o.brandId, { postType: "brand", channels: ["tiktok"] }, { now: NOW })).rejects.toBeInstanceOf(BriefValidationError);
  });

  it("starts with WhatsApp when the brand has a WhatsApp contact", () => {
    expect(defaultChannels([contact("whatsapp")])).toEqual(["whatsapp"]);
    expect(defaultChannels([contact("instagram"), contact("whatsapp")])).toEqual(["instagram", "whatsapp"]);
    expect(defaultChannels([])).toEqual(["instagram"]);
  });

  it("the picker shows six channels, and the carousel warning appears when YouTube is on with two extra points", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    expect(data.defaults.channels).toEqual(["whatsapp"]);
    const brief = await createBrief(o.userId, o.brandId, { postType: "brand", primaryUspId: discount.id, secondaryUspIds: [family.id, open.id], channels: ["youtube"] }, { now: NOW });
    const h = renderToString(createElement(BriefEditor, { data, initialBrief: brief }));
    for (const label of ["Instagram", "Facebook", "WhatsApp", "YouTube", "LinkedIn", "Google Business"]) expect(h).toContain(`/>${label}</label>`);
    expect(h).toContain("data-usp-warning");
    expect(h).toContain("Too many points make the post hard to read");
    expect(h).toContain("carousel");
  });
});

describe("No end date for offers", () => {
  it("saving openEnded clears the end date, and an offer with it is complete", async () => {
    const b = await createBrief(o.userId, o.brandId, { postType: "offer", primaryUspId: discount.id, cta: "visit", endsOn: "2026-10-20" }, { now: NOW });
    expect(b).toMatchObject({ endsOn: "2026-10-20", openEnded: false });
    const open1 = await updateBrief(o.userId, o.brandId, b.id, { openEnded: true }, { now: NOW });
    expect(open1).toMatchObject({ endsOn: null, openEnded: true });
    expect(checkCompleteness(open1)).toEqual([]);
    // Both at once: "no end date" wins.
    const both = await updateBrief(o.userId, o.brandId, b.id, { openEnded: true, endsOn: "2026-10-25" }, { now: NOW });
    expect(both).toMatchObject({ endsOn: null, openEnded: true });
    // "ready" works without an end date.
    const ready = await updateBrief(o.userId, o.brandId, b.id, { status: "ready" }, { now: NOW });
    expect(ready).toMatchObject({ status: "ready", openEnded: true, endsOn: null });
    expect((await getBrief(o.userId, o.brandId, b.id))?.openEnded).toBe(true);
  });

  it("choosing an end date again turns it off; unrelated saves keep it", async () => {
    const b = await createBrief(o.userId, o.brandId, { postType: "offer", openEnded: true }, { now: NOW });
    expect((await updateBrief(o.userId, o.brandId, b.id, { notes: "hi" }, { now: NOW })).openEnded).toBe(true);
    const dated = await updateBrief(o.userId, o.brandId, b.id, { endsOn: "2026-10-21" }, { now: NOW });
    expect(dated).toMatchObject({ openEnded: false, endsOn: "2026-10-21" });
  });

  it("must be true or false", async () => {
    await expect(createBrief(o.userId, o.brandId, { postType: "offer", openEnded: "yes" }, { now: NOW })).rejects.toBeInstanceOf(BriefValidationError);
  });

  it("still incomplete without an end date or the choice, and does not help other types", () => {
    expect(checkCompleteness(bare()).map((m) => m.key)).toEqual(["dates"]);
    expect(checkCompleteness(bare({ openEnded: true }))).toEqual([]);
    const event = bare({ postType: "event", primaryUspId: null, uspSnapshot: [], cta: "book", openEnded: true });
    expect(checkCompleteness(event).map((m) => m.key)).toEqual(["dates"]); // an event still needs a date
  });

  it("the editor: only offers send it, the date line says nothing about an end, and Next needs no end date", () => {
    const d = { ...emptyDraft({ blocks: {}, language: "en", channels: ["instagram"] }), postType: "offer" as const, primaryUspId: discount.id, cta: "visit" as const, openEnded: true, endsOn: "2026-10-30" };
    expect(draftToInput(d)).toMatchObject({ openEnded: true, endsOn: null });
    expect(draftToInput({ ...d, postType: "event" })).toMatchObject({ openEnded: false, endsOn: "2026-10-30" });
    expect(missingForNext(d, [{ id: discount.id, kind: "discount", title: "t", confirmed: true }], NEEDS_CONFIRMATION)).toEqual([]);
    expect(datesText("2026-10-15", "")).toBe("From 15 Oct");
    expect(datesText("", "")).toBeNull();
  });

  it("the description never sets it, and an end date it names replaces it", async () => {
    const r = await briefFromText({ userId: o.userId, brandId: o.brandId, text: "20% off cakes, no end date", now: NOW });
    expect(r.brief).not.toHaveProperty("openEnded");
    const d = { ...emptyDraft({ blocks: {}, language: "en", channels: [] }), openEnded: true };
    expect(applyDescription(d, { brief: { postType: "offer" } }).openEnded).toBe(true);
    expect(applyDescription(d, { brief: { postType: "offer", endsOn: "2026-10-20" } })).toMatchObject({ openEnded: false, endsOn: "2026-10-20" });
  });

  it("the dates picker offers the checkbox for offers only, and turns the end date off", () => {
    const props = { startsOn: "", endsOn: "", today: "2026-10-14", fromDescription: false, onChange: () => undefined, onOpenEndedChange: () => undefined };
    const offer = renderToString(createElement(DatesPicker, { ...props, canBeOpenEnded: true, openEnded: true }));
    expect(offer).toContain("data-open-ended");
    expect(offer).toContain("No end date (the offer runs until you change it)");
    expect(offer).toContain("The post will not say when the offer ends.");
    expect(/<input[^>]*id="dates-end"[^>]*>/.exec(offer)?.[0]).toContain('disabled=""');
    const event = renderToString(createElement(DatesPicker, { ...props, canBeOpenEnded: false }));
    expect(event).not.toContain("data-open-ended");
    expect(/<input[^>]*id="dates-end"[^>]*>/.exec(event)?.[0]).not.toContain("disabled");
  });

  it("an existing open-ended offer loads with the box ticked and Next enabled", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const b = await createBrief(o.userId, o.brandId, { postType: "offer", primaryUspId: discount.id, cta: "visit", openEnded: true }, { now: NOW });
    const h = renderToString(createElement(BriefEditor, { data, initialBrief: b }));
    expect(/<input[^>]*data-open-ended[^>]*>/.exec(h)?.[0]).toContain("checked");
    expect(h).toContain("Everything needed is filled in.");
  });
});

describe("voice hint", () => {
  it("tells the owner not to say payment details", () => {
    const h = renderToString(createElement(DescribeBox, { brandId: o.brandId, onResult: () => undefined, questions: [] }));
    expect(h).toContain("data-voice-hint");
    expect(h).toContain("don&#x27;t say payment details; set those on your Brand page.");
  });
});

describe("History", () => {
  const post: HistoryPost = { id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-10-13T10:00:00.000Z", status: "ready", inputType: "text", title: "Fresh bread", languages: [], thumbnail: null, outputs: [] };
  it("no longer links to /create?from=", () => {
    const card = renderToString(createElement("ul", null, createElement(HistoryCard, { post, brandName: "Bakery" })));
    const table = renderToString(createElement(HistoryTable, { posts: [post, { ...post, id: "22222222-2222-4222-8222-222222222222", status: "failed" }], brandName: "Bakery" }));
    for (const h of [card, table]) {
      expect(h).not.toContain("/create");
      expect(h).toContain(`/review/${post.id}`);
    }
  });
});
