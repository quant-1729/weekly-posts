// Owner request 2026-10-16: choose post, carousel or reel (coming soon) at the start of Create a post.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }), redirect: () => undefined, usePathname: () => "/create" }));
vi.mock("@/app/(app)/create/actions", () => ({ saveBriefAction: vi.fn(), describePostAction: vi.fn(), checkQrLinkAction: vi.fn(), addUspAction: vi.fn(), confirmUspHereAction: vi.fn() }));
vi.mock("@/app/(app)/brand/details-actions", () => ({ createUspAction: vi.fn(), confirmUspAction: vi.fn() }));

import { BriefEditor } from "@/components/create/brief-editor";
import { FormatPicker } from "@/components/create/format-picker";
import { loadEditorData } from "@/lib/briefs/editor-data";
import { draftFromBrief, draftToInput, emptyDraft, missingForNext, setContentFormat, stepSlides } from "@/lib/briefs/editor-state";
import { BriefValidationError } from "@/lib/briefs/errors";
import { describeBriefError } from "@/lib/briefs/messages";
import { createBrief, getBrief, updateBrief } from "@/lib/briefs/service";
import { MAX_SLIDES, MIN_SLIDES } from "@/lib/briefs/types";
import { briefFingerprint } from "@/lib/create/posts";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let o: Owner;
const NOW = new Date("2026-10-14T12:00:00Z");

beforeAll(async () => {
  db = await openDb();
  o = await makeOwner(db, { name: "Corner Bakery", country: "GB", timezone: "Europe/London" });
});
afterAll(() => closeDb(db));

const make = (input: Record<string, unknown> = {}) => createBrief(o.userId, o.brandId, { postType: "announcement", notes: "We are open late on Friday.", ...input }, { now: NOW });
const fieldErrors = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BriefValidationError);
    return (e as BriefValidationError).fieldErrors;
  }
  throw new Error("expected a BriefValidationError");
};

describe("the brief service keeps the content format", () => {
  it("a brief with no format is a post with no slide count", async () => {
    const b = await make();
    expect(b).toMatchObject({ contentFormat: "post", slideCount: null });
    expect(await getBrief(o.userId, o.brandId, b.id)).toMatchObject({ contentFormat: "post", slideCount: null });
  });

  it("saves and reads back a carousel and its slide count (3 to 10)", async () => {
    for (const n of [MIN_SLIDES, 5, MAX_SLIDES]) {
      const b = await make({ contentFormat: "carousel", slideCount: n });
      expect(b).toMatchObject({ contentFormat: "carousel", slideCount: n });
      expect(await getBrief(o.userId, o.brandId, b.id)).toMatchObject({ contentFormat: "carousel", slideCount: n });
    }
  });

  it("refuses a reel with a clear 'coming soon' message", async () => {
    const errors = await fieldErrors(make({ contentFormat: "reel" }));
    expect(errors).toEqual({ contentFormat: "reel_coming_soon" });
    const words = describeBriefError(new BriefValidationError(errors));
    expect(words).toMatchObject({ ok: false, code: "validation" });
    expect(words.ok === false && words.fieldErrors?.contentFormat).toMatch(/coming soon/i);
    // An existing brief is not changed by the refused update.
    const b = await make();
    await fieldErrors(updateBrief(o.userId, o.brandId, b.id, { contentFormat: "reel" }));
    expect((await getBrief(o.userId, o.brandId, b.id))!.contentFormat).toBe("post");
  });

  it("refuses an unknown format", async () => {
    expect(await fieldErrors(make({ contentFormat: "story" }))).toEqual({ contentFormat: "invalid_format" });
    expect(await fieldErrors(make({ contentFormat: 3 }))).toEqual({ contentFormat: "invalid_format" });
  });

  it("needs a slide count from 3 to 10 for a carousel", async () => {
    expect(await fieldErrors(make({ contentFormat: "carousel" }))).toEqual({ slideCount: "slide_count_required" });
    expect(await fieldErrors(make({ contentFormat: "carousel", slideCount: null }))).toEqual({ slideCount: "slide_count_required" });
    for (const bad of [2, 0, 11, -1, 3.5, "5", NaN]) {
      expect(await fieldErrors(make({ contentFormat: "carousel", slideCount: bad }))).toEqual({ slideCount: "slide_count_range" });
    }
  });

  it("allows no slide count for a single post, and clears it when a carousel becomes a post", async () => {
    expect(await fieldErrors(make({ contentFormat: "post", slideCount: 5 }))).toEqual({ slideCount: "slides_only_for_carousel" });
    expect(await fieldErrors(make({ slideCount: 4 }))).toEqual({ slideCount: "slides_only_for_carousel" });
    const c = await make({ contentFormat: "carousel", slideCount: 6 });
    const back = await updateBrief(o.userId, o.brandId, c.id, { contentFormat: "post" });
    expect(back).toMatchObject({ contentFormat: "post", slideCount: null });
    const again = await updateBrief(o.userId, o.brandId, c.id, { contentFormat: "carousel", slideCount: 4 });
    expect(again).toMatchObject({ contentFormat: "carousel", slideCount: 4 });
    // Other edits keep the format.
    expect(await updateBrief(o.userId, o.brandId, c.id, { notes: "Changed" })).toMatchObject({ contentFormat: "carousel", slideCount: 4 });
  });

  it("the database refuses slides on a single post and a count out of range", async () => {
    const run = (format: string, count: number | null) =>
      db.withAdmin((tx) =>
        tx.query("insert into public.post_briefs (brand_id, post_type, content_format, slide_count, created_by) values ($1, 'announcement', $2, $3, $4)", [o.brandId, format, count, o.userId]),
      );
    await expect(run("post", 5)).rejects.toThrow();
    await expect(run("carousel", 11)).rejects.toThrow();
    await expect(run("reel", null)).resolves.toBeDefined(); // reserved by the schema, refused by the service
  });
});

