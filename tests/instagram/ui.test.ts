import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/components/instagram/actions", () => ({
  importInstagramAction: vi.fn(),
  refreshInstagramAction: vi.fn(),
  removeInstagramPostsAction: vi.fn(),
  loadInstagramImagesAction: vi.fn(),
  addInstagramPhotosAction: vi.fn(),
}));
vi.mock("@/components/uploads/actions", () => ({
  removePhotoAction: vi.fn(),
  setHasPeopleAction: vi.fn(),
  addPastPostTextAction: vi.fn(),
  updatePastPostTextAction: vi.fn(),
  removePastPostAction: vi.fn(),
}));

import { InstagramCard, instagramStatusLine } from "@/components/instagram/instagram-card";
import { PastPosts } from "@/components/uploads/past-posts";
import { fill, s } from "@/lib/i18n/strings";
import type { InstagramState } from "@/lib/instagram/import";

const BRAND = "00000000-0000-4000-8000-000000000001";
const base: InstagramState = { available: true, handle: null, handleSource: null, status: null, checkedAt: null, importedPosts: 0 };
const render = (state: Partial<InstagramState>) => renderToString(createElement(InstagramCard, { brandId: BRAND, initial: { ...base, ...state } }));
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("the Instagram card", () => {
  it("shows the field, the own-account line and the import button when nothing is saved yet", () => {
    const html = text(render({}));
    expect(html).toContain(s.instagram.title);
    expect(html).toContain(s.instagram.ownAccount);
    expect(html).toContain(s.instagram.bring);
    expect(html).toContain(`placeholder="${s.instagram.placeholder}"`);
    expect(html).not.toContain(s.instagram.refresh);
    expect(html).not.toContain(s.instagram.remove);
    expect(html).not.toContain("role=\"status\"");
  });

  it("prefills the @name and shows the result, with Refresh, Remove and the picture chooser once imported", () => {
    const html = text(render({ handle: "cornerbakery", status: "imported", importedPosts: 12, handleSource: "owner" }));
    expect(html).toContain('value="@cornerbakery"');
    expect(html).toContain("12 posts from @cornerbakery added to your past posts");
    expect(html).toContain(s.instagram.refresh);
    expect(html).toContain(s.instagram.remove);
    expect(html).toContain(s.instagram.photos.show);
    // Nothing is loaded from Instagram while rendering: no pictures until the owner asks.
    expect(html).not.toContain("<img");
  });

  it("says each outcome in plain words", () => {
    const line = (st: Partial<InstagramState>) => text(instagramStatusLine({ handle: "shop", status: null, importedPosts: 0, ...st }) ?? "");
    expect(line({ status: "imported", importedPosts: 12 })).toBe("12 posts from @shop added to your past posts");
    expect(line({ status: "imported", importedPosts: 1 })).toBe("1 post from @shop added to your past posts");
    expect(line({ status: "imported", importedPosts: 0 })).toContain("none of its captions were long enough");
    expect(line({ status: "not_business" })).toBe("That's a personal account, so Instagram doesn't share its posts. Add screenshots instead.");
    expect(line({ status: "not_found" })).toContain("We couldn't find @shop.");
    expect(line({ status: "unavailable" })).toBe("Instagram import isn't switched on yet. Add screenshots instead.");
    expect(line({ status: "failed" })).toContain("didn't answer");
    expect(line({ status: "found" })).toBe("We found @shop on your website.");
    expect(instagramStatusLine({ handle: null, status: null, importedPosts: 0 })).toBeNull();
  });

  it("without Meta settings it offers only to save the name, with the fallback line", () => {
    const html = text(render({ available: false, handle: "cornerbakery", status: "unavailable" }));
    expect(html).toContain(s.instagram.save);
    expect(html).not.toContain(s.instagram.bring);
    expect(html).not.toContain(s.instagram.refresh);
    expect(html).not.toContain(s.instagram.photos.show);
    expect(html).toContain("Instagram import isn't switched on yet. Add screenshots instead.");
    expect(html).toContain('value="@cornerbakery"');
  });

  it("shows a name found on the website so the owner can accept or change it", () => {
    const html = text(render({ handle: "shopsite", handleSource: "website", status: "found" }));
    expect(html).toContain("We found @shopsite on your website.");
    expect(html).toContain('value="@shopsite"');
    expect(html).toContain(s.instagram.bring);
  });
});

describe("past posts from Instagram", () => {
  const post = (over: Record<string, unknown>) => ({
    id: "p1",
    text: "Fresh bread today",
    storagePath: null,
    imageUrl: null,
    createdAt: "2026-10-13T00:00:00.000Z",
    source: "upload" as const,
    sourceUrl: null,
    ...over,
  });
  const html = (posts: ReturnType<typeof post>[]) => text(renderToString(createElement(PastPosts, { brandId: BRAND, initialPosts: posts })));

  it("tags them 'From Instagram' with a link to the original post", () => {
    const out = html([post({ source: "instagram", sourceUrl: "https://www.instagram.com/p/AAA/" }), post({ id: "p2", text: "Pasted myself" })]);
    expect(out).toContain(s.instagram.tag);
    expect(out).toContain('href="https://www.instagram.com/p/AAA/"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out.split(s.instagram.tag).length - 1).toBe(1); // only the Instagram one
  });

  it("does not count Instagram posts against the owner's own ten", () => {
    const many = Array.from({ length: 12 }, (_, i) => post({ id: `i${i}`, source: "instagram", sourceUrl: null }));
    const out = html(many);
    expect(out).toContain(fill(s.uploads.pastPosts.count, { n: 0, max: 10 }));
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Paste text/);
  });
});
