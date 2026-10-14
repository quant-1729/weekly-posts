import { describe, expect, it } from "vitest";
import { expandLines, findAction, nudgeFor, plainLine, resolveNode, tipFor } from "@/lib/tween/dialogue";
import { canSpeak, emptyBudget, newPageView, spend, type Blockers } from "@/lib/tween/limits";
import { loadTweenContent } from "@/lib/tween/bundle";

const content = loadTweenContent();

describe("dialogue runner", () => {
  it("tokens expand; tips and nudges are route aware", () => {
    expect(expandLines(["a", "{tip}"], { tip: "T" })).toEqual(["a", "T"]);
    expect(expandLines(["{tip}"], { tip: "" })).toEqual([]);
    expect(tipFor(content, "/week")).toBe(content.tips["/week"]![0]);
    expect(tipFor(content, "/nowhere")).toBe(content.tips.default![0]);
    expect(nudgeFor(content, "/week")).toBeTruthy();
    expect(nudgeFor(content, "/history")).toBeNull();
    expect(resolveNode(content, "missing", { tip: "" })).toBeNull();
  });

  it("the first bubble offers the entry points, with More for the rest", () => {
    const root = resolveNode(content, content.start, { tip: "A tip." })!;
    expect(root.pose).toBe("wave");
    expect(root.lines).toContain("A tip.");
    expect(root.choices.map((c) => c.label)).toEqual(["How does this work?", "Make this week's posts", "What does 'Please check' mean?", "More"]);
    const more = resolveNode(content, "more", { tip: "" })!;
    expect(more.choices.map((c) => c.label)).toEqual(expect.arrayContaining(["How do I post them?", "Edit my brand details", "Just looking"]));
  });

  it("'Make this week's posts' goes to /week and points at the generate button", () => {
    const r = resolveNode(content, "make", { tip: "" })!;
    expect(findAction(r.actions, "goto")).toEqual({ goto: "/week" });
    expect(findAction(r.actions, "point")).toEqual({ point: "generate" });
    expect(r.pose).toBe("point");
  });

  it("'Edit my brand details' goes to /brand; 'Just looking' waves and goes quiet", () => {
    expect(findAction(resolveNode(content, "brand", { tip: "" })!.actions, "goto")).toEqual({ goto: "/brand" });
    const browse = resolveNode(content, "browse", { tip: "" })!;
    expect(browse.pose).toBe("wave");
    expect(findAction(browse.actions, "quiet")).toEqual({ quiet: true });
  });

  it("plain text collapses whitespace", () => {
    expect(plainLine("People   decide.  ")).toBe("People decide.");
  });
});

describe("limits on unprompted behaviour", () => {
  const free: Blockers = { dialogOpen: false, typing: false, panelOpen: false };
  it("one per page view, three per session, each kind once", () => {
    let b = emptyBudget;
    expect(canSpeak(b, "greeting", free)).toBe(true);
    b = spend(b, "greeting");
    expect(canSpeak(b, "tip", free)).toBe(false); // same page view
    b = newPageView(b);
    expect(canSpeak(b, "greeting", free)).toBe(false); // already greeted
    expect(canSpeak(b, "tip", free)).toBe(true);
    b = spend(b, "tip");
    b = newPageView(b);
    expect(canSpeak(b, "tip", free)).toBe(false);
    expect(canSpeak(b, "nudge", free)).toBe(true);
    b = spend(b, "nudge");
    b = newPageView(b);
    expect(b.sessionCount).toBe(3);
    expect(canSpeak(b, "nudge", free)).toBe(false);
    expect(canSpeak({ ...emptyBudget, sessionCount: 3 }, "greeting", free)).toBe(false);
  });
  it("never while something else is active, never after hide or quiet", () => {
    for (const k of ["dialogOpen", "typing", "panelOpen"] as const) expect(canSpeak(emptyBudget, "greeting", { ...free, [k]: true })).toBe(false);
    expect(canSpeak({ ...emptyBudget, hidden: true }, "greeting", free)).toBe(false);
    expect(canSpeak({ ...emptyBudget, quiet: true }, "greeting", free)).toBe(false);
  });
});
