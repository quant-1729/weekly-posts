import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }), redirect: () => undefined, usePathname: () => "/create" }));
vi.mock("@/app/(app)/create/actions", () => ({ saveBriefAction: vi.fn(), describePostAction: vi.fn(), checkQrLinkAction: vi.fn(), addUspAction: vi.fn(), confirmUspHereAction: vi.fn() }));
vi.mock("@/app/(app)/brand/details-actions", () => ({ createUspAction: vi.fn(), confirmUspAction: vi.fn() }));

import { BriefEditor } from "@/components/create/brief-editor";
import { DescribeBox } from "@/components/create/describe-box";
import { StepBar } from "@/components/create/steps";
import { UspPicker } from "@/components/create/usp-picker";
import { loadEditorData, type EditorData } from "@/lib/briefs/editor-data";
import { createBrief } from "@/lib/briefs/service";
import type { Brief } from "@/lib/briefs/types";
import { createContact } from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import { listOutbox } from "@/lib/email/outbox";
import { s } from "@/lib/i18n/strings";
import { addPaymentId, confirmPaymentId } from "@/lib/payments";
import { createUsp } from "@/lib/usps/service";
import type { Usp } from "@/lib/usps/types";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let o: Owner; // a London bakery with a phone, WhatsApp, website, an Instagram handle and a confirmed payment ID
let bare: Owner; // a new business with nothing set up
let discount: Usp;
let rating: Usp;
let family: Usp;
let open: Usp;

const NOW = new Date("2026-10-14T12:00:00Z");
const html = (data: EditorData, brief: Brief | null = null) => renderToString(createElement(BriefEditor, { data, initialBrief: brief }));
/** The attributes of every <input> in some html, whatever order React wrote them in. */
type Attrs = Record<string, string>;
function inputs(h: string): Attrs[] {
  return [...h.matchAll(/<input\b([^>]*)>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] ?? ""])));
}
/** The html of one editor section. */
const card = (h: string, id: string) => new RegExp(`<section id="${id}"[\\s\\S]*?</section>`).exec(h)?.[0] ?? "";
/** The html of one selling point's row. */
const uspRow = (h: string, id: string) => new RegExp(`<li data-usp-id="${id}"[\\s\\S]*?</li>`).exec(h)?.[0] ?? "";
/** The disabled "Next" button's tag. */
const nextButton = (h: string) => /<button[^>]*data-next[^>]*>/.exec(h)?.[0] ?? "";

beforeAll(async () => {
  db = await openDb();
  o = await makeOwner(db, { name: "Corner Bakery", country: "GB", timezone: "Europe/London" });
  bare = await makeOwner(db, { name: "New Shop", country: "GB" });
  discount = await createUsp(o.userId, o.brandId, { kind: "discount", title: "20% off cakes", details: { percent: 20, on: "cakes" } });
  rating = await createUsp(o.userId, o.brandId, { kind: "reviews", title: "4.8 on Google", details: { rating: 4.8, count: 230, platform: "Google" } });
  family = await createUsp(o.userId, o.brandId, { kind: "custom", title: "Family run", details: {} });
  open = await createUsp(o.userId, o.brandId, { kind: "custom", title: "Open late", details: {} });
  for (const c of [
    { kind: "phone", value: "+44 20 7946 0958" },
    { kind: "whatsapp", value: "+44 20 7946 0958" },
    { kind: "website", value: "https://bakery.example.com" },
    { kind: "instagram", value: "cornerbakery" },
  ]) await createContact(o.userId, o.brandId, { ...c, isDefault: true });
  await addPaymentId({ userId: o.userId, brandId: o.brandId, scheme: "upi", address: "corner.bakery@okhdfcbank", payeeName: "Corner Bakery" });
  const token = /\/p\/([A-Za-z0-9_-]{43})/.exec((await listOutbox()).at(-1)!.text)![1];
  await confirmPaymentId(token);
});
afterAll(() => closeDb(db));

