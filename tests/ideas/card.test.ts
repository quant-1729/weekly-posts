// The Competitors card on the Brand page (R-1), rendered to HTML with react-dom/server (no DOM library here).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/brand/competitors-actions", () => ({
  addCompetitorAction: vi.fn(),
  updateCompetitorAction: vi.fn(),
  deleteCompetitorAction: vi.fn(),
  saveResearchSettingsAction: vi.fn(),
}));

import { CompetitorsCard } from "@/components/brand/competitors-card";
import { MAX_COMPETITORS, type Competitor } from "@/lib/ideas/types";

const comp = (i: number): Competitor => ({ id: `00000000-0000-0000-0000-00000000000${i}`, brandId: "b", name: `Rival ${i}`, website: i === 1 ? "https://rival.example.com/" : null, instagramHandle: i === 1 ? "rival.bakes" : null, youtubeHandle: null });
const render = (items: Competitor[], focus = "", on = true) => renderToString(createElement(CompetitorsCard, { brandId: "b", items, focus, researchOn: on }));

describe("the Competitors card", () => {
  it("with none shows the empty note, the add form and the research settings", () => {
    const html = render([]);
    expect(html).toContain("No competitors added yet.");
    expect(html).toContain("Add competitor");
    expect(html).toContain("Look for trends every week");
    expect(html).toContain("Research focus (optional)");
    expect(html).toContain(`up to ${MAX_COMPETITORS} businesses`);
  });

  it("lists competitors with their website and Instagram, and the count", () => {
    const html = render([comp(1), comp(2)], "wedding cakes");
    expect(html).toContain("Rival 1");
    expect(html).toContain("https://rival.example.com/");
    expect(html).toContain("Instagram @rival.bakes");
    expect(html).toContain(`2 of ${MAX_COMPETITORS}`);
    expect(html).toContain('value="wedding cakes"');
    expect(html).toContain(">Edit<");
    expect(html).toContain(">Remove<");
  });

  it("at the limit hides the add form and says why", () => {
    const html = render(Array.from({ length: MAX_COMPETITORS }, (_, i) => comp(i + 1)));
    expect(html).not.toContain("Add competitor");
    expect(html).toContain(`You have ${MAX_COMPETITORS} competitors`);
  });

  it("every input has an accessible name and the switch reflects the saved choice", () => {
    for (const on of [true, false]) {
      const html = render([comp(1)], "", on);
      const labelled = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
      const unnamed = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((tag) => !/type="checkbox"/.test(tag) && !labelled.has(/\bid="([^"]+)"/.exec(tag)?.[1] ?? ""));
      expect(unnamed).toEqual([]);
      expect(/type="checkbox"[^>]*checked/.test(html) || /checked[^>]*type="checkbox"/.test(html)).toBe(on);
    }
  });
});
