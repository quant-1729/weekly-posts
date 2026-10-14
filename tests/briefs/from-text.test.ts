import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BriefTextError, BRIEF_TEXT_MAX, briefFromText, describeBriefTextError, validate } from "@/lib/briefs/from-text";
import type { BriefFromText } from "@/lib/ai/schemas-v3";
import { createContact } from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import { addPaymentId, confirmPaymentId } from "@/lib/payments";
import { listOutbox } from "@/lib/email/outbox";
import { DailyCapError } from "@/lib/usage";
import { WEEKLY_BRIEF_FROM_TEXT, WeeklyCapError } from "@/lib/usage/caps";
import { createUsp, listUsps } from "@/lib/usps/service";
import type { Usp } from "@/lib/usps/types";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let o: Owner;
let discount: Usp;
let quality: Usp;
let custom: Usp;

// Wednesday 14 October 2026, midday in London.
const NOW = new Date("2026-10-14T12:00:00Z");

const blank: BriefFromText = {
  post_type: "brand",
  primary_usp_id: "",
  secondary_usp_ids: [],
  new_usp: [],
  cta: "",
  blocks: [],
  starts_on: "",
  ends_on: "",
  language: "",
  questions: [],
};
const answer = (patch: Partial<BriefFromText>): BriefFromText => ({ ...blank, ...patch });

beforeAll(async () => {
  db = await openDb();
  o = await makeOwner(db, { name: "Corner Bakery", country: "GB", timezone: "Europe/London" });
  discount = await createUsp(o.userId, o.brandId, { kind: "discount", title: "20% off cakes", details: { percent: 20, on: "cakes" } });
  quality = await createUsp(o.userId, o.brandId, { kind: "quality", title: "Baked fresh every morning", details: { claim: "Baked fresh every morning" } });
  custom = await createUsp(o.userId, o.brandId, { kind: "custom", title: "Family run", details: {} });
  await createContact(o.userId, o.brandId, { kind: "phone", value: "+44 20 7946 0958", isDefault: true });
  await createContact(o.userId, o.brandId, { kind: "whatsapp", value: "+44 20 7946 0958", isDefault: true });
});
afterAll(() => closeDb(db));

const run = (text: string, fixture: BriefFromText | ((p: { system: string; user: string }) => BriefFromText), now = NOW) =>
  briefFromText({ userId: o.userId, brandId: o.brandId, text, now }, { fixture });