describe("empty editor", () => {
  it("shows the four steps, the description box, the 8 post types and every section", async () => {
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }));
    // Steps: Details is the current one.
    for (const step of ["Details", "Design", "Review", "Schedule"]) expect(h).toContain(step);
    expect(h).toMatch(/data-step="details"[^>]*data-state="current"/);
    expect(h).toContain('aria-current="step"');
    // Describe your post: a text box and a microphone button.
    expect(h).toContain("Describe your post");
    expect(h).toContain("<textarea");
    expect(h).toContain("Speak instead");
    // 8 post types, none chosen.
    expect((h.match(/data-post-type="/g) ?? []).length).toBe(8);
    for (const label of Object.values(s.create.type.options).map((x) => x.label)) expect(h).toContain(label);
    expect(h).not.toMatch(/name="post-type"[^>]*checked/);
    // The other sections.
    for (const id of ["usps", "cta", "blocks", "qr", "photo", "language", "dates", "channels"]) expect(h).toContain(`data-editor-card="${id}"`);
    expect(h).toContain("No photo (design only)");
    expect(h).toContain("No end date");
  });

  it("has seven call-to-action options, the brand's channels, and the brand's language", async () => {
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }));
    for (const label of ["Call", "WhatsApp", "Visit us", "Book", "Order online", "Visit website", "Scan QR"]) expect(h).toContain(label);
    expect((h.match(/name="cta"/g) ?? []).length).toBe(7);
    expect(h).toMatch(/<option value="en" selected="">English<\/option>/);
    expect(h).toMatch(/type="checkbox" class="sr-only" checked=""[^>]*\/>Instagram/); // the brand has an Instagram handle, so it starts ticked
  });

  it("asks for the type first, and Next stays disabled", async () => {
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }));
    expect(h).toContain("Pick what kind of post this is.");
    expect(nextButton(h)).toContain('disabled=""');
    expect(h).toContain("Next: Design");
  });

  it("lists the library with kind badges, and a Confirm button for claims that need one", async () => {
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }));
    for (const t of ["20% off cakes", "4.8 on Google", "Family run"]) expect(h).toContain(t);
    expect(h).toContain("Discount");
    expect(h).toContain("Reviews and rating");
    expect(h).toMatch(new RegExp(`data-usp-id="${rating.id}"[\\s\\S]*?data-needs-confirmation="true"[\\s\\S]*?Needs your confirmation[\\s\\S]*?Confirm`));
    expect(h).toContain("Add a new selling point");
    // One main point (radio), up to 2 extra (checkboxes).
    const all = inputs(card(h, "usps"));
    expect(all.filter((i) => i.type === "radio" && i.name === "primary-usp")).toHaveLength(1 + 4); // "None" and one per point
    expect(all.filter((i) => i.type === "checkbox")).toHaveLength(4);
  });

  it("shows each block with the text that will appear, and 'Add it' for a missing one", async () => {
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }));
    expect(h).toMatch(/data-block="phone"[\s\S]*?\+44 20 7946 0958/);
    expect(h).toMatch(/data-block="website"[\s\S]*?bakery\.example\.com/);
    expect(h).toMatch(/data-block="instagram"[\s\S]*?@cornerbakery/);
    expect(h).toMatch(/data-block="address"[\s\S]*?Not added yet[\s\S]*?href="\/brand#contacts"[^>]*>Add it/);
    expect(h).toMatch(/data-block="logo"[\s\S]*?Not added yet[\s\S]*?href="\/brand#look"/);
    // The switches start from the brand's defaults: phone on, address off.
    expect(h).toMatch(/data-block="phone"[\s\S]*?checked=""/);
  });
});

describe("a business with nothing set up", () => {
  it("renders, with an empty library, no payment option and no blocks to show", async () => {
    const h = html(await loadEditorData(bare.userId, bare.brandId, { now: NOW }));
    expect(h).toContain("You have no selling points yet");
    expect(h).toContain("Not added yet");
    expect(h).toContain("Your photo library is empty.");
  });
});

