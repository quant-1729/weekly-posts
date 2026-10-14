import { describe, expect, it } from "vitest";
import { STATES, faceFor, initialMachine, poseEvent, reduce, viewState, type MachineState, type TweenEvent, type TweenState } from "@/lib/tween/machine";

// Ported from the Tween kit's unit tests (state machine), minus the intro poses that Weekly Posts does not use.
describe("state machine", () => {
  const at = (state: TweenState, patch: Partial<MachineState> = {}): MachineState => ({ ...initialMachine, state, ...patch });
  const run = (m: MachineState, ...events: TweenEvent[]) => events.reduce(reduce, m);

  it("has the states Weekly Posts uses", () => {
    expect([...STATES].sort()).toEqual(["celebrate", "cover", "idle", "peek", "point", "shrug", "sleep", "talk", "think", "walk", "wave"]);
  });

  it("legal transitions from idle", () => {
    expect(run(at("idle"), { type: "WALK", dir: "right" })).toMatchObject({ state: "walk", facing: "right" });
    expect(run(at("idle"), { type: "WAVE" }).state).toBe("wave");
    expect(run(at("idle"), { type: "POINT", dir: "left" })).toMatchObject({ state: "point", pointDir: "left", facing: "left" });
    expect(run(at("idle"), { type: "POINT", dir: "up" })).toMatchObject({ state: "point", pointDir: "up" });
    expect(run(at("idle"), { type: "THINK" }).state).toBe("think");
    expect(run(at("idle"), { type: "CELEBRATE" }).state).toBe("celebrate");
    expect(run(at("idle"), { type: "SHRUG" }).state).toBe("shrug");
    expect(run(at("idle"), { type: "SAY_START" })).toMatchObject({ state: "talk", talking: true });
    expect(run(at("idle"), { type: "SLEEP" }).state).toBe("sleep");
    expect(run(at("idle"), { type: "HIDE" }).state).toBe("peek");
  });

  it("pose events settle back with DONE, to talk while a line is being said", () => {
    for (const s of ["wave", "point", "think", "shrug", "celebrate"] as const) {
      expect(run(at(s), { type: "DONE" }).state).toBe("idle");
      expect(run(at(s, { talking: true }), { type: "DONE" }).state).toBe("talk");
    }
    expect(run(at("walk"), { type: "ARRIVE" }).state).toBe("idle");
  });

  it("talking is layered: Tween can point while speaking, and SAY_END only ends the talk state", () => {
    const m = run(at("idle"), { type: "POINT", dir: "right" }, { type: "SAY_START" });
    expect(m).toMatchObject({ state: "point", talking: true });
    expect(run(m, { type: "SAY_END" })).toMatchObject({ state: "point", talking: false });
    expect(run(at("talk", { talking: true }), { type: "SAY_END" }).state).toBe("idle");
  });

  it("illegal events are ignored (the same object comes back)", () => {
    const walking = at("walk");
    expect(reduce(walking, { type: "WAVE" })).toBe(walking);
    expect(reduce(walking, { type: "POINT", dir: "left" })).toBe(walking);
    expect(reduce(walking, { type: "SLEEP" })).toBe(walking);
    const idle = at("idle");
    expect(reduce(idle, { type: "ARRIVE" })).toBe(idle);
    expect(reduce(idle, { type: "DONE" })).toBe(idle);
    expect(reduce(idle, { type: "SHOW" })).toBe(idle);
    expect(reduce(idle, { type: "SAY_END" })).toBe(idle);
    const asleep = at("sleep");
    expect(reduce(asleep, { type: "WALK", dir: "left" })).toBe(asleep);
    expect(reduce(asleep, { type: "CELEBRATE" })).toBe(asleep);
  });

  it("sleep only starts from a docked, quiet idle (the 60 second idle event)", () => {
    expect(reduce(at("idle", { docked: false }), { type: "SLEEP" }).state).toBe("idle");
    expect(reduce(at("idle", { talking: true }), { type: "SLEEP" }).state).toBe("idle");
    expect(reduce(at("wave"), { type: "SLEEP" }).state).toBe("wave");
    expect(reduce(at("think"), { type: "SLEEP" }).state).toBe("think");
  });

  it("sleep wakes on input, and on a line to say", () => {
    expect(run(at("sleep"), { type: "INPUT" }).state).toBe("idle");
    expect(run(at("sleep"), { type: "SAY_START" })).toMatchObject({ state: "talk", talking: true });
    expect(run(at("sleep"), { type: "WAVE" }).state).toBe("wave");
    expect(run(at("sleep"), { type: "HIDE" }).state).toBe("peek");
  });

  it("peek (hidden) accepts only SHOW", () => {
    const peek = at("peek");
    for (const e of [{ type: "WAVE" }, { type: "INPUT" }, { type: "SAY_START" }, { type: "WALK", dir: "left" }, { type: "SLEEP" }] as TweenEvent[]) expect(reduce(peek, e)).toBe(peek);
    expect(reduce(peek, { type: "SHOW" }).state).toBe("idle");
  });

  it("reduced motion never walks and stops a walk in progress; the view shows a still pose", () => {
    const reduced = run(at("idle"), { type: "CONTEXT", reduced: true, docked: true });
    expect(reduce(reduced, { type: "WALK", dir: "right" }).state).toBe("idle");
    const walking = at("walk", { talking: false });
    const stopped = reduce(walking, { type: "CONTEXT", reduced: true, docked: false });
    expect(stopped.state).toBe("idle");
    expect(viewState({ ...walking, reduced: true })).toBe("idle");
    expect(viewState(walking)).toBe("walk");
    // other poses are kept as still poses
    expect(reduce(reduced, { type: "CELEBRATE" }).state).toBe("celebrate");
  });

  it("each state has a face, and dialogue poses map to events", () => {
    expect(faceFor("sleep")).toBe("sleep");
    expect(faceFor("celebrate")).toBe("joy");
    expect(faceFor("think")).toBe("think");
    expect(faceFor("shrug")).toBe("worried");
    expect(faceFor("wave")).toBe("happy");
    expect(faceFor("idle")).toBe("neutral");
    expect(poseEvent("think", "up")).toEqual({ type: "THINK" });
    expect(poseEvent("celebrate", "up")).toEqual({ type: "CELEBRATE" });
    expect(poseEvent("point", "left")).toEqual({ type: "POINT", dir: "left" });
    expect(poseEvent("talk", "up")).toBeNull();
  });
});
