/** Plain types for Tween's written content. No runtime code, so the client chunk never pulls in the validator (zod). */

/** The poses a dialogue node may ask for. */
export const TWEEN_POSES = ["wave", "point", "talk", "think", "shrug", "celebrate"] as const;
export type TweenPose = (typeof TWEEN_POSES)[number];

/**
 * What Tween does besides talking. `goto` is an app route, `point` and `scroll` name an element carrying
 * `data-tween-target="<id>"`, `quiet` keeps Tween silent for the rest of the visit.
 */
export type TweenAction = { goto: string } | { scroll: string } | { point: string } | { quiet: true };

export type TweenChoice = { label: string; next: string };

export type TweenNode = {
  /** Each line is one speech bubble. Keep each under 140 characters. The token line `{tip}` expands to the page's tip. */
  say: string[];
  pose?: TweenPose;
  do?: TweenAction[];
  /** 0 to 4 buttons under the bubble. */
  choices?: TweenChoice[];
};

/** What the app tells Tween (see events.ts). `idle` is the 60 second sleep, which the kit already schedules. */
export const TWEEN_EVENTS = ["generating", "posts_ready", "generate_failed", "approved", "all_approved", "setup_started", "setup_done", "idle"] as const;
export type TweenAppEvent = (typeof TWEEN_EVENTS)[number];
export type CopiedEvent = Exclude<TweenAppEvent, "idle">;

export type TweenEventPose = "think" | "celebrate" | "wave" | "shrug";
export type TweenEventCopy = { pose: TweenEventPose; say?: string };

export type TweenUi = {
  openLabel: string;
  closeLabel: string;
  panelLabel: string;
  hide: string;
  show: string;
  pause: string;
  resume: string;
  voiceOn: string;
  voiceOff: string;
  restart: string;
  noRoam: string;
  roam: string;
  settings: string;
  settingsLabel: string;
  quickLabel: string;
  transcriptShow: string;
  transcriptHide: string;
  transcriptLabel: string;
  speakerTween: string;
  speakerYou: string;
  skip: string;
  dismiss: string;
  choicesLabel: string;
  thinking: string;
  closeButton: string;
};

export type TweenContent = {
  enabled: boolean;
  name: string;
  greeting: string;
  start: string;
  nodes: Record<string, TweenNode>;
  /** Route tips; `default` is the fallback. */
  tips: Record<string, string[]>;
  /** One idle nudge per route. */
  nudges: Record<string, string>;
  events: Record<CopiedEvent, TweenEventCopy>;
  ui: TweenUi;
};

/** What /api/tween serves and the lazy Tween chunk consumes: written copy only. No personal data. */
export type TweenBundle = { tween: TweenContent };