describe("the copy fingerprint", () => {
  const legacy = (b: Awaited<ReturnType<typeof make>>) => {
    const usps = b.uspSnapshot.map((u) => [u.uspId, u.kind, u.title, u.details, u.confirmed, u.role]);
    const key = JSON.stringify([b.postType, usps, b.cta, b.qr, b.startsOn, b.endsOn, b.openEnded, b.channels, b.language, b.notes, ...(b.extraPostTypes?.length ? [b.extraPostTypes] : [])]);
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
  };

  it("is exactly what it was for a post, so old posts keep theirs", async () => {
    const b = await make();
    expect(briefFingerprint(b)).toBe(legacy(b));
    expect(briefFingerprint({ ...b, contentFormat: undefined, slideCount: undefined })).toBe(legacy(b));
  });

  it("changes with the format and the slide count for a carousel", async () => {
    const b = await make();
    const c5 = await updateBrief(o.userId, o.brandId, b.id, { contentFormat: "carousel", slideCount: 5 });
    const c6 = await updateBrief(o.userId, o.brandId, b.id, { slideCount: 6 });
    expect(new Set([briefFingerprint(b), briefFingerprint(c5), briefFingerprint(c6)]).size).toBe(3);
  });
});

describe("the editor state", () => {
  const base = emptyDraft({ blocks: {}, language: "en", channels: ["instagram"] });

  it("starts as a post with 5 slides ready for when Carousel is picked", () => {
    expect(base).toMatchObject({ contentFormat: "post", slideCount: 5 });
    expect(draftToInput({ ...base, postType: "offer" })).toMatchObject({ contentFormat: "post", slideCount: null });
  });

  it("sends the slide count only for a carousel, and keeps it inside 3 to 10", () => {
    let d = setContentFormat({ ...base, postType: "offer" }, "carousel");
    expect(draftToInput(d)).toMatchObject({ contentFormat: "carousel", slideCount: 5 });
    for (let i = 0; i < 12; i++) d = stepSlides(d, 1);
    expect(d.slideCount).toBe(MAX_SLIDES);
    for (let i = 0; i < 12; i++) d = stepSlides(d, -1);
    expect(d.slideCount).toBe(MIN_SLIDES);
    // Switching back to Post sends no count; switching to Carousel again restores the owner's number.
    d = stepSlides(stepSlides(d, 1), 1);
    const post = setContentFormat(d, "post");
    expect(draftToInput(post)).toMatchObject({ contentFormat: "post", slideCount: null });
    expect(draftToInput(setContentFormat(post, "carousel"))).toMatchObject({ slideCount: 5 });
  });

  it("cannot pick Reel: the draft stays as it was", () => {
    const d = setContentFormat({ ...base, contentFormat: "carousel", slideCount: 7 }, "reel");
    expect(d).toMatchObject({ contentFormat: "carousel", slideCount: 7 });
    expect(missingForNext({ ...d, postType: "offer" }, [], new Set()).some((m) => /reel/i.test(m.question))).toBe(false);
  });

  it("is read back from a saved brief", async () => {
    const b = await make({ contentFormat: "carousel", slideCount: 8 });
    expect(draftFromBrief(b)).toMatchObject({ contentFormat: "carousel", slideCount: 8 });
  });
});

