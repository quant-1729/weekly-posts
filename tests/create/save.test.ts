import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));

import { checkQrLinkAction, describePostAction, saveBriefAction } from "@/app/(app)/create/actions";
import { BriefIncompleteError, BriefValidationError } from "@/lib/briefs/errors";
import { draftToInput, emptyDraft } from "@/lib/briefs/editor-state";
import { loadEditorData } from "@/lib/briefs/editor-data";
import { saveBriefFromEditor } from "@/lib/briefs/save";
import { getBrief, listBriefs } from "@/lib/briefs/service";
import { createContact } from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import { listOutbox } from "@/lib/email/outbox";
import { addPaymentId, confirmPaymentId } from "@/lib/payments";
import { createUsp } from "@/lib/usps/service";
import type { Usp } from "@/lib/usps/types";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let o: Owner;
let other: Owner;
let discount: Usp;
let paymentId: string;

const NOW = new Date("2026-10-14T12:00:00Z");
const publicResolver = async () => [{ address: "93.184.216.34" }];

beforeAll(async () => {
  db = await openDb();
  o = await makeOwner(db, { name: "Corner Bakery", country: "GB", timezone: "Europe/London" });
  other = await makeOwner(db, { name: "Other Shop", country: "GB" });
  discount = await createUsp(o.userId, o.brandId, { kind: "discount", title: "20% off cakes", details: { percent: 20, on: "cakes" } });
  await createContact(o.userId, o.brandId, { kind: "phone", value: "+44 20 7946 0958", isDefault: true });

  await addPaymentId({ userId: o.userId, brandId: o.brandId, scheme: "upi", address: "corner.bakery@okhdfcbank", payeeName: "Corner Bakery" });
  const token = /\/p\/([A-Za-z0-9_-]{43})/.exec((await listOutbox()).at(-1)!.text)![1];
  expect((await confirmPaymentId(token)).state).toBe("confirmed");
  paymentId = (await db.withAdmin((tx) => tx.query<{ id: string }>("select id from public.payment_ids where brand_id = $1 and status = 'active'", [o.brandId])))[0].id;
});
afterAll(() => closeDb(db));
beforeEach(() => {
  session.user = { id: o.userId };
});

const draftInput = (patch: Record<string, unknown> = {}) => ({
  ...draftToInput({ ...emptyDraft({ blocks: { phone: true }, language: "en", channels: ["instagram"] }), postType: "brand" })!,
  ...patch,
});

describe("autosave creates, then updates, one draft", () => {
  it("the first save creates a draft; later saves update the same row", async () => {
    const before = (await listBriefs(o.userId, o.brandId)).length;
    const first = await saveBriefFromEditor(o.userId, o.brandId, null, draftInput(), { now: NOW, resolve: false });
    expect(first.brief).toMatchObject({ status: "draft", postType: "brand", language: "en", channels: ["instagram"], blocks: { phone: true } });
    expect(first.qrError).toBeNull();

    const second = await saveBriefFromEditor(o.userId, o.brandId, first.brief.id, draftInput({ postType: "offer", primaryUspId: discount.id, endsOn: "2026-10-20", cta: "visit" }), { now: NOW, resolve: false });
    expect(second.brief.id).toBe(first.brief.id);
    expect(second.brief).toMatchObject({ status: "draft", postType: "offer", primaryUspId: discount.id, endsOn: "2026-10-20" });
    expect(second.brief.uspSnapshot.map((u) => u.title)).toEqual(["20% off cakes"]);
    expect((await listBriefs(o.userId, o.brandId)).length).toBe(before + 1);
    expect((await getBrief(o.userId, o.brandId, first.brief.id))?.cta).toBe("visit");
  });

  it("a draft may be incomplete: an offer with nothing else still saves", async () => {
    const r = await saveBriefFromEditor(o.userId, o.brandId, null, draftInput({ postType: "offer" }), { now: NOW, resolve: false });
    expect(r.brief.status).toBe("draft");
  });

  it("the action does the same for the signed-in owner and refuses a signed-out visitor", async () => {
    const r = await saveBriefAction(o.brandId, null, draftInput({ postType: "event" }));
    expect(r).toMatchObject({ ok: true, brief: { postType: "event", status: "draft" } });
    session.user = null;
    expect(await saveBriefAction(o.brandId, null, draftInput())).toMatchObject({ ok: false, code: "generic" });
  });

  it("another business's owner can neither create in nor update this brand's briefs", async () => {
    const mine = await saveBriefFromEditor(o.userId, o.brandId, null, draftInput(), { now: NOW });
    await expect(saveBriefFromEditor(other.userId, o.brandId, null, draftInput(), { now: NOW })).rejects.toThrow();
    await expect(saveBriefFromEditor(other.userId, other.brandId, mine.brief.id, draftInput(), { now: NOW })).rejects.toThrow();
    session.user = { id: other.userId };
    expect(await saveBriefAction(o.brandId, mine.brief.id, draftInput())).toMatchObject({ ok: false });
  });

  it("a rule broken in a draft comes back as words for the field (end date in the past)", async () => {
    const r = await saveBriefAction(o.brandId, null, draftInput({ postType: "offer", endsOn: "2020-01-01" }));
    expect(r).toMatchObject({ ok: false, code: "validation", fieldErrors: { endsOn: expect.stringContaining("passed") } });
  });
});

