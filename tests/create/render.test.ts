import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }), redirect: () => undefined, usePathname: () => "/create" }));
vi.mock("@/app/(app)/create/actions", () => ({ saveBriefAction: vi.fn(), describePostAction: vi.fn(), checkQrLinkAction: vi.fn(), addUspAction: vi.fn(), confirmUspHereAction: vi.fn() }));
vi.mock("@/app/(app)/brand/details-actions", () => ({ createUspAction: vi.fn(), confirmUspAction: vi.fn() }));

import { BriefEditor } from "@/components/create/brief-editor";
import { DescribeBox } from "@/components/create/describe-box";
import { ShowEditor } from "@/components/create/show-editor";
import { StepBar } from "@/components/create/steps";
import { UspPicker } from "@/components/create/usp-picker";
import { formatClock } from "@/components/use-wav-capture";
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
/** The "What to show on the post" step. */
const showHtml = (data: EditorData, brief: Brief) => renderToString(createElement(ShowEditor, { data, brief }));
const describeProps = { brandId: "", value: "", onChange: () => undefined, onResult: () => undefined, questions: [] as string[] };
/** The attributes of every <input> in some html, whatever order React wrote them in. */
type Attrs = Record<string, string>;
function inputs(h: string): Attrs[] {
  return [...h.matchAll(/<input\b([^>]*)>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] ?? ""])));
}
/** The html of one editor section. */
const card = (h: string, id: string) => new RegExp(`<section id="${id}"[\\s\\S]*?</section>`).exec(h)?.[0] ?? "";
/** The html of one selling point's row. */
const uspRow = (h: string, id: string) => new RegExp(`<li data-usp-id="${id}"[\\s\\S]*?</li>`).exec(h)?.[0] ?? "";
/** The "Next" button's tag. */
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

describe("empty editor (Details)", () => {
  it("shows five steps, one describe card with a microphone inside the box, the 8 post types and only the Details cards", async () => {
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }));
    for (const step of ["Details", "On the post", "Design", "Review", "Schedule"]) expect(h).toContain(step);
    expect((h.match(/data-step="/g) ?? []).length).toBe(5);
    expect(h).toMatch(/data-step="details"[^>]*data-state="current"/);
    expect(h).toContain('aria-current="step"');
    // No page header, no intro, no visible label or long hint on the box.
    expect(h).not.toContain("<h1");
    expect(h).not.toContain("Start with the details");
    expect(h).not.toContain("What do you want to post about?");
    expect(h).not.toContain("Type or say what you want to post");
    expect(h).not.toContain("Speak instead");
    expect(h).not.toContain("data-voice-hint");
    expect(h).not.toContain("payment details");
    expect(card(h, "describe")).toContain("Create a post");
    expect(card(h, "describe")).toContain("Describe what kind of post you want.");
    // The text box has an accessible name; the microphone is a round icon button inside the same box (44px on phones).
    expect(h).toMatch(/<textarea[^>]*aria-label="Describe your post"/);
    const mic = /<button[^>]*data-mic[^>]*>/.exec(h)?.[0] ?? "";
    expect(mic).toContain('aria-label="Speak your post"');
    expect(mic).toMatch(/max-md:h-11 max-md:w-11/);
    expect(mic).toContain("rounded-full");
    expect(mic).toContain("absolute");
    expect(h).not.toContain("data-recording"); // nothing records until it is clicked
    // 8 post types, none chosen.
    expect((h.match(/data-post-type="/g) ?? []).length).toBe(8);
    for (const label of Object.values(s.create.type.options).map((x) => x.label)) expect(h).toContain(label);
    expect(h).not.toMatch(/name="post-type"[^>]*checked/);
    // Cards kept and cards moved or removed.
    for (const id of ["describe", "type", "photo", "language", "channels"]) expect(h).toContain(`data-editor-card="${id}"`);
    for (const id of ["usps", "cta", "blocks", "qr", "dates"]) expect(h).not.toContain(`data-editor-card="${id}"`);
    for (const gone of ["Selling points", "What should customers do?", "Details to show on the post", "QR code", "Before you continue", "Pick what kind of post this is.", 'name="cta"']) expect(h).not.toContain(gone);
    expect(h).toContain("Supporting photo or design");
    expect(h).toContain("Add a photo or a design for this post, or go without one.");
    expect(h).toContain("No photo (design only)");
  });

  it("is one column with a plain bottom row: save text and a Next button that stays enabled", async () => {
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }));
    expect(h).not.toContain("data-editor-summary");
    expect(h).not.toContain("lg:grid-cols-");
    expect(h).toContain("max-w-page-sm");
    expect(nextButton(h)).not.toContain('disabled=""');
    expect(h).toMatch(/data-next[^>]*>Next<\/button>/);
    expect(h).not.toContain("Next: Design");
    expect(h).not.toContain("data-type-error"); // problems only appear after Next is pressed
    expect(h).toMatch(/<option value="en" selected="">English<\/option>/);
    expect(h).toMatch(/type="checkbox" class="sr-only" checked=""[^>]*\/>Instagram/); // the brand has an Instagram handle, so it starts ticked
  });
});

