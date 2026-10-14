import { BrandAccessError } from '@/lib/brand/current';
import { s } from '@/lib/i18n/strings';

export type MascotErrorCode = 'not_eligible' | 'formal_needs_confirm' | 'blocked_name' | 'bad_name' | 'bad_color' | 'not_found';

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
  code: MascotErrorCode | 'generic';
  message: string;
}

/** Plain words for the owner. */
export function describeMascotError(e: unknown): MascotFailure {
  if (e instanceof MascotError) {
    switch (e.code) {
      case 'blocked_name':
        return { code: e.code, message: s.mascot.errors.blockedName };
      case 'bad_name':
        return { code: e.code, message: s.mascot.errors.badName };
      case 'bad_color':
        return { code: e.code, message: s.mascot.errors.badColor };
      case 'not_eligible':
        return { code: e.code, message: s.mascot.errors.notEligible };
      case 'formal_needs_confirm':
        return { code: e.code, message: s.mascot.errors.formalNeedsConfirm };
      default:
        return { code: e.code, message: s.mascot.errors.notFound };
    }
  }
  if (e instanceof BrandAccessError) return { code: 'not_found', message: s.mascot.errors.notFound };
  console.error('[mascot]', e);
  return { code: 'generic', message: s.errors.generic };
}
