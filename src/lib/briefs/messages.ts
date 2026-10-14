import { BrandAccessError } from '@/lib/brand/current';
import { s } from '@/lib/i18n/strings';
import type { MissingItem } from './completeness';
import { BriefIncompleteError, BriefNotFoundError, BriefValidationError } from './errors';

/** What a brief action tells the editor when something fails: words to show and the fields to mark. */
export interface BriefFailure {
  ok: false;
  code: 'validation' | 'incomplete' | 'not_found' | 'generic';
  message: string;
  /** Field name to owner-facing text. */
  fieldErrors?: Record<string, string>;
  missing?: MissingItem[];
}

const text = s.brief.errors as Record<string, string>;

export function describeBriefError(e: unknown): BriefFailure {
  if (e instanceof BriefValidationError) {
    const fieldErrors = Object.fromEntries(Object.entries(e.fieldErrors).map(([k, code]) => [k, text[code] ?? text.invalid]));
    return { ok: false, code: 'validation', message: text.invalid, fieldErrors };
  }
  if (e instanceof BriefIncompleteError) return { ok: false, code: 'incomplete', message: text.incomplete, missing: e.missing };
  if (e instanceof BriefNotFoundError || e instanceof BrandAccessError) return { ok: false, code: 'not_found', message: text.not_found };
  console.error('[brief]', e);
  return { ok: false, code: 'generic', message: s.errors.generic };
}
