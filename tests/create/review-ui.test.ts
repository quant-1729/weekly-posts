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

import { CaptionEditor, ReviewCaptions } from "@/components/create/review-captions";
import { ReviewChecks } from "@/components/create/review-checks";
import { ReviewScreen } from "@/components/create/review-screen";
import { SharePanel } from "@/components/create/share-panel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ReviewData, ReviewPost } from "@/lib/create";
import type { Flag } from "@/lib/guardrail";

const flag = (over: Partial<Flag> = {}): Flag => ({ id: "f1", text: "£3.99", kind: "price", field: "caption", layer: "code", regulated: false, highlight: true, status: "open", decided_at: null, ...over });

const post = (over: Partial<ReviewPost> = {}): ReviewPost => ({
  id: "p1",
  channel: "instagram",
  label: "Instagram",
  status: "draft",
  caption: "Cake week! Only £3.99 today.",
  hashtags: ["#cakes", "#fresh"],
  hashtagsMax: 8,
  captionMax: 1200,
  cta: "Visit us",
  headline: "Cake week",
  flags: [],
  openFlags: [],
  reminder: false,
  blockers: [],
  images: [
    { format: "square", url: "/api/files/renders/b/p1/square.png?v=1" },
    { format: "portrait", url: "/api/files/renders/b/p1/portrait.png?v=1" },
  ],
  slides: [],
  carouselAsked: false,
  shareText: "Cake week!",
  designed: true,
  canApprove: true,
  ...over,
});

const noop = () => undefined;
const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el);

