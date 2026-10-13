/**
 * The setup v2 screens, in order: one short question per screen (Req 2, 7).
 * Safe to import in the browser.
 */
export const SETUP_STEPS = [
  "business", // business name + what do you sell
  "customers",
  "location", // country, region, city, time zone
  "goal",
  "tone",
  "language",
  "minutes",
  "website", // optional, can be skipped
  "schedule", // weekly email day and time
  "done",
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

/** Quick picks for "minutes per post". */
export const MINUTE_PICKS = [10, 20, 30, 60] as const;