describe("briefFromText: what the model may fill", () => {
  it("returns only what it could ground, and says which fields came from the words", async () => {
    const r = await run(
      "20% off cakes till Sunday, call us",
      answer({ post_type: "offer", primary_usp_id: discount.id, secondary_usp_ids: [custom.id], cta: "call", ends_on: "2026-10-18", language: "en-GB", questions: ["Should it show your hours?"] }),
    );
    expect(r.brief).toEqual({ postType: "offer", primaryUspId: discount.id, secondaryUspIds: [custom.id], cta: "call", endsOn: "2026-10-18", language: "en-GB" });
    expect(r.filled).toEqual(["postType", "primaryUsp", "secondaryUsps", "cta", "dates", "language"]);
    expect(r.questions).toEqual(["Should it show your hours?"]);
    expect(r.newUsp).toBeNull();
    expect(r.dropped).toEqual([]);
    // Nothing is saved by this call.
    expect(await listUsps(o.userId, o.brandId)).toHaveLength(3);
  });

  it("leaves empty what the model left empty (never guesses)", async () => {
    const r = await run("a post about the shop", answer({ questions: ["Until when?"] }));
    expect(r.brief).toEqual({ postType: "brand" });
    expect(r.filled).toEqual(["postType"]);
  });

  it("drops ids that are not in the owner's list", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    const r = await run("cakes", answer({ post_type: "offer", primary_usp_id: discount.id, secondary_usp_ids: [unknown, quality.id] }));
    expect(r.brief.primaryUspId).toBe(discount.id);
    expect(r.brief.secondaryUspIds).toEqual([quality.id]);
    expect(r.dropped).toEqual(["unknown_usp"]);

    // The main point can't also be an extra one, and the same extra point counts once.
    const twice = validate(answer({ primary_usp_id: discount.id, secondary_usp_ids: [discount.id, custom.id] }), {
      text: "x", usps: [discount.id, custom.id], available: [], today: "2026-10-14", timezone: "UTC", country: "GB", now: NOW,
    });
    expect(twice.brief.secondaryUspIds).toEqual([custom.id]);

    const bad = await run("cakes", answer({ primary_usp_id: unknown, secondary_usp_ids: [custom.id] }));
    expect(bad.brief.primaryUspId).toBeUndefined();
    expect(bad.brief.secondaryUspIds).toBeUndefined(); // an extra point without a main one is not guessed into a main one
    expect(bad.dropped).toEqual(expect.arrayContaining(["unknown_usp", "secondary_without_primary"]));
  });

  it("a USP of another brand is just an unknown id", async () => {
    const other = await makeOwner(db, { name: "Other", country: "GB" });
    const theirs = await createUsp(other.userId, other.brandId, { kind: "custom", title: "Theirs", details: {} });
    const r = await run("x", answer({ primary_usp_id: theirs.id }));
    expect(r.brief.primaryUspId).toBeUndefined();
  });

  it("drops dates that are not real, in the past, out of order or absurdly far away", async () => {
    const invalid = await run("until the 30th Feb", answer({ ends_on: "2026-02-30" }));
    expect(invalid.brief.endsOn).toBeUndefined();
    expect(invalid.dropped).toContain("invalid_date");

    const notIso = await run("until Sunday", answer({ ends_on: "Sunday" }));
    expect(notIso.brief.endsOn).toBeUndefined();

    const past = await run("until last week", answer({ ends_on: "2026-10-01" }));
    expect(past.brief.endsOn).toBeUndefined();
    expect(past.dropped).toContain("end_in_past");

    const order = await run("from 20th to 18th", answer({ starts_on: "2026-10-20", ends_on: "2026-10-18" }));
    expect(order.brief.startsOn).toBeUndefined();
    expect(order.brief.endsOn).toBeUndefined();
    expect(order.dropped).toContain("dates_order");

    const far = await run("someday", answer({ ends_on: "2031-01-01" }));
    expect(far.brief.endsOn).toBeUndefined();
    expect(far.dropped).toContain("date_too_far");

    const good = await run("this weekend", answer({ starts_on: "2026-10-17", ends_on: "2026-10-18" }));
    expect(good.brief).toMatchObject({ startsOn: "2026-10-17", endsOn: "2026-10-18" });
    expect(good.filled).toContain("dates");
  });

  it("today is the date in the brand's time zone, not on the server (00:30 on the 15th in London)", async () => {
    const late = new Date("2026-10-14T23:30:00Z"); // 00:30 on the 15th in London (BST)
    const r = await run("until today", answer({ ends_on: "2026-10-14" }), late);
    expect(r.dropped).toContain("end_in_past");
    const same = await run("until today", answer({ ends_on: "2026-10-15" }), late);
    expect(same.brief.endsOn).toBe("2026-10-15");
  });

  it("only accepts a language we offer, matching variants like en-gb", async () => {
    expect((await run("x", answer({ language: "hi" }))).brief.language).toBe("hi");
    expect((await run("x", answer({ language: "en-gb" }))).brief.language).toBe("en-GB");
    expect((await run("x", answer({ language: "hi-IN" }))).brief.language).toBe("hi");
    const klingon = await run("x", answer({ language: "tlh" }));
    expect(klingon.brief.language).toBeUndefined();
    expect(klingon.dropped).toContain("unknown_language");
  });

  it("keeps only the blocks the brand has; an empty list means the brand's defaults", async () => {
    const r = await run("show whatsapp", answer({ blocks: ["whatsapp", "youtube", "logo"] }));
    expect(r.brief.blocks).toEqual({ phone: false, whatsapp: true });
    expect(r.dropped).toContain("unknown_block");
    expect(r.filled).toContain("blocks");
    const none = await run("hi", answer({ blocks: [] }));
    expect(none.brief.blocks).toBeUndefined();
    const withDates = await run("show whatsapp until Sunday", answer({ blocks: ["whatsapp"], ends_on: "2026-10-18" }));
    expect(withDates.brief.blocks).toEqual({ phone: false, whatsapp: true, dates: true });
  });
});

