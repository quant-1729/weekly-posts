import { s } from '@/lib/i18n/strings';

export type QueueErrorCode =
  | 'invalid_settings'
  | 'not_found'
  | 'not_approved'
  | 'invalid_slot'
  | 'too_soon'
  | 'after_end'
  | 'clash'
  | 'ended'
  | 'busy'
  | 'already_sent'
  | 'not_queueable';

/** Thrown by the settings functions; the owner actions return `{ ok: false }` instead. */
export class QueueError extends Error {
  constructor(public readonly code: QueueErrorCode) {
    super(`Queue: ${code}`);
    this.name = 'QueueError';
  }
}

/** A plain sentence for each failure. */
export const queueMessage = (code: QueueErrorCode): string => s.queue.errors[code];

export type QueueFailure = { ok: false; code: QueueErrorCode; message: string };
export type QueueResult<T = object> = ({ ok: true } & T) | QueueFailure;

/** A failure with its own sentence (for example one that names the time it clashes with). */
export const queueFailWith = (code: QueueErrorCode, message: string): QueueFailure => ({ ok: false, code, message });

export const queueFail = (code: QueueErrorCode): QueueFailure => ({ ok: false, code, message: queueMessage(code) });