describe("filled brief", () => {
  it("loads an existing brief for editing, with its fields, the date line and the QR link", async () => {
    const brief = await createBrief(o.userId, o.brandId, {
      postType: "offer",
      primaryUspId: discount.id,
      secondaryUspIds: [family.id],
      cta: "whatsapp",
      endsOn: "2026-10-19",
      startsOn: "2026-10-15",
      qr: { kind: "link", target: "website", url: "https://bakery.example.com" },
      channels: ["facebook"],
    }, { now: NOW });
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }), brief);
    expect(h).toMatch(/data-post-type="offer"[^>]*>\s*<input[^>]*checked=""/);
    expect(h).toContain("Ends in 5 days");
    expect(h).toMatch(/data-block="dates"[\s\S]*?From 15 Oct to 19 Oct/);
    expect(h).toContain("Scans are counted");
    expect(h).toContain('value="https://bakery.example.com"');
    expect(h).toContain('value="2026-10-19"');
    // Complete: Next is enabled and nothing is missing.
    expect(h).toContain("Everything needed is filled in.");
    expect(nextButton(h)).not.toContain('disabled=""');
    expect(nextButton(h)).toContain('aria-disabled="false"');
    // Facebook is on, Instagram off.
    expect(h).toMatch(/checked=""[^>]*\/>Facebook/);
    expect(h).not.toMatch(/checked=""[^>]*\/>Instagram/);
  });
});

describe("missing items", () => {
  it("lists them as one-line questions and keeps Next disabled", async () => {
    const brief = await createBrief(o.userId, o.brandId, { postType: "offer" }, { now: NOW });
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }), brief);
    expect(h).toContain("What is the offer, and how much is it?");
    expect(h).toContain("Until when is the offer on?");
    expect(h).toContain("What should customers do: call, visit, book, order or scan?");
    expect(nextButton(h)).toContain('disabled=""');
    expect(h).toContain("Please answer the questions above to continue.");
  });

  it("a chosen claim that needs confirming is listed until the owner confirms it", async () => {
    const brief = await createBrief(o.userId, o.brandId, { postType: "brand", primaryUspId: rating.id }, { now: NOW });
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }), brief);
    expect(h).toContain("Confirm &quot;4.8 on Google&quot; in the selling points before using it.");
    expect(nextButton(h)).toContain('disabled=""');
  });
});

describe("QR section", () => {
  it("payment: unavailable without a confirmed ID, with a link to the Brand page", async () => {
    const h = html(await loadEditorData(bare.userId, bare.brandId, { now: NOW }));
    const modes = inputs(card(h, "qr")).filter((i) => i.name === "qr-mode");
    expect(modes).toHaveLength(3); // none, link, payment
    expect(modes[2]).toHaveProperty("disabled");
    expect(modes[0]).not.toHaveProperty("disabled");
    expect(modes[1]).not.toHaveProperty("disabled");
    expect(h).toContain("Payment QR codes need a confirmed payment ID.");
    expect(h).toContain('href="/brand#payment"');
    expect(h).toContain("Set up a payment QR on your Brand page");
  });

  it("payment: available with a confirmed ID, and then shows who it pays (as text)", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const h = html(data);
    expect(h).not.toContain("Payment QR codes need a confirmed payment ID.");
    expect(h).not.toContain("Set up a payment QR on your Brand page");
    expect(inputs(card(h, "qr")).filter((i) => i.name === "qr-mode")[2]).not.toHaveProperty("disabled");
    const brief = await createBrief(o.userId, o.brandId, { postType: "brand", qr: { kind: "payment", paymentId: data.payment!.id } }, { now: NOW });
    const withQr = html(data, brief);
    expect(withQr).toContain("Pays Corner Bakery, corner.bakery@okhdfcbank");
    expect(withQr).toContain("Scan to pay");
  });

  it("link: shows the target choices, prefilled from the contacts", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const brief = await createBrief(o.userId, o.brandId, { postType: "brand", qr: { kind: "link", target: "whatsapp", url: "https://wa.me/442079460958" } }, { now: NOW });
    const h = html(data, brief);
    for (const label of ["My website", "WhatsApp chat", "Google Maps", "Booking page", "Another link"]) expect(h).toContain(label);
    expect(h).toContain('value="https://wa.me/442079460958"');
  });
});

