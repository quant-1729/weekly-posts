import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/app/(app)/brand/style-actions", () => ({ readLookAction: vi.fn(), keepLookAction: vi.fn() }));

import { KeepMyLookCard } from "@/components/brand/keep-look-card";
import { styleCopy } from "@/lib/style/copy";
import { fixtureStyleRead } from "@/lib/style/read";
import type { StyleResult } from "@/lib/style/read";
import { suggestKitDetailed } from "@/lib/style/kit";
import { KIT } from "./helpers";

const BRAND = "00000000-0000-4000-8000-000000000001";
const render = (initial: StyleResult | null) => renderToString(createElement(KeepMyLookCard, { brandId: BRAND, initial }));
const hasButton = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).test(html);
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

function result(over: Partial<StyleResult> = {}, confidence = 0.8): StyleResult {
  const read = { ...fixtureStyleRead([]), confidence };
  return {
    status: "ok",
    source: "instagram",
    read,
    suggestion: suggestKitDetailed(read, KIT, "instagram"),
    note: null,
    counts: { images: 8, fromInstagram: 8, fromPhotos: 0, websiteColors: 0 },
    usd: 0.01,
    ...over,
  };
}

describe("the Keep my look card", () => {
  it("starts with only the intro and the Read my look button: nothing is read on page load", () => {
    const html = text(render(null));
    expect(html).toContain(styleCopy.card.title);
    expect(html).toContain(styleCopy.card.read);
    expect(hasButton(html, styleCopy.card.keep)).toBe(false);
    expect(html).not.toContain(styleCopy.card.fresh);
    expect(html).not.toContain("<img");
  });

  it("shows the summary, swatches, theme and fonts, with Keep my look and Try a fresh look", () => {
    const r = result();
    const html = text(render(r));
    expect(html).toContain(r.read!.summary);
    for (const hex of Object.values(r.suggestion!.kit.colors)) expect(html).toContain(hex);
    expect(html).toContain("Clean");
    expect(html).toContain("Clean sans-serif");
    expect(html).toContain("8 of your Instagram pictures");
    expect(hasButton(html, "Keep my look")).toBe(true);
    expect(html).toContain(">Try a fresh look<");
  });

  it("says when a look could not be found, and offers only the fresh look", () => {
    const low = result({}, 0.2);
    const html = text(render({ ...low, note: low.suggestion!.message }));
    expect(html).toContain("We couldn't find one clear look; pick a theme instead.");
    expect(html).toContain(">Try a fresh look<");
    expect(hasButton(html, "Keep my look")).toBe(false);
  });

  it("says colours only when there were too few pictures", () => {
    const r = result({ status: "colors_only", source: "website", note: styleCopy.coloursOnly, counts: { images: 1, fromInstagram: 1, fromPhotos: 0, websiteColors: 1 } });
    const html = text(render(r));
    expect(html).toContain("fewer than 3 pictures");
    expect(html).toContain("your website colours");
  });
});