describe("a business with nothing set up", () => {
  it("renders the Details step with an empty photo library", async () => {
    const h = html(await loadEditorData(bare.userId, bare.brandId, { now: NOW }));
    expect(h).toContain("Your photo library is empty.");
  });

  it("the show step renders with no contact chips and one link to the Brand page", async () => {
    const data = await loadEditorData(bare.userId, bare.brandId, { now: NOW });
    const brief = await createBrief(bare.userId, bare.brandId, { postType: "brand", notes: "Hello" }, { now: NOW });
    const h = showHtml(data, brief);
    expect(h).not.toContain("data-block-text");
    expect(h).toContain("Add more on your Brand page");
  });
});

describe("filled brief (Details)", () => {
  it("loads an existing brief with its description, type and channels", async () => {
    const brief = await createBrief(
      o.userId,
      o.brandId,
      { postType: "offer", notes: "20% off all cakes this weekend", cta: "whatsapp", endsOn: "2026-10-19", channels: ["facebook"] },
      { now: NOW },
    );
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }), brief);
    expect(h).toMatch(/<textarea[^>]*>20% off all cakes this weekend<\/textarea>/);
    expect(h).toMatch(/data-post-type="offer"[^>]*>\s*<input[^>]*checked=""/);
    // No dates card: the end date is neither shown nor asked.
    expect(h).not.toContain("Ends in 5 days");
    // Facebook is on, Instagram off.
    expect(h).toMatch(/checked=""[^>]*\/>Facebook/);
    expect(h).not.toMatch(/checked=""[^>]*\/>Instagram/);
  });
});

describe("What to show on the post", () => {
  it("has the title, five steps with On the post current, and compact chips with the exact text", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const brief = await createBrief(o.userId, o.brandId, { postType: "brand", notes: "Hello" }, { now: NOW });
    const h = showHtml(data, brief);
    expect(h).toContain("What to show on the post");
    expect(h).toMatch(/data-step="show"[^>]*data-state="current"/);
    expect(h).toMatch(/data-step="details"[^>]*data-state="done"/);
    expect(h).toMatch(/data-step="design"[^>]*data-state="todo"/);
    expect(h).toMatch(/data-block="phone"[\s\S]*?\+44 20 7946 0958/);
    expect(h).toMatch(/data-block="website"[\s\S]*?bakery\.example\.com/);
    expect(h).toMatch(/data-block="instagram"[\s\S]*?@cornerbakery/);
    // Blocks the brand doesn't have are hidden behind one link; the dates block is never shown.
    expect(h).not.toContain('data-block="address"');
    expect(h).not.toContain('data-block="logo"');
    expect(h).not.toContain('data-block="dates"');
    expect((h.match(/Add more on your Brand page/g) ?? []).length).toBe(1);
    expect(h).toContain('href="/brand#contacts"');
    // Phone is on by default (the brand's defaults).
    expect(h).toMatch(/data-block="phone"[\s\S]*?checked=""/);
    // Back to Details and Next to Design.
    expect(h).toContain(`href="/create/${brief.id}"`);
    expect(h).toMatch(/data-next[^>]*>Next: Design<\/button>/);
    expect(h).not.toContain("Before you continue");
  });

  it("wraps on phones: chips are in a wrapping list and long text breaks", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const brief = await createBrief(o.userId, o.brandId, { postType: "brand", notes: "Hello" }, { now: NOW });
    const h = showHtml(data, brief);
    expect(h).toContain("flex-wrap");
    expect(h).toContain("break-words");
  });
});

