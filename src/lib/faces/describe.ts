// A FaceError (or any error) as words for the owner.

import { BrandAccessError } from '@/lib/brand/current';
import { s } from '@/lib/i18n/strings';
import { describeMascotError, MascotError } from '@/lib/mascot/errors';
import { FaceError, type FaceErrorCode } from './errors';
import { FaceGenError, type FaceGenErrorCode } from './generate/errors';

export interface FaceFailure {
  code: FaceErrorCode | FaceGenErrorCode | 'generic';
  message: string;
}

export function describeFaceError(e: unknown): FaceFailure {
  if (e instanceof FaceError) return { code: e.code, message: s.faces.errors[e.code] };
  if (e instanceof FaceGenError) return { code: e.code, message: s.faces.generate.errors[e.code] };
  if (e instanceof MascotError) {
    const m = describeMascotError(e);
    return { code: 'generic', message: m.message };
  }
  if (e instanceof BrandAccessError) return { code: 'not_found', message: s.faces.errors.not_found };
  return { code: 'generic', message: s.faces.errors.generic };
}
