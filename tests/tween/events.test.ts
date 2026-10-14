import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTweenContent } from "@/lib/tween/bundle";
import { RECENT_MS, SIGNAL_EVENT, TIMING, planForEvent, recentSignal, talkMs, tweenSignal, type TweenSignalDetail } from "@/lib/tween/events";
import { initialMachine, poseEvent, reduce, type MachineState, type TweenEvent } from "@/lib/tween/machine";
import { TWEEN_EVENTS } from "@/lib/tween/types";

const content = loadTweenContent();

/** Plays an event's plan into the machine the way Tween.tsx does: wake, settle, pose, then the hold ends. */
function play(m: MachineState, event: (typeof TWEEN_EVENTS)[number]): { during: MachineState; after: MachineState } {
  const plan = planForEvent(content, event)!;
  if (plan.kind === "sleep") {
    const s = reduce(m, { type: "SLEEP" });
    return { during: s, after: s };
  }
  let s = reduce(reduce(m, { type: "INPUT" }), { type: "DONE" });
  const ev = poseEvent(plan.pose, "up");
  if (ev) s = reduce(s, ev);
  return { during: s, after: reduce(s, { type: "DONE" }) };
}

describe("event to state mapping", () => {
  it("covers every event the brief lists", () => {
    expect([...TWEEN_EVENTS].sort()).toEqual(["all_approved", "approved", "generate_failed", "generating", "idle", "posts_ready", "setup_done", "setup_started"]);
    for (const e of TWEEN_EVENTS) expect(planForEvent(content, e), e).not.toBeNull();
  });

  it("generating: think, hold until the next event, say the writing line", () => {
    const p = planForEvent(content, "generating")!;
    expect(p).toMatchObject({ kind: "react", pose: "think", holdMs: null, say: "Writing your posts. This takes about a minute.", sayAfterMs: 0 });
    expect(play(initialMachine, "generating").during.state).toBe("think");
  });

  it("posts_ready: celebrate first, then talk the ready line", () => {
    const p = planForEvent(content, "posts_ready")!;
    expect(p).toMatchObject({ kind: "react", pose: "celebrate", holdMs: TIMING.celebrate, say: "Your posts are ready. Look for anything marked 'Please check'.", sayAfterMs: TIMING.celebrate });
    expect(play(initialMachine, "posts_ready").during.state).toBe("celebrate");
  });

  it("generate_failed: shrug and a short line", () => {
    const p = planForEvent(content, "generate_failed")!;
    expect(p).toMatchObject({ kind: "react", pose: "shrug", sayAfterMs: 0 });
    expect(p.kind === "react" && p.say).toBeTruthy();
    expect(play(initialMachine, "generate_failed").during.state).toBe("shrug");
  });

  it("approved: a short celebrate and no bubble", () => {
    const p = planForEvent(content, "approved")!;
    expect(p).toMatchObject({ kind: "react", pose: "celebrate", say: null });
    expect(play(initialMachine, "approved").during.state).toBe("celebrate");
  });

  it("all_approved: celebrate, then the week-done line", () => {
    expect(planForEvent(content, "all_approved")).toMatchObject({ kind: "react", pose: "celebrate", say: "That's the week done.", sayAfterMs: TIMING.celebrate });
  });

  it("setup_started: a wave greeting; setup_done: a celebrate", () => {
    const start = planForEvent(content, "setup_started")!;
    expect(start).toMatchObject({ kind: "react", pose: "wave" });
    expect(start.kind === "react" && start.say).toBeTruthy();
    expect(play(initialMachine, "setup_started").during.state).toBe("wave");
    expect(planForEvent(content, "setup_done")).toMatchObject({ kind: "react", pose: "celebrate", say: null });
    expect(play(initialMachine, "setup_done").during.state).toBe("celebrate");
  });

  it("idle: sleep, docked only", () => {
    expect(planForEvent(content, "idle")).toEqual({ kind: "sleep" });
    expect(play(initialMachine, "idle").during.state).toBe("sleep");
    expect(play({ ...initialMachine, docked: false }, "idle").during.state).toBe("idle");
    // a held thinking pose is not interrupted by the idle timer
    const thinking = reduce(initialMachine, { type: "THINK" });
    expect(play(thinking, "idle").during.state).toBe("think");
  });

  it("an event wakes a sleeping Tween, and the hold ends back at rest", () => {
    const asleep: MachineState = { ...initialMachine, state: "sleep" };
    expect(play(asleep, "posts_ready").during.state).toBe("celebrate");
    expect(play(initialMachine, "posts_ready").after.state).toBe("idle");
    // reduced motion keeps the pose as a still pose
    const reduced = reduce(initialMachine, { type: "CONTEXT", reduced: true, docked: true } as TweenEvent);
    expect(play(reduced, "posts_ready").during.state).toBe("celebrate");
  });

  it("a line is spoken for about as long as it takes to read, within bounds", () => {
    expect(talkMs("Hi")).toBe(1200);
    expect(talkMs("x".repeat(500))).toBe(5000);
    expect(talkMs("Your posts are ready. Look for anything marked 'Please check'.")).toBeGreaterThan(talkMs("Hi"));
  });

  it("a held pose is released after a safety limit", () => {
    expect(TIMING.holdMax).toBeGreaterThan(60_000);
  });
});

describe("tweenSignal", () => {
  const original = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    if (original === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = original;
    vi.useRealTimers();
  });

  it("does nothing on the server", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => tweenSignal("posts_ready")).not.toThrow();
  });

  it("dispatches a window CustomEvent with the event name and keeps the last one for a late-loading Tween", () => {
    const seen: TweenSignalDetail[] = [];
    const win: { __tweenLast?: TweenSignalDetail; dispatchEvent: (e: Event) => boolean } = {
      dispatchEvent: (e) => {
        expect(e.type).toBe(SIGNAL_EVENT);
        seen.push((e as CustomEvent<TweenSignalDetail>).detail);
        return true;
      },
    };
    (globalThis as { window?: unknown }).window = win;
    tweenSignal("generating", { weekStart: "x" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ event: "generating", detail: { weekStart: "x" } });
    expect(win.__tweenLast).toBe(seen[0]);
  });

  it("replays only a recent signal", () => {
    const at = 1_000_000;
    const sig: TweenSignalDetail = { event: "setup_started", at };
    expect(recentSignal(sig, at + 100)).toBe(sig);
    expect(recentSignal(sig, at + RECENT_MS)).toBe(sig);
    expect(recentSignal(sig, at + RECENT_MS + 1)).toBeNull();
    expect(recentSignal(undefined, at)).toBeNull();
  });
});
