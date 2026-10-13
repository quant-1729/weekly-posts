import { AiError } from '@/lib/ai/client';
import { BrandAccessError } from '@/lib/brand/current';
import { fill, s } from '@/lib/i18n/strings';
import { DailyCapError } from '@/lib/usage';
import { WeeklyCapError } from '@/lib/usage/caps';

export type MascotErrorCode =
  | 'not_eligible'
  | 'formal_needs_confirm'
  | 'blocked_hint'
  | 'refused'
  | 'none'
  | 'not_found'
  | 'bad_spec';

export class MascotError extends Error {
  constructor(
    public readonly code: MascotErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'MascotError';
  }
}

export interface MascotFailure {
  code: MascotErrorCode | 'cap' | 'ai_failed' | 'generic';
  message: string;
}

/** Plain words for the owner. */
export function describeMascotError(e: unknown): MascotFailure {
  if (e instanceof MascotError) {
    switch (e.code) {
      case 'blocked_hint':
        return { code: e.code, message: s.mascot.errors.blockedHint };
      case 'refused':
        // The model's one-sentence reason, shown as written; a fixed sentence when it gave none.
        return { code: e.code, message: e.message && e.message !== 'refused' ? e.message : s.mascot.errors.refusedFallback };
      case 'not_eligible':
        return { code: e.code, message: s.mascot.errors.notEligible };
      case 'formal_needs_confirm':
        return { code: e.code, message: s.mascot.errors.formalNeedsConfirm };
      case 'none':
        return { code: e.code, message: s.mascot.errors.none };
      default:
        return { code: e.code, message: s.mascot.errors.notFound };
    }
  }
  if (e instanceof DailyCapError) return { code: 'cap', message: fill(s.errors.dailyCap, { cap: e.cap }) };
  if (e instanceof WeeklyCapError) return { code: 'cap', message: e.message };
  if (e instanceof BrandAccessError) return { code: 'not_found', message: s.mascot.errors.notFound };
  if (e instanceof AiError) return { code: 'ai_failed', message: s.errors.aiFailed };
  console.error('[mascot]', e);
  return { code: 'generic', message: s.errors.generic };
}