describe("QR section (on the show step)", () => {
  const withBrief = (owner: Owner, qr?: object) => createBrief(owner.userId, owner.brandId, { postType: "brand", notes: "Hello", ...(qr ? { qr } : {}) }, { now: NOW });

  it("payment: unavailable without a confirmed ID, with a link to the Brand page", async () => {
    const h = showHtml(await loadEditorData(bare.userId, bare.brandId, { now: NOW }), await withBrief(bare));
    const modes = inputs(card(h, "qr")).filter((i) => i.name === "qr-mode");
    expect(modes).toHaveLength(3); // none, link, payment
    expect(modes[2]).toHaveProperty("disabled");
    expect(modes[0]).not.toHaveProperty("disabled");
    expect(modes[1]).not.toHaveProperty("disabled");
    expect(h).toContain("Only if you want one.");
    expect(h).toContain("Payment QR codes need a confirmed payment ID.");
    expect(h).toContain('href="/brand#payment"');
    expect(h).toContain("Set up a payment QR on your Brand page");
  });

  it("payment: available with a confirmed ID, and then shows who it pays (as text)", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const h = showHtml(data, await withBrief(o));
    expect(h).not.toContain("Payment QR codes need a confirmed payment ID.");
    expect(inputs(card(h, "qr")).filter((i) => i.name === "qr-mode")[2]).not.toHaveProperty("disabled");
    const withQr = showHtml(data, await withBrief(o, { kind: "payment", paymentId: data.payment!.id }));
    expect(withQr).toContain("Pays Corner Bakery, corner.bakery@okhdfcbank");
    expect(withQr).toContain("Scan to pay");
  });

  it("link: shows the target choices and the saved link", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const h = showHtml(data, await withBrief(o, { kind: "link", target: "whatsapp", url: "https://wa.me/442079460958" }));
    for (const label of ["My website", "WhatsApp chat", "Google Maps", "Booking page", "Another link"]) expect(h).toContain(label);
    expect(h).toContain('value="https://wa.me/442079460958"');
    expect(h).toContain("Scans are counted");
  });
});

