// Validation for the USP library (PRD v3 B-2, change C-05). Pure and safe to import in the browser:
// the form checks with the same rules the server uses. Error values are short codes the UI maps to
// text (`s.usps.errors`), except rule messages from `USP_DETAILS` (already owner-facing English).

import type { z } from 'zod';
import type { FieldErrors } from './errors';
import { USP_DETAILS, USP_KINDS, USP_TITLE_MAX, type UspDetails, type UspKind } from './types';

export interface UspInput {
  kind: UspKind;
  title: string;
  details: Record<string, unknown>;
}

export type ParsedUsp =
  | { ok: true; data: { kind: UspKind; title: string; details: Record<string, unknown> } }
  | { ok: false; fieldErrors: FieldErrors };

export function isUspKind(v: unknown): v is UspKind {
  return typeof v === 'string' && (USP_KINDS as readonly string[]).includes(v);
}

function codeOf(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return 'required';
    case 'too_small':
      return issue.origin === 'string' ? 'required' : 'too_small';
    case 'too_big':
      return issue.origin === 'string' ? 'too_long' : 'too_big';
    case 'custom':
      return issue.message;
    default:
      return 'invalid';
  }
}

/** Checks kind, title and the per-kind details. Unknown keys in `details` are dropped. */
export function parseUsp(raw: unknown): ParsedUsp {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fieldErrors: FieldErrors = {};

  const kind = o.kind;
  if (!isUspKind(kind)) return { ok: false, fieldErrors: { kind: 'invalid' } };

  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (title.length < 1) fieldErrors.title = 'required';
  else if (title.length > USP_TITLE_MAX) fieldErrors.title = 'too_long';

  const detailsRaw = o.details && typeof o.details === 'object' && !Array.isArray(o.details) ? o.details : {};
  const parsed = USP_DETAILS[kind].safeParse(detailsRaw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 0 ? `details.${issue.path.map(String).join('.')}` : 'details';
      if (!(key in fieldErrors)) fieldErrors[key] = codeOf(issue);
    }
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { kind, title, details: (parsed as { data: UspDetails }).data as Record<string, unknown> } };
}