describe("briefFromText: a new selling point is only a suggestion", () => {
  it("is validated, grounded in the owner's words and returned unsaved", async () => {
    const text = "Big sale: 25% off all suits this week";
    const r = await run(
      text,
      answer({
        post_type: "offer",
        new_usp: [{ kind: "discount", title: "25% off all suits", quote: "25% off all suits", fields: { percent: 25, on: "suits" } }],
      }),
    );
    expect(r.newUsp).toEqual({ kind: "discount", title: "25% off all suits", details: { percent: 25, on: "suits", upTo: false }, quote: "25% off all suits" });
    expect(r.filled).toContain("newUsp");
    expect(await listUsps(o.userId, o.brandId, { includeInactive: true })).toHaveLength(3); // never auto-saved
  });

  it("reads a price with the country's currency, and a percent written as text", async () => {
    const r = await run(
      "Sourdough loaf only 4.50 today",
      answer({ new_usp: [{ kind: "price", title: "Sourdough loaf 4.50", quote: "Sourdough loaf only 4.50", fields: { item: "Sourdough loaf", price: "4.50" } }] }),
    );
    expect(r.newUsp?.details).toEqual({ item: "Sourdough loaf", price: { amount: 4.5, currency: "GBP" } });
    const pct = await run(
      "10% off bread",
      answer({ new_usp: [{ kind: "discount", title: "10% off bread", quote: "10% off bread", fields: { percent: "10%", on: "bread" } }] }),
    );
    expect(pct.newUsp?.details).toMatchObject({ percent: 10 });
  });

  it("accepts a discount whose subject came back as `what` instead of `on` (seen live, 2026-10-14)", async () => {
    const r = await run(
      "Diwali offer: 15% off all suit stitching till 31 October. Book on WhatsApp.",
      answer({ new_usp: [{ kind: "discount", title: "15% off all suit stitching", quote: "15% off all suit stitching", fields: { what: "all suit stitching", percent: 15, validTo: "2026-10-31" } }] }),
    );
    expect(r.newUsp?.details).toMatchObject({ percent: 15, on: "all suit stitching", validTo: "2026-10-31" });
  });

  it("is dropped when the details fail the USP rules", async () => {
    const r = await run(
      "discount on everything",
      answer({ new_usp: [{ kind: "discount", title: "A discount", quote: "discount on everything", fields: { on: "everything" } }] }), // no percent or amount
    );
    expect(r.newUsp).toBeNull();
    expect(r.dropped).toContain("new_usp_invalid");
    const reviews = await run(
      "rated 4.8",
      answer({ new_usp: [{ kind: "reviews", title: "4.8 rated", quote: "rated 4.8", fields: { rating: 4.8 } }] }), // no count or platform
    );
    expect(reviews.newUsp).toBeNull();
    expect(reviews.dropped).toContain("new_usp_invalid");
  });

  it("is dropped when it quotes words the owner did not write, or uses a number they did not write", async () => {
    const invented = await run(
      "Fresh cakes daily",
      answer({ new_usp: [{ kind: "discount", title: "50% off", quote: "50% off everything", fields: { percent: 50, on: "everything" } }] }),
    );
    expect(invented.newUsp).toBeNull();
    expect(invented.dropped).toContain("new_usp_ungrounded");

    const wrongNumber = await run(
      "20% off all cakes",
      answer({ new_usp: [{ kind: "discount", title: "30% off cakes", quote: "20% off all cakes", fields: { percent: 30, on: "cakes" } }] }),
    );
    expect(wrongNumber.newUsp).toBeNull();
    expect(wrongNumber.dropped).toContain("new_usp_ungrounded");
  });

  it("validate() is a pure function and trims the questions to three", () => {
    const r = validate(answer({ questions: [" a ", "", "b", "c", "d"] }), { text: "x", usps: [], available: [], today: "2026-10-14", timezone: "UTC", country: "GB", now: NOW });
    expect(r.questions).toEqual(["a", "b", "c"]);
  });
});