describe("the format control at the top of Create a post", () => {
  const picker = (format: "post" | "carousel", slides = 5) => renderToString(createElement(FormatPicker, { format, slides, onFormat: () => undefined, onSlides: () => undefined }));
  const reelButton = (h: string) => /<button[^>]*data-format="reel"[^>]*>[\s\S]*?<\/button>/.exec(h)?.[0] ?? "";

  it("offers Post, Carousel and Reel, with Reel disabled and a 'Coming soon' badge", () => {
    const h = picker("post");
    for (const f of ["post", "carousel", "reel"]) expect(h).toContain(`data-format="${f}"`);
    const reel = reelButton(h);
    expect(reel).toContain('aria-disabled="true"');
    expect(reel).toContain(s.create.format.comingSoon);
    expect(reel).toContain('aria-checked="false"');
    // Post and Carousel are not disabled, and no "Coming soon" appears elsewhere.
    expect(/<button[^>]*data-format="post"[^>]*>/.exec(h)![0]).toContain('aria-disabled="false"');
    expect(/<button[^>]*data-format="carousel"[^>]*>/.exec(h)![0]).toContain('aria-disabled="false"');
    expect(h.split(s.create.format.comingSoon)).toHaveLength(2);
    expect(/<button[^>]*data-format="post"[^>]*>/.exec(h)![0]).toContain('aria-checked="true"');
  });

  it("shows the slide stepper only when Carousel is picked, inside 3 to 10", () => {
    expect(picker("post")).not.toContain("data-slide-stepper");
    const h = picker("carousel", 5);
    expect(h).toContain("data-slide-stepper");
    expect(h).toContain('data-slide-count="5"');
    expect(h).toContain("5 slides");
    const lessAtMin = /<button[^>]*aria-label="Fewer slides"[^>]*>/.exec(picker("carousel", MIN_SLIDES))![0];
    expect(lessAtMin).toContain('disabled=""');
    expect(/<button[^>]*aria-label="More slides"[^>]*>/.exec(picker("carousel", MIN_SLIDES))![0]).not.toContain('disabled=""');
    expect(/<button[^>]*aria-label="More slides"[^>]*>/.exec(picker("carousel", MAX_SLIDES))![0]).toContain('disabled=""');
  });

  it("is the first thing in the Details step, above the description card", async () => {
    const data = await loadEditorData(o.userId, o.brandId);
    const h = renderToString(createElement(BriefEditor, { data, initialBrief: null }));
    const at = h.indexOf("data-format-picker");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(h.indexOf('id="describe-text"'));
    expect(h).not.toContain("data-slide-stepper"); // a new post is a post
    const c = await make({ contentFormat: "carousel", slideCount: 7 });
    const h2 = renderToString(createElement(BriefEditor, { data, initialBrief: c }));
    expect(h2).toContain('data-slide-count="7"');
  });
});