describe("selling-point warnings", () => {
  it("warns that too many points make the post hard to read and offers a carousel (a format with room for one extra point)", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const brief = await createBrief(o.userId, o.brandId, { postType: "brand", primaryUspId: discount.id, secondaryUspIds: [family.id, open.id] }, { now: NOW });
    // YouTube thumbnails hold 1 main + 1 extra point.
    const h = html(data, { ...brief, channels: ["youtube"] });
    expect(h).toContain("data-usp-warning");
    expect(h).toContain("Too many points make the post hard to read");
    expect(h).toContain("carousel");
    // Instagram's square and portrait formats hold 1 + 2, so there is no warning.
    expect(html(data, { ...brief, channels: ["instagram"] })).not.toContain("data-usp-warning");
  });

  it("the extra-point boxes are off until a main point is chosen, and off when two are already chosen", () => {
    const usps = [discount, rating, family, open];
    const pick = (primary: string | null, secondary: string[]) =>
      renderToString(
        createElement(UspPicker, {
          brandId: o.brandId, usps, primaryUspId: primary, secondaryUspIds: secondary, channels: ["instagram"], currency: "GBP", fromDescription: false, onChange: () => undefined, onUspsChange: () => undefined, onUspAdded: () => undefined,
        }),
      );
    const none = inputs(pick(null, [])).filter((i) => i.type === "checkbox");
    expect(none).toHaveLength(4);
    expect(none.every((i) => "disabled" in i)).toBe(true);
    const two = pick(discount.id, [family.id, open.id]);
    const box = (id: string) => inputs(uspRow(two, id)).find((i) => i.type === "checkbox")!;
    expect(box(rating.id)).toHaveProperty("disabled"); // the third extra point can't be added
    expect(box(discount.id)).toHaveProperty("disabled"); // the main point can't also be an extra one
    expect(box(family.id)).toHaveProperty("checked");
    expect(box(family.id)).not.toHaveProperty("disabled");
  });
});

describe("Describe your post", () => {
  it("marks fields that came from the description, and shows the model's questions as one-line prompts", () => {
    const picker = renderToString(
      createElement(UspPicker, { brandId: o.brandId, usps: [discount], primaryUspId: discount.id, secondaryUspIds: [], channels: ["instagram"], currency: "GBP", fromDescription: true, onChange: () => undefined, onUspsChange: () => undefined, onUspAdded: () => undefined }),
    );
    expect(picker).toContain("data-from-description");
    expect(picker).toContain("From your description");
    const plain = renderToString(
      createElement(UspPicker, { brandId: o.brandId, usps: [discount], primaryUspId: null, secondaryUspIds: [], channels: ["instagram"], currency: "GBP", fromDescription: false, onChange: () => undefined, onUspsChange: () => undefined, onUspAdded: () => undefined }),
    );
    expect(plain).not.toContain("data-from-description");

    const box = renderToString(createElement(DescribeBox, { brandId: o.brandId, onResult: () => undefined, questions: ["Until when does the offer run?", "Which number should people call?"] }));
    expect(box).toContain("data-describe-questions");
    expect(box).toContain("Still to decide");
    expect(box).toContain("Until when does the offer run?");
    expect(box).toContain("Which number should people call?");
  });
});

describe("the design step placeholder and the steps bar", () => {
  it("marks earlier steps done and the current one", () => {
    const h = renderToString(createElement(StepBar, { current: "design" }));
    expect(h).toMatch(/data-step="details"[^>]*data-state="done"/);
    expect(h).toMatch(/data-step="design"[^>]*data-state="current"/);
    expect(h).toMatch(/data-step="review"[^>]*data-state="todo"/);
    expect(h).toMatch(/data-step="schedule"[^>]*data-state="todo"/);
  });
});

describe("phones", () => {
  it("has no horizontal scrolling or fixed widths, and puts the two-column layout on large screens only", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const brief = await createBrief(o.userId, o.brandId, { postType: "offer", primaryUspId: discount.id, qr: { kind: "link", target: "website", url: "https://bakery.example.com" } }, { now: NOW });
    for (const h of [html(data), html(data, brief)]) {
      expect(h).not.toMatch(/overflow-x|whitespace-nowrap|w-screen|min-w-\[|\bw-\[\d|min-w-max|w-max/);
      // No unprefixed multi-column grid (the 4-step bar has one-word labels).
      expect(h.replace(/<nav aria-label="Steps[\s\S]*?<\/nav>/, "")).not.toMatch(/(?<![:\w-])grid-cols-(?:[3-9]|1\d)\b/);
      expect(h).toContain("min-w-0");
      expect(h).toContain("lg:grid-cols-[minmax(0,1fr)_20rem]");
      expect(h).toContain("break-words");
      // Buttons and inputs are full width on phones (primaryButton / inputClass).
      expect(h).toMatch(/class="w-full rounded-lg bg-\[#E4572E\]/);
    }
  });
});
