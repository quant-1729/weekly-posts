// The carousel screens: the slide strip with its viewer, Share and Download of all slides, per-slide flags.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/create/[briefId]/actions", () => ({
  approveAllAction: vi.fn(),
  approvePostAction: vi.fn(),
  confirmFlagAction: vi.fn(),
  logShareAction: vi.fn(),
  removeFlagAction: vi.fn(),
  saveCaptionAction: vi.fn(),
  undoAllAction: vi.fn(),
  undoApprovalAction: vi.fn(),
}));

import { ReviewChecks } from "@/components/create/review-checks";
import { ReviewScreen } from "@/components/create/review-screen";
import { SharePanel } from "@/components/create/share-panel";
import { SlideStrip } from "@/components/create/slide-strip";
import type { ReviewData, ReviewPost } from "@/lib/create";
import type { Flag } from "@/lib/guardrail";

const noop = () => undefined;
const urls = [1, 2, 3, 4, 5].map((n) => `/api/files/renders/b/s${n}/portrait.png?v=1`);
const slideFlag = (over: Partial<Flag> = {}): Flag => ({ id: "s2_f1", text: "£3.99", kind: "price", field: "image_text.headline", layer: "code", regulated: false, highlight: true, status: "open", decided_at: null, slide: 2, ...over });
const post = (over: Partial<ReviewPost> = {}): ReviewPost => ({
  id: "p1",
  channel: "instagram",
  label: "Instagram",
  status: "draft",
  caption: "Cake week!",
  hashtags: [],
  hashtagsMax: 8,
  captionMax: 1200,
  cta: "Visit us",
  headline: "Cake week",
  flags: [],
  openFlags: [],
  reminder: false,
  blockers: [],
  images: [{ format: "portrait", url: urls[0] }],
  slides: urls,
  carouselAsked: true,
  shareText: "Cake week!",
  designed: true,
  canApprove: true,
  ...over,
});

describe("the slide strip", () => {
  it("is a scrollable row of five thumbnails, each opening that slide", () => {
    const out = renderToString(createElement(SlideStrip, { urls }));
    expect(out).toContain("Slides (5)");
    expect(out).toMatch(/<ul[^>]*overflow-x-auto[^>]*data-slides/);
    expect((out.match(/data-slide="/g) ?? []).length).toBe(5);
    expect(out).toContain('aria-label="Open slide 3 of 5"');
    expect(out).not.toContain("data-slide-flag");
    expect(out).not.toContain("data-slide-large"); // the viewer is closed
  });

  it("marks a slide with items to check", () => {
    const out = renderToString(createElement(SlideStrip, { urls, flagged: [2] }));
    expect((out.match(/data-slide-flag/g) ?? []).length).toBe(1);
    expect(out).toContain('aria-label="Slide 3 has items to check"');
  });

  it("the viewer shows the slide large, where it is in the set, and previous, next and close buttons", () => {
    const out = renderToString(createElement(SlideStrip, { urls, defaultOpenAt: 2 }));
    expect(out).toMatch(/<dialog[^>]*data-slide-viewer/);
    expect(out).toContain("3 of 5");
    expect(out).toMatch(/<img[^>]*src="\/api\/files\/renders\/b\/s3\/portrait\.png\?v=1"[^>]*data-slide-large/);
    for (const label of ["Previous slide", "Next slide", "Close"]) expect(out).toContain(`aria-label="${label}"`);
  });
});

describe("the share menu of a carousel", () => {
  const render = (over: Record<string, unknown> = {}) =>
    renderToString(createElement(SharePanel, { postId: "p1", channel: "instagram", images: post().images, slides: urls, shareText: "Cake week!", defaultOpen: true, ...over }));

  it("downloads all the slides at once instead of one size, and still copies the caption", () => {
    const out = render();
    expect(out).toContain(">Download all 5 slides<");
    expect(out).toContain("data-download-all");
    expect(out).not.toContain(">Download portrait<");
    expect(out).toContain(">Copy caption<");
    expect((out.match(/role="menuitem"/g) ?? []).length).toBe(2); // phone sharing appears only where the browser can share files
  });

  it("a single picture keeps its per-size items", () => {
    const out = render({ slides: [] });
    expect(out).toContain(">Download portrait<");
    expect(out).not.toContain("data-download-all");
  });
});

describe("flags on a slide", () => {
  it("say which slide they are on", () => {
    const p = post({ flags: [slideFlag()], openFlags: [slideFlag()], canApprove: false });
    const out = renderToString(createElement(ReviewChecks, { post: p, briefId: "b1", busy: false, acks: {}, setAcks: noop, onConfirm: noop, onRemove: noop, onEditCaption: noop, defaultOpenId: "s2_f1" }));
    expect(out).toContain('data-flag-slide="3"');
    expect(out).toContain("Slide 3");
    expect(out).toContain("£3.99");
    expect(out).toContain(">Remove<");
  });
});

describe("the review screen of a carousel", () => {
  const data = (p: ReviewPost): ReviewData => ({ briefId: "b1", posts: [p], allApproved: false });

  it("shows the strip instead of a separate cover, and marks the slide with an open item", () => {
    const f = slideFlag();
    const out = renderToString(createElement(ReviewScreen, { data: data(post({ flags: [f], openFlags: [f], canApprove: false })) }));
    expect(out).toContain("data-slide-strip");
    expect(out).toContain("data-slide-flag");
    expect(out).not.toMatch(/<figure[^>]*data-format/); // the cover is slide 1 of the strip
    expect(out).not.toContain("Carousel: 5 slides, one point each"); // that line is for the automatic split
  });

  it("an approved carousel offers Share for all slides", () => {
    const out = renderToString(createElement(ReviewScreen, { data: data(post({ status: "approved" })) }));
    expect(out).toContain("data-share");
    expect(out).toContain("data-share-trigger");
  });

  it("the automatic split of too many points keeps the cover and the old line", () => {
    const out = renderToString(createElement(ReviewScreen, { data: data(post({ carouselAsked: false, slides: urls.slice(0, 3) })) }));
    expect(out).toMatch(/<figure[^>]*data-format="portrait"/);
    expect(out).toContain("Carousel: 3 slides, one point each");
  });
});
