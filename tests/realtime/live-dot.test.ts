// The small green "Live" dot: shown only while a screen is live.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveDot } from "@/components/live/live-dot";
import { s } from "@/lib/i18n/strings";

describe("LiveDot", () => {
  it("renders nothing when not live", () => {
    expect(renderToStaticMarkup(createElement(LiveDot, { live: false }))).toBe("");
  });

  it("shows a Live label with the explanatory title when live", () => {
    const html = renderToStaticMarkup(createElement(LiveDot, { live: true }));
    expect(html).toContain(s.live.label);
    expect(html).toContain(`title="${s.live.title}"`);
    expect(s.live.title).toBe("Updates appear here as they happen");
    expect(html).toContain("bg-ok-bg");
    expect(html).toContain('aria-hidden="true"');
  });
});
