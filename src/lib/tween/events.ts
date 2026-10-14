/**
 * How the app talks to Tween. App code calls `tweenSignal("posts_ready")` (a window CustomEvent); the Tween chunk
 * listens and plays the matching pose and line from `events` in src/content/tween.json. Safe to call anywhere on the
 * client: with no Tween on the page (disabled, hidden, not loaded yet) it does nothing. Calls made before the lazy
 * chunk has loaded are replayed once, if they are recent (`RECENT_MS`).
 *
 * Pure planning lives here too (`planForEvent`) so the mapping from event to pose and line is unit-tested without a DOM.
 */
import type { CopiedEvent, TweenAppEvent, TweenContent, TweenEventPose } from "./types";

export const SIGNAL_EVENT = "tween:signal";
/** A signal older than this is not replayed when Tween loads late. */
export const RECENT_MS = 8000;

export type TweenSignalDetail = { event: TweenAppEvent; detail?: Record<string, unknown>; at: number };

declare global {
  interface Window {
    /** The last signal, kept so a Tween that finishes loading a moment later can still react to it. */
    __tweenLast?: TweenSignalDetail;
  }
}

/** Tell Tween something happened. Does nothing on the server. */
export function tweenSignal(event: TweenAppEvent, detail?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const d: TweenSignalDetail = { event, detail, at: Date.now() };
  window.__tweenLast = d;
  window.dispatchEvent(new CustomEvent<TweenSignalDetail>(SIGNAL_EVENT, { detail: d }));
}

/** The last signal if it is still fresh enough to replay, else null. */
export function recentSignal(last: TweenSignalDetail | undefined, now: number): TweenSignalDetail | null {
  return last && now - last.at <= RECENT_MS ? last : null;
}

/** Timing of the reactions, in milliseconds. */
export const TIMING = {
  celebrate: 2400,
  wave: 2100,
  shrug: 2400,
  /** A held pose (generating) is released after this long even if no later event arrives. */
  holdMax: 90_000,
  /** The speech bubble stays this long. */
  bubble: 9000,
} as const;

export type EventPlan =
  /** Wake Tween's machine into sleep (docked only; the machine decides). */
  | { kind: "sleep" }
  | {
      kind: "react";
      pose: TweenEventPose;
      /** How long the pose is held before settling; null = until the next event (capped by TIMING.holdMax). */
      holdMs: number | null;
      /** The line to say in a bubble, or null for a silent reaction. */
      say: string | null;
      /** Wait this long before the bubble (the celebration comes first). */
      sayAfterMs: number;
    };

/**
 * generating -> think and hold; posts_ready -> celebrate, then talk; generate_failed -> shrug and a line;
 * approved -> a short celebrate, no bubble; all_approved -> celebrate, then a line; setup_started -> wave greeting;
 * setup_done -> celebrate; idle -> sleep.
 */
export function planForEvent(content: Pick<TweenContent, "events">, event: TweenAppEvent): EventPlan | null {
  if (event === "idle") return { kind: "sleep" };
  const copy = content.events[event as CopiedEvent];
  if (!copy) return null;
  const say = copy.say ?? null;
  switch (event) {
    case "generating":
      return { kind: "react", pose: copy.pose, holdMs: null, say, sayAfterMs: 0 };
    case "posts_ready":
    case "all_approved":
      return { kind: "react", pose: copy.pose, holdMs: TIMING.celebrate, say, sayAfterMs: TIMING.celebrate };
    case "generate_failed":
      return { kind: "react", pose: copy.pose, holdMs: TIMING.shrug, say, sayAfterMs: 0 };
    case "approved":
    case "setup_done":
      return { kind: "react", pose: copy.pose, holdMs: TIMING.celebrate, say, sayAfterMs: 0 };
    case "setup_started":
      return { kind: "react", pose: copy.pose, holdMs: TIMING.wave, say, sayAfterMs: 0 };
    default:
      return null;
  }
}

/** How long the mouth moves for a line: about the time it takes to read, within bounds. */
export const talkMs = (line: string): number => Math.min(5000, Math.max(1200, line.length * 55));
