import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/create/[briefId]/actions", () => ({ logShareAction: vi.fn() }));

import { SharePanel } from "@/components/create/share-panel";

const images = [
  { format: "square" as const, url: "/api/files/renders/b/p1/square.png?v=1" },
  { format: "portrait" as const, url: "/api/files/renders/b/p1/portrait.png?v=1" },
];
const render = (over: Record<string, unknown> = {}) => renderToString(createElement(SharePanel, { briefId: "b1", postId: "p1", channel: "instagram", images, shareText: "Cake week!", defaultOpen: true, ...over }));

describe("the share menu offers the PDF", () => {
  it("Download PDF is the first item and points at the PDF route for this post", () => {
    const out = render();
    expect(out).toMatch(/<a[^>]*href="\/api\/posts\/b1\/pdf\?post=p1"[^>]*download="instagram-post\.pdf"[^>]*data-download-pdf[^>]*>Download PDF</);
    const items = [...out.matchAll(/role="menuitem"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(items[0]).toBe("Download PDF"); // Share on phone joins it only where the browser can share files
    expect(items).toContain("Download images");
    expect(items).toContain("Copy caption");
  });

  it("the single-picture links move under one 'Download images' item", () => {
    const out = render();
    expect(out).toContain("data-download-images");
    expect(out).not.toContain(">Download square<");
    expect(out).not.toMatch(/<a[^>]*href="\/api\/files\//);
  });

  it("a carousel keeps one images item for all slides, next to the PDF", () => {
    const out = render({ slides: ["/api/files/renders/b/s1/portrait.png", "/api/files/renders/b/s2/portrait.png"] });
    expect(out).toContain("Download PDF");
    expect(out).toMatch(/data-download-all[^>]*>Download images</);
  });

  it("without a brief id (old callers) the menu is as before", () => {
    const out = render({ briefId: undefined });
    expect(out).not.toContain("Download PDF");
    expect(out).toContain(">Download square<");
  });
});