describe("the compact checks", () => {
  const withFlags = (flags: Flag[]) => post({ flags, openFlags: flags, canApprove: false });
  const render = (p: ReviewPost, defaultOpenId?: string) =>
    html(createElement(ReviewChecks, { post: p, briefId: "b1", busy: false, acks: {}, setAcks: noop, onConfirm: noop, onRemove: noop, onEditCaption: noop, defaultOpenId }));

  it("one line per item: icon, kind and text, and small It's true / Remove actions; details are collapsed", () => {
    const out = render(withFlags([flag(), flag({ id: "f2", text: "heals fast", kind: "claim", field: "image_text.headline" })]));
    expect((out.match(/<li /g) ?? []).length).toBe(2);
    expect((out.match(/It&#x27;s true/g) ?? []).length).toBe(2);
    expect((out.match(/>Remove</g) ?? []).length).toBe(2);
    expect(out).toContain("Price");
    expect(out).toContain("£3.99");
    expect((out.match(/<svg /g) ?? []).length).toBe(2); // one icon each
    expect(out).toContain('aria-expanded="false"');
    expect(out).toMatch(/<div id="[^"]+" hidden=""[^>]*data-flag-details/);
    // No big cards: no intro paragraph, no large primary buttons.
    expect(out).not.toContain("We could not find these in your brand details");
    expect(out).not.toMatch(/min-h-9[^"]*bg-ink/);
  });

  it("clicking the text shows the details (where it is)", () => {
    const out = render(withFlags([flag()]), "f1");
    expect(out).toContain('aria-expanded="true"');
    expect(out).not.toMatch(/id="[^"]+" hidden=""[^>]*data-flag-details/);
    expect(out).toContain("In the caption");
  });

  it("a health, money or education claim keeps its extra tick in the details", () => {
    const out = render(withFlags([flag({ regulated: true, kind: "claim" })]), "f1");
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("I confirm this is true and I can prove it");
  });

  it("a flag that can not be cut out offers Edit instead of Remove (Edit opens the caption fields)", () => {
    const out = render(withFlags([flag({ highlight: false })]));
    expect(out).not.toContain(">Remove<");
    expect(out).toContain(">Edit<");
  });

  it("renders nothing when nothing is open", () => {
    expect(render(post())).toBe("");
  });
});

describe("caption and hashtags", () => {
  const posts = [post(), post({ id: "p2", channel: "whatsapp", label: "WhatsApp", caption: "WhatsApp words", hashtags: [], hashtagsMax: 0 })];
  const render = (over: Record<string, unknown> = {}) =>
    html(createElement(ReviewCaptions, { posts, channel: "instagram", editing: false, busy: false, onChannel: noop, onEditing: noop, onSave: async () => null, ...over }));

  it("shows the channel's caption and hashtags with a small Edit button (pencil, aria-label)", () => {
    const out = render();
    expect(out).toContain("Cake week! Only £3.99 today.");
    expect(out).toContain("#cakes #fresh");
    expect(out).toMatch(/<button[^>]*aria-label="Edit caption"[^>]*data-edit-caption/);
    expect(out).not.toContain("<textarea");
    expect(out).not.toContain("WhatsApp words"); // one channel at a time
  });

  it("a segmented control switches channels (only when there is more than one)", () => {
    const out = render({ channel: "whatsapp" });
    expect(out).toMatch(/data-channel-option="instagram"[^>]*>Instagram</);
    expect(out).toMatch(/aria-pressed="true"[^>]*data-channel-option="whatsapp"/);
    expect(out).toContain("WhatsApp words");
    expect(out).not.toContain("#cakes");
    expect(render({ posts: [posts[0]] })).not.toContain("data-channel-switch");
  });

  it("Edit turns them into fields with Save and Cancel; the character count and the hashtag limit are shown", () => {
    const out = render({ editing: true });
    expect(out).toContain("<textarea");
    expect(out).toContain("Cake week! Only £3.99 today.");
    expect(out).toMatch(/<input[^>]*value="#cakes #fresh"/);
    expect(out).toContain(">Save<");
    expect(out).toContain(">Cancel<");
    expect(out).toContain("28/1200");
    expect(out).toContain("up to 8");
    expect(out).not.toContain("data-edit-caption");
    expect(out).toMatch(/<label[^>]*for="caption-p1"[^>]*>Caption<\/label>/);
  });

  it("a channel without hashtags says so instead of showing a hashtag field", () => {
    const out = html(createElement(CaptionEditor, { post: posts[1], busy: false, onCancel: noop, onSave: async () => null }));
    expect(out).toContain("<textarea");
    expect(out).not.toContain("data-hashtags-input");
    expect(out).toContain("WhatsApp posts do not use hashtags.");
  });
});

describe("the share menu", () => {
  const render = (over: Record<string, unknown> = {}) =>
    html(createElement(SharePanel, { postId: "p1", channel: "instagram", images: post().images, shareText: "Cake week!", ...over }));

  it("is one small Share icon button; the menu is collapsed and hidden", () => {
    const out = render();
    expect(out).toMatch(/<button[^>]*aria-label="Share"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    expect(out).toMatch(/<div[^>]*role="menu"[^>]*hidden=""/);
    expect((out.match(/aria-label="Share"/g) ?? []).length).toBe(1);
    expect(out).not.toContain(">Share square<");
  });

  it("open, it offers Download for each size and Copy caption (Share on phone appears where the browser can share files)", () => {
    const out = render({ defaultOpen: true });
    expect(out).toContain('aria-expanded="true"');
    expect(out).not.toMatch(/<div[^>]*role="menu"[^>]*hidden=""/);
    expect(out).toContain(">Download square<");
    expect(out).toContain(">Download portrait<");
    expect(out).toContain(">Copy caption<");
    expect((out.match(/role="menuitem"/g) ?? []).length).toBe(3); // no phone sharing on the server
    expect(out).toMatch(/<a[^>]*href="\/api\/files\/renders\/b\/p1\/square\.png\?v=1"[^>]*download=/);
  });
});

describe("the Undo all dialog", () => {
  const render = (over: Record<string, unknown> = {}) =>
    html(createElement(ConfirmDialog, { open: false, title: "Undo all changes?", body: "All your edits to this post will be lost.", confirmLabel: "Undo all", cancelLabel: "Cancel", onConfirm: noop, onClose: noop, ...over }));

  it("is an alert dialog named and described by its own text, with Cancel first and then Undo all", () => {
    const out = render();
    expect(out).toMatch(/<dialog[^>]*role="alertdialog"/);
    const labelledby = /aria-labelledby="([^"]+)"/.exec(out)![1];
    const describedby = /aria-describedby="([^"]+)"/.exec(out)![1];
    expect(out).toMatch(new RegExp(`id="${labelledby}"[^>]*>Undo all changes\\?<`));
    expect(out).toMatch(new RegExp(`id="${describedby}"[^>]*>All your edits to this post will be lost\\.<`));
    expect(out.indexOf("data-dialog-cancel")).toBeLessThan(out.indexOf("data-dialog-confirm"));
    expect(out).toMatch(/data-dialog-cancel[^>]*>Cancel</);
    expect(out).toMatch(/data-dialog-confirm[^>]*>Undo all</);
    expect(out).not.toMatch(/<dialog[^>]*\sopen/); // closed until the button is pressed (opened with showModal)
  });

  it("while it works both buttons are disabled", () => {
    expect(render({ busy: true }).match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("the review screen", () => {
  const data: ReviewData = {
    briefId: "b1",
    allApproved: false,
    posts: [post({ openFlags: [flag()], flags: [flag()], canApprove: false }), post({ id: "p2", channel: "facebook", label: "Facebook", caption: "Facebook words", hashtagsMax: 3, hashtags: [] })],
  };
  const out = html(createElement(ReviewScreen, { data }));

  it("has the Undo all button, the dialog, one caption section with a channel switch, and compact checks", () => {
    expect(out).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*data-undo-all/);
    expect(out).toContain("Undo all");
    expect(out).toContain('role="alertdialog"');
    expect((out.match(/data-captions/g) ?? []).length).toBe(1);
    expect(out).toContain("data-channel-switch");
    expect(out).toContain("data-flags");
    expect(out).toContain("Edit caption");
  });

  it("an approved post has the one Share icon and Undo approval, not three buttons", () => {
    const approved = html(createElement(ReviewScreen, { data: { ...data, posts: [post({ status: "approved" })] } }));
    expect(approved).toContain('aria-label="Share"');
    expect(approved).toContain("Undo approval");
    expect(approved).not.toContain("data-approve");
  });

  it("a posted post can not be undone as a whole", () => {
    const posted = html(createElement(ReviewScreen, { data: { ...data, posts: [post({ status: "posted" })] } }));
    expect(posted).not.toContain("data-undo-all");
  });
});
