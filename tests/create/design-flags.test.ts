import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/create/[briefId]/actions", () => ({ confirmAllFlagsAction: vi.fn() }));

import { DesignFlags } from "@/components/create/design-flags";
import type { Flag } from "@/lib/guardrail";

const flag = (over: Partial<Flag> = {}): Flag => ({ id: "f1", text: "£3.99", kind: "price", field: "caption", layer: "code", regulated: false, highlight: true, status: "open", decided_at: null, ...over });
const entry = (f: Flag) => ({ flag: f, channels: ["instagram"] });
const render = (flags: Flag[], over: Record<string, unknown> = {}) => renderToString(createElement(DesignFlags, { briefId: "b1", flags: flags.map(entry), ...over }));

describe("the design step's Please check box", () => {
  const flags = [flag(), flag({ id: "f2", text: "Best in town", kind: "claim", slide: 2, field: "image_text.headline" }), flag({ id: "f3", text: "cake week is here today", kind: "repeat" })];

  it("lists the flags and has one 'These are all fine' button (secondary style)", () => {
    const out = render(flags);
    expect(out).toContain("We could not find these in your details.");
    expect((out.match(/<li /g) ?? []).length).toBe(3);
    expect(out).toContain("Slide 3");
    expect(out).toContain("Same wording as a recent post");
    expect((out.match(/data-flags-all-fine/g) ?? []).length).toBe(1);
    expect(out).toMatch(/<button[^>]*data-flags-all-fine[^>]*>These are all fine</);
    expect(out).toContain("bg-fill-secondary");
  });

  it("the confirm dialog asks 'Confirm these lines?' with Cancel and Confirm", () => {
    const out = render(flags);
    expect(out).toMatch(/<dialog[^>]*role="alertdialog"/);
    expect(out).toContain("Confirm these lines?");
    expect(out).toContain("You confirm every line above is correct and can stay on your post.");
    expect(out).not.toContain("health, money or education");
    expect(out).toMatch(/data-dialog-cancel[^>]*>Cancel</);
    expect(out).toMatch(/data-dialog-confirm[^>]*>Confirm</);
    expect(out).not.toMatch(/<dialog[^>]*\sopen/);
  });

  it("adds the regulated sentence when a line needs the extra tick", () => {
    const out = render([...flags, flag({ id: "f4", text: "heals fast", kind: "claim", regulated: true })]);
    expect(out).toContain("You confirm every line above is correct and can stay on your post. Some lines are about health, money or education: you confirm you can show them.");
  });

  it("a word to avoid has no button: it cannot be confirmed", () => {
    const out = render([flag({ id: "a1", text: "cheap", kind: "avoid" })]);
    expect(out).not.toContain("data-flags-all-fine");
  });

  it("after the confirm the box is gone (a quiet note is left); flags left open stay in the box", () => {
    const done = render(flags, { defaultLeft: [] });
    expect(done).not.toContain("data-flags-box");
    expect(done).not.toContain("data-flags-all-fine");
    expect(done).not.toContain("<li ");
    expect(done).toContain("Confirmed. Nothing left to check.");
    const some = render([...flags, flag({ id: "a1", text: "cheap", kind: "avoid" })], { defaultLeft: ["a1"] });
    expect(some).toContain("data-flags-box");
    expect((some.match(/<li /g) ?? []).length).toBe(1);
    expect(some).toContain("cheap");
    expect(some).not.toContain("data-flags-all-fine");
  });

  it("with no flags it says nothing needs checking", () => {
    expect(render([])).toContain("Nothing to check.");
  });
});
