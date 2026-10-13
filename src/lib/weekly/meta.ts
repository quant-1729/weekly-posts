// What the pipeline remembers about a weekly batch, kept in real columns (0011_hardening.sql, H-3):
//
// - attempts:   generation runs started for this week (a claim adds one). Cron stops at 3.
// - regens:     times the owner pressed the button on an already-ready week. The button stops at 3.
// - claimed_at: when the current run started, so a crashed run can be told from a live one.
// - error:      the failure in plain words when status is `failed` (or when a regeneration failed and
//               the old posts were kept); null when there is none.
//
// Old rows (written before 0011) may hold a JSON record in `error`:
//   { "attempts": 2, "regens": 1, "claimedAt": "2026-11-09T08:00:12.000Z", "message": "..." }
// `readBatchState` reads that once; the next write to the batch puts the numbers in the columns and
// plain text (or null) in `error`.

export const MAX_CRON_ATTEMPTS = 3;
export const MAX_REGENERATIONS = 3;
export const RETRY_WINDOW_MS = 24 * 3_600_000;
/** A `generating` batch older than this is a crashed run (maxDuration is 300 s). */
export const STALE_GENERATING_MS = 10 * 60_000;

/** The `weekly_batches` columns that hold this state. Add to a select list. */
export const BATCH_STATE_COLUMNS = 'error, attempts, regens, claimed_at';

export interface BatchState {
  attempts: number;
  regens: number;
  /** ISO time, or null when no run is in progress. */
  claimedAt: string | null;
  /** The failure message, '' when there is none. */
  message: string;
}

/** A row as selected with BATCH_STATE_COLUMNS (the counters may be absent in hand-made rows). */
export interface BatchStateRow {
  error: string | null;
  attempts?: number | string | null;
  regens?: number | string | null;
  claimed_at?: Date | string | null;
}

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

const isoOrNull = (v: Date | string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The old JSON record in `error`, or null when `error` is plain text. */
function legacyRecord(error: string): Partial<{ attempts: unknown; regens: unknown; claimedAt: unknown; message: unknown }> | null {
  if (!error.trimStart().startsWith('{')) return null;
  try {
    const v = JSON.parse(error) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* plain text that happens to start with a brace */
  }
  return null;
}

export function readBatchState(row: BatchStateRow): BatchState {
  const state: BatchState = {
    attempts: count(row.attempts),
    regens: count(row.regens),
    claimedAt: isoOrNull(row.claimed_at),
    message: row.error ?? '',
  };
  const old = row.error ? legacyRecord(row.error) : null;
  if (old) {
    state.attempts = Math.max(state.attempts, count(old.attempts));
    state.regens = Math.max(state.regens, count(old.regens));
    if (!state.claimedAt && typeof old.claimedAt === 'string') state.claimedAt = isoOrNull(old.claimedAt);
    state.message = typeof old.message === 'string' ? old.message : '';
  }
  return state;
}

/** The text to store in `error`: the message, or null when there is none. */
export function errorColumn(message: string): string | null {
  return message ? message.slice(0, 400) : null;
}

/** The failure message of a batch, or '' when there is none. (An old JSON record yields its message.) */
export function batchErrorMessage(error: string | null | undefined): string {
  return readBatchState({ error: error ?? null }).message;
}

export function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}