describe("Next refuses an incomplete brief", () => {
  it("'ready' needs the items B-8 lists, and the stored brief stays a draft", async () => {
    const draft = await saveBriefFromEditor(o.userId, o.brandId, null, draftInput({ postType: "offer", primaryUspId: discount.id }), { now: NOW });
    const err = await saveBriefFromEditor(o.userId, o.brandId, draft.brief.id, draftInput({ postType: "offer", primaryUspId: discount.id }), { status: "ready", now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(BriefIncompleteError);
    expect((err as BriefIncompleteError).missing.map((m) => m.key)).toEqual(["dates", "cta"]);
    expect((await getBrief(o.userId, o.brandId, draft.brief.id))?.status).toBe("draft");

    const viaAction = await saveBriefAction(o.brandId, draft.brief.id, draftInput({ postType: "offer", primaryUspId: discount.id }), "ready");
    expect(viaAction).toMatchObject({ ok: false, code: "incomplete", missing: [{ key: "dates", question: "Until when is the offer on?" }, { key: "cta" }] });
  });

  it("a complete brief becomes ready", async () => {
    const complete = draftInput({ postType: "offer", primaryUspId: discount.id, endsOn: "2026-10-20", cta: "visit" });
    const r = await saveBriefFromEditor(o.userId, o.brandId, null, complete, { status: "ready", now: NOW, resolve: false });
    expect(r.brief.status).toBe("ready");
    const viaAction = await saveBriefAction(o.brandId, r.brief.id, complete, "ready");
    expect(viaAction).toMatchObject({ ok: true, brief: { status: "ready" } });
  });
});

describe("QR on the brief", () => {
  it("a link to a public address is saved; one to a private address is refused with words, and the rest still saves", async () => {
    const good = await saveBriefFromEditor(o.userId, o.brandId, null, draftInput({ qr: { kind: "link", target: "website", url: "https://bakery.example.com" } }), { now: NOW, resolver: publicResolver });
    expect(good.qrError).toBeNull();
    expect(good.brief.qr).toMatchObject({ kind: "link", target: "website" });

    const bad = await saveBriefFromEditor(o.userId, o.brandId, good.brief.id, draftInput({ notes: "keep going", qr: { kind: "link", target: "custom", url: "http://192.168.0.5/admin" } }), { now: NOW, resolver: publicResolver });
    expect(bad.qrError).toContain("private address");
    expect(bad.brief.notes).toBe("keep going"); // the other fields saved
    expect(bad.brief.qr).toMatchObject({ kind: "link", target: "website" }); // the QR stays as it was

    const noSuchHost = await saveBriefFromEditor(o.userId, o.brandId, null, draftInput({ qr: { kind: "link", target: "custom", url: "https://nowhere.example" } }), { now: NOW, resolver: async () => { throw new Error("ENOTFOUND"); } });
    expect(noSuchHost.qrError).toContain("could not find that website");
  });

  it("'ready' with a refused QR link is blocked", async () => {
    const complete = draftInput({ qr: { kind: "link", target: "custom", url: "http://localhost:3000" } });
    await expect(saveBriefFromEditor(o.userId, o.brandId, null, complete, { status: "ready", now: NOW, resolver: publicResolver })).rejects.toBeInstanceOf(BriefValidationError);
  });

  it("a payment QR needs a payment ID that is confirmed and the brand's own", async () => {
    const ok = await saveBriefFromEditor(o.userId, o.brandId, null, draftInput({ qr: { kind: "payment", paymentId } }), { now: NOW });
    expect(ok.brief.qr).toEqual({ kind: "payment", paymentId });
    // A made-up ID, and another brand's ID, are refused.
    const made = await saveBriefAction(o.brandId, null, draftInput({ qr: { kind: "payment", paymentId: "11111111-1111-4111-8111-111111111111" } }));
    expect(made).toMatchObject({ ok: false, fieldErrors: { qr: expect.stringContaining("not confirmed") } });
    session.user = { id: other.userId };
    const stolen = await saveBriefAction(other.brandId, null, draftInput({ qr: { kind: "payment", paymentId } }));
    expect(stolen).toMatchObject({ ok: false });
  });

  it("the link check action rejects private addresses without a network lookup", async () => {
    expect(await checkQrLinkAction(o.brandId, "http://127.0.0.1/x")).toMatchObject({ ok: false });
    expect(await checkQrLinkAction(o.brandId, "")).toMatchObject({ ok: false, message: "Please type a link." });
    session.user = null;
    expect(await checkQrLinkAction(o.brandId, "https://example.com")).toMatchObject({ ok: false });
  });
});

describe("Describe your post (action)", () => {
  it("returns the checked brief, the questions and the fields to highlight; saves nothing", async () => {
    const before = (await listBriefs(o.userId, o.brandId)).length;
    const r = await describePostAction(o.brandId, "20% off cakes, call us");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.brief).toMatchObject({ postType: "offer", primaryUspId: discount.id, cta: "call" });
      expect(r.result.filled).toEqual(expect.arrayContaining(["postType", "primaryUsp", "cta"]));
      expect(r.result.questions.length).toBeGreaterThan(0);
    }
    expect((await listBriefs(o.userId, o.brandId)).length).toBe(before);
  });

  it("says why in plain words when there is nothing to read, and refuses a signed-out visitor", async () => {
    expect(await describePostAction(o.brandId, "   ")).toMatchObject({ ok: false, code: "empty", message: "Please write or say a few words first." });
    expect(await describePostAction(o.brandId, "x".repeat(2001))).toMatchObject({ ok: false, code: "too_long" });
    session.user = null;
    expect(await describePostAction(o.brandId, "hello")).toMatchObject({ ok: false });
  });
});

describe("what the page loads", () => {
  it("gives the editor the library, the contacts, today in the business's zone, the defaults and the payment ID", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: new Date("2026-10-14T23:30:00Z") });
    expect(data.today).toBe("2026-10-15"); // London is on BST, one hour ahead
    expect(data.usps.map((u) => u.title)).toContain("20% off cakes");
    expect(data.contacts.map((c) => c.kind)).toContain("phone");
    expect(data.defaults).toMatchObject({ language: "en", blocks: { phone: true }, channels: ["instagram"] });
    expect(data.payment).toMatchObject({ id: paymentId, address: "corner.bakery@okhdfcbank", payeeName: "Corner Bakery" });
    const none = await loadEditorData(other.userId, other.brandId);
    expect(none.payment).toBeNull();
    await expect(loadEditorData(other.userId, o.brandId)).rejects.toThrow();
  });
});
