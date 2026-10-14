/**
 * The setup screens (PRD v3 D-1 to D-3, change C-01): one short question per screen.
 * Safe to import in the browser.
 *
 *   Path A (the owner is online):   business -> online -> addresses -> location -> customers -> reach -> hours
 *                                    -> logo -> likes -> goal -> style -> minutes -> schedule -> done
 *   Path B (not online yet):        the same without "addresses".
 *
 * The optional screens can be skipped (online, addresses, reach, hours, logo, likes). The others stay
 * required as in setup v2: business, location, customers, goal, style, minutes and the email schedule.
 */
export const SETUP_STEPS = [
  "business", // business name + what do you sell
  "online", // "Are you online already?": website / Instagram / YouTube / not yet
  "addresses", // Path A only: the addresses of the chosen ones; the reads start here
  "location", // country, region, city, time zone
  "customers",
  "reach", // phone / WhatsApp / email
  "hours", // opening hours (optional)
  "logo", // upload or skip (optional)
  "likes", // 1-3 things customers like about you (optional), seeds the USP library
  "goal",
  "style", // tone + post language
  "minutes",
  "schedule", // weekly email day and time
  "done",
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export const ONLINE_CHOICES = ["website", "instagram", "youtube", "none"] as const;
export type OnlineChoice = (typeof ONLINE_CHOICES)[number];

/** Path A: the owner has at least one of a website, Instagram or YouTube. Path B: nothing yet (or the question was skipped). */
export type SetupPath = "A" | "B";

export function pathOf(online: readonly OnlineChoice[]): SetupPath {
  return online.some((c) => c === "website" || c === "instagram" || c === "youtube") ? "A" : "B";
}

/** The screens this owner will see, in order. Path B has no "addresses" screen. */
export function stepsFor(online: readonly OnlineChoice[]): SetupStep[] {
  return pathOf(online) === "A" ? [...SETUP_STEPS] : SETUP_STEPS.filter((x) => x !== "addresses");
}

/**
 * Taps one card of "Are you online already?". "Not yet" clears the others, and any other card clears
 * "Not yet". Tapping a chosen card again un-chooses it. The result is in the order of ONLINE_CHOICES.
 */
export function toggleOnline(current: readonly OnlineChoice[], choice: OnlineChoice): OnlineChoice[] {
  if (choice === "none") return current.includes("none") ? [] : ["none"];
  const rest = current.filter((c) => c !== "none" && c !== choice);
  const next = current.includes(choice) ? rest : [...rest, choice];
  return ONLINE_CHOICES.filter((c) => next.includes(c));
}

/** The screen after `step` for this owner, or the last one. */
export function nextStep(step: SetupStep, online: readonly OnlineChoice[]): SetupStep {
  const list = stepsFor(online);
  const i = list.indexOf(step);
  return list[Math.min(list.length - 1, (i < 0 ? 0 : i) + 1)];
}

/** The screen before `step` for this owner, or the first one. */
export function previousStep(step: SetupStep, online: readonly OnlineChoice[]): SetupStep {
  const list = stepsFor(online);
  const i = list.indexOf(step);
  return list[Math.max(0, (i < 0 ? 0 : i) - 1)];
}

/** Quick picks for "minutes per post". */
export const MINUTE_PICKS = [10, 20, 30, 60] as const;
