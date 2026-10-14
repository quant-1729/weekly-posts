/**
 * Tween's state machine: pure, no DOM. `(state, event) -> state`.
 *
 * Eleven named states (the kit's ten plus the email-field `cover` gag). Illegal events are ignored (the same object is returned, so callers can detect a no-op).
 * `talking` is a flag layered on top of the state: Tween can point while its mouth moves.
 * Reduced motion and "paused" both map to `reduced`: Tween never enters `walk`, and the view shows a still pose.
 */
export const STATES = ["idle", "walk", "wave", "point", "talk", "think", "celebrate", "sleep", "peek", "shrug", "cover"] as const;
export type TweenState = (typeof STATES)[number];
export type Dir = "left" | "right";
export type PointDir = Dir | "up";

export type MachineState = {
  state: TweenState;
  /** Direction Tween faces (walk direction, or the side it points to). */
  facing: Dir;
  pointDir: PointDir;
  talking: boolean;
  /** Reduced motion or paused: no walking, no loops. */
  reduced: boolean;
  /** Docked (not roaming): only a docked Tween falls asleep. */
  docked: boolean;
};

export type TweenEvent =
  | { type: "SAY_START" }
  | { type: "SAY_END" }
  | { type: "WALK"; dir: Dir }
  | { type: "ARRIVE" }
  | { type: "WAVE" }
  | { type: "POINT"; dir: PointDir }
  | { type: "THINK" }
  | { type: "CELEBRATE" }
  | { type: "SHRUG" }
  | { type: "DONE" }
  | { type: "SLEEP" }
  | { type: "INPUT" }
  | { type: "HIDE" }
  | { type: "SHOW" }
  | { type: "CONTEXT"; reduced: boolean; docked: boolean };

export const initialMachine: MachineState = { state: "idle", facing: "left", pointDir: "left", talking: false, reduced: false, docked: true };

/** States a pose event may start from. Walking finishes (ARRIVE) first; sleeping wakes first; peeking is left with SHOW. */
const POSE_FROM: ReadonlySet<TweenState> = new Set(["idle", "talk", "point", "wave", "think", "shrug", "celebrate"]);
const WALK_FROM: ReadonlySet<TweenState> = new Set(["idle", "talk", "point", "wave", "think", "shrug", "celebrate"]);

const settle = (m: MachineState): TweenState => (m.talking ? "talk" : "idle");

export function reduce(m: MachineState, e: TweenEvent): MachineState {
  const next = (patch: Partial<MachineState>): MachineState => ({ ...m, ...patch });

  if (e.type === "CONTEXT") {
    if (e.reduced === m.reduced && e.docked === m.docked) return m;
    // Entering reduced motion while walking: stand still where we are.
    const state = e.reduced && m.state === "walk" ? settle(m) : m.state;
    return next({ reduced: e.reduced, docked: e.docked, state });
  }

  if (m.state === "peek") return e.type === "SHOW" ? next({ state: "idle", talking: false }) : m;
  if (e.type === "SHOW") return m;
  if (e.type === "HIDE") return next({ state: "peek", talking: false });

  if (m.state === "sleep") {
    switch (e.type) {
      case "INPUT":
        return next({ state: "idle" });
      case "SAY_START":
        return next({ state: "talk", talking: true });
      case "WAVE":
        return next({ state: "wave" });
      default:
        return m;
    }
  }

  switch (e.type) {
    case "SAY_START":
      if (m.talking) return m;
      return next({ talking: true, state: m.state === "idle" ? "talk" : m.state === "walk" ? "walk" : m.state });
    case "SAY_END":
      if (!m.talking) return m;
      return next({ talking: false, state: m.state === "talk" ? "idle" : m.state });
    case "WALK":
      if (m.reduced || !WALK_FROM.has(m.state)) return m;
      return next({ state: "walk", facing: e.dir });
    case "ARRIVE":
      return m.state === "walk" ? next({ state: settle(m) }) : m;
    case "WAVE":
      return POSE_FROM.has(m.state) ? next({ state: "wave" }) : m;
    case "POINT":
      return POSE_FROM.has(m.state) ? next({ state: "point", pointDir: e.dir, facing: e.dir === "up" ? m.facing : e.dir }) : m;
    case "THINK":
      return POSE_FROM.has(m.state) ? next({ state: "think" }) : m;
    case "SHRUG":
      return POSE_FROM.has(m.state) ? next({ state: "shrug" }) : m;
    case "CELEBRATE":
      return POSE_FROM.has(m.state) ? next({ state: "celebrate" }) : m;
    case "DONE":
      return m.state === "wave" || m.state === "point" || m.state === "think" || m.state === "shrug" || m.state === "celebrate" ? next({ state: settle(m) }) : m;
    case "SLEEP":
      return m.state === "idle" && m.docked && !m.talking ? next({ state: "sleep" }) : m;
    case "INPUT":
      return m;
    default:
      return m;
  }
}

/** The pose the view should draw. Reduced motion never shows `walk`; it shows the still `idle` pose. */
export function viewState(m: MachineState): TweenState {
  return m.reduced && m.state === "walk" ? "idle" : m.state;
}

/** Face for each state (the rig swaps faces; it does not morph them). */
export type Face = "neutral" | "happy" | "think" | "joy" | "sleep" | "worried";
export function faceFor(s: TweenState): Face {
  switch (s) {
    case "wave":
      return "happy";
    case "think":
      return "think";
    case "celebrate":
      return "joy";
    case "sleep":
      return "sleep";
    case "shrug":
      return "worried";
    case "cover":
      return "happy";
    default:
      return "neutral";
  }
}

/** Pose events a dialogue node's `pose` name maps to. */
export function poseEvent(pose: string | undefined, dir: PointDir): TweenEvent | null {
  switch (pose) {
    case "wave":
      return { type: "WAVE" };
    case "point":
      return { type: "POINT", dir };
    case "think":
      return { type: "THINK" };
    case "shrug":
      return { type: "SHRUG" };
    case "celebrate":
      return { type: "CELEBRATE" };
    default:
      return null;
  }
}