describe("briefFromText: payment IDs never reach the model", () => {
  const ACTIVE = "corner.bakery@okhdfcbank";
  let owner: Owner;
  let usp: Usp;

  beforeAll(async () => {
    owner = await makeOwner(db, { name: "Ravi Sweets", country: "IN", timezone: "Asia/Kolkata" });
    await addPaymentId({ userId: owner.userId, brandId: owner.brandId, scheme: "upi", address: ACTIVE, payeeName: "Ravi Sweets" });
    const token = /\/p\/([A-Za-z0-9_-]{43})/.exec((await listOutbox()).at(-1)!.text)![1];
    expect((await confirmPaymentId(token)).state).toBe("confirmed");
    usp = await createUsp(owner.userId, owner.brandId, { kind: "custom", title: `Pay ${ACTIVE} for sweets`, details: {} });
  });

  it("removes the saved ID, a lookalike address and a upi:// link from the owner's words and from USP text", async () => {
    const seen: Array<{ system: string; user: string }> = [];
    const text = `Diwali box 500 rupees. Pay to ${ACTIVE} or friend@ybl, or upi://pay?pa=${ACTIVE}&pn=Ravi. Contact hello@ravi.example.com`;
    await briefFromText(
      { userId: owner.userId, brandId: owner.brandId, text, now: NOW },
      {
        fixture: (p) => {
          seen.push(p);
          return answer({ post_type: "offer", primary_usp_id: usp.id });
        },
      },
    );
    expect(seen).toHaveLength(1);
    const all = `${seen[0].system}\n${seen[0].user}`.toLowerCase();
    for (const secret of [ACTIVE, "friend@ybl", "upi://"]) expect(all).not.toContain(secret.toLowerCase());
    expect(all).toContain("[payment id removed]");
    expect(all).toContain("diwali box 500 rupees");
    expect(all).toContain("hello@ravi.example.com"); // an email address is not a payment ID
    expect(all).toContain(usp.id.toLowerCase()); // the USP is still offered, with its text cleaned
  });

  it("a spoken transcript goes through the same function and is cleaned the same way", async () => {
    const seen: string[] = [];
    await briefFromText(
      { userId: owner.userId, brandId: owner.brandId, text: `pay me at ${ACTIVE.toUpperCase()} please`, now: NOW },
      { fixture: (p) => (seen.push(p.user), blank) },
    );
    expect(seen[0].toLowerCase()).not.toContain(ACTIVE);
  });
});

describe("briefFromText: input, caps and usage", () => {
  it("refuses empty and too-long text before any AI call", async () => {
    await expect(run("   ", blank)).rejects.toMatchObject({ code: "empty" });
    await expect(run("a".repeat(BRIEF_TEXT_MAX + 1), blank)).rejects.toBeInstanceOf(BriefTextError);
    expect(describeBriefTextError(new BriefTextError("too_long"))?.message).toContain("2000");
  });

  it("is for members only", async () => {
    const stranger = await makeOwner(db, { name: "Stranger" });
    await expect(briefFromText({ userId: stranger.userId, brandId: o.brandId, text: "hi", now: NOW }, { fixture: blank })).rejects.toThrow();
  });

  it("records one brief_from_text usage event per call", async () => {
    const fresh = await makeOwner(db, { name: "Usage Test" });
    const count = async () =>
      (await db.withAdmin((tx) => tx.query<{ n: number }>("select count(*)::int as n from public.usage_events where brand_id = $1 and kind = 'brief_from_text'", [fresh.brandId])))[0].n;
    expect(await count()).toBe(0);
    await briefFromText({ userId: fresh.userId, brandId: fresh.brandId, text: "hello", now: NOW }, { fixture: blank });
    expect(await count()).toBe(1);
  });

  it("stops at the weekly count cap with a plain message, and does not call the model", async () => {
    const capped = await makeOwner(db, { name: "Capped", timezone: "Europe/London" });
    for (let i = 0; i < WEEKLY_BRIEF_FROM_TEXT; i++) {
      await db.withAdmin((tx) =>
        tx.query("insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, 'brief_from_text', 0.001, $2)", [capped.brandId, new Date(Date.UTC(2026, 9, 12, 10, i)).toISOString()]),
      );
    }
    let called = false;
    const err = await briefFromText({ userId: capped.userId, brandId: capped.brandId, text: "hello", now: NOW }, { fixture: () => ((called = true), blank) }).catch((e) => e);
    expect(err).toBeInstanceOf(WeeklyCapError);
    expect(called).toBe(false);
    expect(describeBriefTextError(err)).toEqual({ code: "cap", message: expect.stringContaining("reset on Monday") });
  });

  it("stops at the daily cap", async () => {
    const daily = await makeOwner(db, { name: "Daily" });
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 1 where id = $1", [daily.brandId]));
    await db.withAdmin((tx) => tx.query("insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, 'setup', 0, $2)", [daily.brandId, NOW.toISOString()]));
    const err = await briefFromText({ userId: daily.userId, brandId: daily.brandId, text: "hello", now: NOW }, { fixture: blank }).catch((e) => e);
    expect(err).toBeInstanceOf(DailyCapError);
    expect(describeBriefTextError(err)?.code).toBe("cap");
  });

  it("the built-in fixture reads the text honestly: no invented dates, and unknown things stay empty", async () => {
    const r = await briefFromText({ userId: o.userId, brandId: o.brandId, text: "20% off cakes, order by WhatsApp", now: NOW });
    expect(r.brief.postType).toBe("offer");
    expect(r.brief.cta).toBe("whatsapp");
    expect(r.brief.endsOn).toBeUndefined();
    expect(r.newUsp).toBeNull();
  });
});
