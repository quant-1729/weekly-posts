// Live status documents (docs/14-firebase-plan.md §2). Firestore holds only short-lived, non-sensitive status; Supabase stays
// the truth and the browser re-reads every detail through the existing server actions. Each kind has an allow-list of fields:
// anything else is dropped before a write. Never written: captions, headlines, URLs, error text, emails, payment IDs, tokens.

import { QUEUE_CHANNELS, QUEUE_STATUSES } from '@/lib/queue/types';

export const LIVE_KINDS = ['queue', 'queue_touch', 'face', 'research', 'weekly'] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];

/** Schema version written on every document. */
export const LIVE_VERSION = 1;

const HOUR_MS = 60 * 60 * 1000;
/** How long each kind lives before the Firestore TTL policy (on `expireAt`) deletes it. */
export const LIVE_TTL_MS: Record<LiveKind, number> = {
  queue: 24 * HOUR_MS,
  queue_touch: 24 * HOUR_MS,
  face: 2 * HOUR_MS,
  research: 24 * HOUR_MS,
  weekly: 24 * HOUR_MS,
};

export const FACE_STEPS = ['options', 'sheet', 'poses'] as const;
export const FACE_STATES = ['running', 'done', 'failed'] as const;
export const FACE_PHASES = ['drawing', 'checking', 'cutting', 'waiting', 'saved'] as const;
export const RESEARCH_STATES = ['running', 'done', 'failed', 'capped'] as const;
export const WEEKLY_STATES = ['generating', 'ready', 'failed'] as const;

export interface QueueLive {
  itemId: string;
  postId: string;
  channel: (typeof QUEUE_CHANNELS)[number];
  status: (typeof QUEUE_STATUSES)[number];
  mode: 'publish' | 'deliver';
  attempts: number;
  slotAt: string;
}
/** The owner changed the queue on some device: the doc itself carries only `seq`. */
export type QueueTouchLive = Record<string, never>;
export interface FaceLive {
  faceId: string;
  step: (typeof FACE_STEPS)[number];
  state: (typeof FACE_STATES)[number];
  pose?: string;
  tryNo?: number;
  tries?: number;
  phase?: (typeof FACE_PHASES)[number];
  done: number;
  total: number;
}
export interface ResearchLive {
  runId: string;
  state: (typeof RESEARCH_STATES)[number];
  cards?: number;
}
export interface WeeklyLive {
  weekStart: string;
  state: (typeof WEEKLY_STATES)[number];
}

export interface LiveDataByKind {
  queue: QueueLive;
  queue_touch: QueueTouchLive;
  face: FaceLive;
  research: ResearchLive;
  weekly: WeeklyLive;
}

/** The union of every status document's own fields, tagged by kind (the writer adds kind, v, seq, updatedAt, expireAt). */
export type LiveDoc = { [K in LiveKind]: { kind: K } & LiveDataByKind[K] }[LiveKind];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_ID_RE = /^[a-z0-9_-]{1,80}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,80}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

/** A brand id is a Supabase uuid; it becomes a Firestore path segment. */
export const isLiveBrandId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const isLiveDocId = (v: unknown): v is string => typeof v === 'string' && DOC_ID_RE.test(v);
export const isLiveKind = (v: unknown): v is LiveKind => typeof v === 'string' && (LIVE_KINDS as readonly string[]).includes(v);

type Check = (v: unknown) => boolean;
const oneOf = (list: readonly string[]): Check => (v) => typeof v === 'string' && list.includes(v);
const int = (max: number): Check => (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const token: Check = (v) => typeof v === 'string' && TOKEN_RE.test(v);
const day: Check = (v) => typeof v === 'string' && DAY_RE.test(v);
const isoTime: Check = (v) => typeof v === 'string' && v.length <= 40 && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));

/** The allow-list: per kind, every field that may be written and the check its value must pass. */
const FIELDS: Record<LiveKind, Record<string, Check>> = {
  queue: {
    itemId: token,
    postId: token,
    channel: oneOf(QUEUE_CHANNELS),
    status: oneOf(QUEUE_STATUSES),
    mode: oneOf(['publish', 'deliver']),
    attempts: int(1000),
    slotAt: isoTime,
  },
  queue_touch: {},
  face: {
    faceId: token,
    step: oneOf(FACE_STEPS),
    state: oneOf(FACE_STATES),
    pose: token,
    tryNo: int(100),
    tries: int(100),
    phase: oneOf(FACE_PHASES),
    done: int(1000),
    total: int(1000),
  },
  research: { runId: token, state: oneOf(RESEARCH_STATES), cards: int(1000) },
  weekly: { weekStart: day, state: oneOf(WEEKLY_STATES) },
};

/** Keeps only the allow-listed fields of `kind` whose values pass their check; everything else is dropped. */
export function sanitize(kind: LiveKind, data: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!data || typeof data !== 'object') return out;
  for (const [key, check] of Object.entries(FIELDS[kind])) {
    const value = (data as Record<string, unknown>)[key];
    if (value !== undefined && check(value)) out[key] = value as string | number;
  }
  return out;
}
