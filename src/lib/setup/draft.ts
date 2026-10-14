import { z } from "zod";
import { DAY_KEYS, type DayKey } from "@/lib/contacts/types";
import { DEFAULT_TIME, DEFAULT_WEEKDAY } from "./schema";
import { ONLINE_CHOICES, SETUP_STEPS, type OnlineChoice, type SetupStep } from "./steps";

/**
 * The setup draft: the screen the owner is on and what they have typed so far. It is saved after every
 * screen, so a reload (or coming back on another device) resumes where they left off (hardening H-16).
 *
 * Stored in `brand_memory.setup_transcript` (a v1 column nothing reads for unfinished brands) as
 * "setup-draft:v1:" + JSON, and cleared when setup completes. Safe to import in the browser; parsing is
 * forgiving: anything unreadable falls back to an empty field, never to an error.
 */

export const DRAFT_PREFIX = "setup-draft:v1:";

export const HOURS_MODES = ["", "days", "always", "appointment"] as const;
export type HoursMode = (typeof HOURS_MODES)[number];

export interface DayHours {
  /** Open on this day. */
  on: boolean;
  /** "HH:MM" */
  open: string;
  /** "HH:MM" (up to "24:00") */
  close: string;
}
export type DraftHoursDays = Record<DayKey, DayHours>;

/** Lines for "What do customers like about you?": at most this many. */
export const MAX_LIKES = 3;
export const LIKE_MAX_CHARS = 60;

const DEFAULT_DAY: DayHours = { on: false, open: "09:00", close: "17:00" };

export function defaultHoursDays(): DraftHoursDays {
  const days = {} as DraftHoursDays;
  for (const d of DAY_KEYS) days[d] = { ...DEFAULT_DAY, on: d !== "sat" && d !== "sun" };
  return days;
}

const str = (max: number) => z.string().max(max).catch("");
const hhmm = (fallback: string) => z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/).catch(fallback);

const dayHours = z
  .object({ on: z.boolean().catch(false), open: hhmm(DEFAULT_DAY.open), close: hhmm(DEFAULT_DAY.close) })
  .catch({ ...DEFAULT_DAY });

const answersSchema = z.object({
  name: str(100),
  sell: str(200),
  online: z
    .array(z.string())
    .catch([])
    .transform((v): OnlineChoice[] => ONLINE_CHOICES.filter((c) => v.includes(c))),
  website: str(2000),
  instagram: str(300),
  youtube: str(300),
  country: str(2),
  region: str(10),
  city: str(100),
  timezone: str(60),
  customers: str(200),
  phone: str(40),
  whatsapp: str(40),
  sameWhatsapp: z.boolean().catch(false),
  email: str(254),
  hoursMode: z.enum(HOURS_MODES).catch(""),
  hours: z
    .object({
      mon: dayHours,
      tue: dayHours,
      wed: dayHours,
      thu: dayHours,
      fri: dayHours,
      sat: dayHours,
      sun: dayHours,
    })
    .catch(defaultHoursDays()),
  likes: z
    .array(z.string().max(LIKE_MAX_CHARS * 2))
    .catch([])
    .transform((v) => v.slice(0, MAX_LIKES)),
  goal: str(20),
  tone: str(30),
  language: str(20),
  minutes: str(4),
  weekday: z.number().int().min(1).max(7).catch(DEFAULT_WEEKDAY),
  time: str(5).transform((t) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : DEFAULT_TIME)),
});

export type DraftAnswers = z.infer<typeof answersSchema>;

export function emptyAnswers(): DraftAnswers {
  return answersSchema.parse(emptyDefaults());
}

/** Reads untrusted answers (from the browser or a stored draft) into a safe shape. */
export function parseAnswers(raw: unknown): DraftAnswers {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return answersSchema.parse({ ...emptyDefaults(), ...(src as Record<string, unknown>) });
}

// The defaults for fields the schema cannot make by itself.
function emptyDefaults(): Record<string, unknown> {
  return { hours: defaultHoursDays(), weekday: DEFAULT_WEEKDAY, time: DEFAULT_TIME, language: "en" };
}

export interface SetupDraft {
  /** The screen to show next. */
  step: SetupStep;
  answers: DraftAnswers;
}

export function isSetupStep(v: unknown): v is SetupStep {
  return typeof v === "string" && (SETUP_STEPS as readonly string[]).includes(v);
}

export function serializeDraft(draft: SetupDraft): string {
  return DRAFT_PREFIX + JSON.stringify({ step: draft.step, answers: draft.answers });
}

/** The saved draft, or null when there is none (or it is not a setup draft). */
export function parseDraft(text: string | null | undefined): SetupDraft | null {
  if (typeof text !== "string" || !text.startsWith(DRAFT_PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(DRAFT_PREFIX.length)) as { step?: unknown; answers?: unknown };
    const answers = parseAnswers(raw.answers);
    const step: SetupStep = isSetupStep(raw.step) && raw.step !== "done" ? raw.step : "business";
    return { step, answers };
  } catch {
    return null;
  }
}
