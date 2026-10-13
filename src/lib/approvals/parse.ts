// Small parsers for what the owner types on the edit forms.

import { normaliseHashtags } from '@/lib/weekly/normalize';

/** "#a, #b c" or "a,b" -> ["#a", "#b", "#c"]: commas, spaces and new lines separate; duplicates and empties go. */
export function parseHashtags(raw: string): string[] {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  return normaliseHashtags(parts, 100);
}

/** The text of a form field, or ''. */
export function formText(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

/** Line endings as \n and no spaces at the ends. */
export function cleanText(v: string): string {
  return v.replace(/\r\n?/g, '\n').trim();
}