describe("selling-point picker (kept for the Brand page and later use)", () => {
  it("warns that too many points make the post hard to read and offers a carousel (a format with room for one extra point)", () => {
    const pick = (channels: string[]) =>
      renderToString(
        createElement(UspPicker, {
          brandId: o.brandId,
          usps: [discount, family, open],
          primaryUspId: discount.id,
          secondaryUspIds: [family.id, open.id],
          channels,
          currency: "GBP",
          fromDescription: false,
          onChange: () => undefined,
          onUspsChange: () => undefined,
          onUspAdded: () => undefined,
        }),
      );
    // YouTube thumbnails hold 1 main + 1 extra point.
    const h = pick(["youtube"]);
    expect(h).toContain("data-usp-warning");
    expect(h).toContain("Too many points make the post hard to read");
    expect(h).toContain("carousel");
    // Instagram's square and portrait formats hold 1 + 2, so there is no warning.
    expect(pick(["instagram"])).not.toContain("data-usp-warning");
  });

  it("the extra-point boxes are off until a main point is chosen, and off when two are already chosen", () => {
    const usps = [discount, rating, family, open];
    const pick = (primary: string | null, secondary: string[]) =>
      renderToString(
        createElement(UspPicker, {
          brandId: o.brandId,
          usps,
          primaryUspId: primary,
          secondaryUspIds: secondary,
          channels: ["instagram"],
          currency: "GBP",
          fromDescription: false,
          onChange: () => undefined,
          onUspsChange: () => undefined,
          onUspAdded: () => undefined,
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

  it("marks a field that came from the description", () => {
    const picker = renderToString(
      createElement(UspPicker, {
        brandId: o.brandId,
        usps: [discount],
        primaryUspId: discount.id,
        secondaryUspIds: [],
        channels: ["instagram"],
        currency: "GBP",
        fromDescription: true,
        onChange: () => undefined,
        onUspsChange: () => undefined,
        onUspAdded: () => undefined,
      }),
    );
    expect(picker).toContain("data-from-description");
    expect(picker).toContain("From your description");
  });
});

describe("Create a post box", () => {
  it("shows the typed description, and the model's questions as one-line prompts", () => {
    const box = renderToString(
      createElement(DescribeBox, { ...describeProps, brandId: o.brandId, value: "Cakes at 20% off", questions: ["Until when does the offer run?", "Which number should people call?"] }),
    );
    expect(box).toContain("Cakes at 20% off");
    expect(box).toContain("data-describe-questions");
    expect(box).toContain("Still to decide");
    expect(box).toContain("Until when does the offer run?");
    expect(box).toContain("Which number should people call?");
    expect(box).toContain("Fill in the details");
  });

  it("shows a problem with the text under the box", () => {
    const box = renderToString(createElement(DescribeBox, { ...describeProps, brandId: o.brandId, error: "Please write or say a few words first." }));
    expect(box).toMatch(/data-describe-error[^>]*>Please write or say a few words first\./);
    expect(box).toContain('aria-invalid="true"');
  });

  it("formats the recording timer", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7.9)).toBe("0:07");
    expect(formatClock(125)).toBe("2:05");
  });
});

describe("the steps bar", () => {
  it("has five steps; earlier ones are done and the current one is marked", () => {
    const h = renderToString(createElement(StepBar, { current: "design" }));
    expect((h.match(/<li data-step="/g) ?? []).length).toBe(5);
    expect(h).toMatch(/data-step="details"[^>]*data-state="done"/);
    expect(h).toMatch(/data-step="show"[^>]*data-state="done"/);
    expect(h).toMatch(/data-step="design"[^>]*data-state="current"/);
    expect(h).toMatch(/data-step="review"[^>]*data-state="todo"/);
    expect(h).toMatch(/data-step="schedule"[^>]*data-state="todo"/);
    expect(h).toContain("On the post");
  });
});

describe("phones", () => {
  it("has no horizontal scrolling or fixed widths, and no multi-column layout without a breakpoint", async () => {
    const data = await loadEditorData(o.userId, o.brandId, { now: NOW });
    const brief = await createBrief(o.userId, o.brandId, { postType: "offer", notes: "Cakes", qr: { kind: "link", target: "website", url: "https://bakery.example.com" } }, { now: NOW });
    for (const h of [html(data), html(data, brief), showHtml(data, brief)]) {
      expect(h).not.toMatch(/overflow-x|whitespace-nowrap|w-screen|min-w-\[|\bw-\[\d|min-w-max|w-max/);
      // No unprefixed multi-column grid (the 5-step bar has one-word labels).
      expect(h.replace(/<nav aria-label="Steps[\s\S]*?<\/nav>/, "")).not.toMatch(/(?<![:\w-])grid-cols-(?:[2-9]|1\d)\b/);
      expect(h).toContain("min-w-0");
      expect(h).toContain("break-words");
      // The primary button is the near-black pill with a 44px tap target on phones (primaryButton); inputs are full width (inputClass).
      expect(h).toMatch(/class="inline-flex min-h-9 [^"]*max-md:min-h-11[^"]*bg-ink text-white/);
      expect(h).toMatch(/<(input|select|textarea)[^>]*class="block w-full rounded-2xl/);
    }
  });
});

describe("several post types (checkboxes)", () => {
  it("shows checkbox cards, a Select all row for types and channels, and no Main badge before a pick", async () => {
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }));
    const boxes = inputs(card(h, "type"));
    const types = boxes.filter((i) => i.name === "post-type");
    expect(types).toHaveLength(8);
    expect(types.every((i) => i.type === "checkbox")).toBe(true);
    expect(h).not.toContain('type="radio" name="post-type"');
    expect(boxes.find((i) => "data-select-all" in i)).toMatchObject({ type: "checkbox", "aria-controls": "type-options" });
    expect(card(h, "type")).toContain("Select all");
    expect(card(h, "type")).toContain('id="type-options"');
    expect(card(h, "channels")).toContain("Select all");
    expect(inputs(card(h, "channels")).find((i) => "data-select-all" in i)).toMatchObject({ "aria-controls": "channel-options" });
    expect(card(h, "channels")).toContain('id="channel-options"');
    expect(h).not.toContain("data-main-badge");
    expect(card(h, "type")).not.toMatch(/<button/); // a checkbox row, not a new button
  });

  it("an existing brief shows its main type with a Main badge and its extras ticked", async () => {
    const brief = await createBrief(o.userId, o.brandId, { postType: "new_product", extraPostTypes: ["offer"], notes: "New sourdough, 20% off" }, { now: NOW });
    const h = html(await loadEditorData(o.userId, o.brandId, { now: NOW }), brief);
    expect(h.match(/data-main-badge/g)).toHaveLength(1);
    expect(h).toMatch(/data-post-type="new_product"[\s\S]*?data-main-badge/);
    expect(h).toMatch(/data-post-type="offer"[^>]*>\s*<input[^>]*checked=""/);
    expect(h).not.toMatch(/data-post-type="event"[^>]*>\s*<input[^>]*checked=""/);
  });
});
