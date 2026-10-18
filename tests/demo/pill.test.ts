// The "Demo" pill in the app header during a demo session (docs/15-demo-login.md).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));

import { AppShell } from "@/components/app-shell/app-shell";
import { TopBar } from "@/components/app-shell/top-bar";

const base = { businessName: "Demo Bakery", signOutAction: async () => undefined };

describe("the Demo pill", () => {
  it("shows in the top bar and the app frame only for a demo session", () => {
    const bar = (demo?: boolean) => renderToString(createElement(TopBar, { ...base, demo, expanded: true, onToggle: () => undefined }));
    expect(bar(true)).toContain("data-demo-pill");
    expect(bar(true)).toMatch(/>Demo</);
    expect(bar(false)).not.toContain("data-demo-pill");
    expect(bar()).not.toContain("data-demo-pill");

    const shell = (demo?: boolean) => renderToString(createElement(AppShell, { ...base, demo }, createElement("p", null, "page")));
    expect(shell(true)).toContain("data-demo-pill");
    expect(shell()).not.toContain("data-demo-pill");
  });
});
