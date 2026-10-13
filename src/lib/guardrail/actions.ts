// Owner actions on a post's fact_flags (docs/guardrail.md section 4), as pure functions
// for the approval pages (V-16). They return new values and never touch the database.

import { avoidIssues } from './deterministic';
import { fieldText, type Flag, type FlagField } from './types';

export class GuardrailActionError extends Error {
  constructor(
    public readonly code: 'not_found' | 'not_open' | 'ack_required' | 'must_edit' | 'cannot_remove',
    message: string,
  ) {
    super(message);
    this.name = 'GuardrailActionError';
  }
}

export interface EditablePost {
  caption: string;
  cta: string;
  image_text: { headline: string; subline: string; bubble?: string };
}

/** True while any flag that blocks approve, share and download is open. The regulated reminder never blocks. */
export function hasBlockingFlags(flags: Flag[]): boolean {
  return flags.some((f) => f.status === 'open' && f.kind !== 'regulated_reminder');
}

/**
 * "This is true". A regulated flag needs `regulatedAck` (the extra tick). A word to avoid
 * cannot be confirmed (the post must be edited), nor can the reminder.
 */
export function confirmFlag(flags: Flag[], flagId: string, opts: { regulatedAck?: boolean; now?: Date } = {}): Flag[] {
  const flag = flags.find((f) => f.id === flagId);
  if (!flag) throw new GuardrailActionError('not_found', `No flag ${flagId}`);
  if (flag.status !== 'open') throw new GuardrailActionError('not_open', `Flag ${flagId} is already ${flag.status}`);
  if (flag.kind === 'avoid' || flag.kind === 'regulated_reminder') {
    throw new GuardrailActionError('must_edit', `A ${flag.kind} flag cannot be confirmed`);
  }
  if (flag.regulated && !opts.regulatedAck) {
    throw new GuardrailActionError('ack_required', 'Confirming a regulated claim needs the extra acknowledgement');
  }
  const decided = (opts.now ?? new Date()).toISOString();
  return flags.map((f) => (f.id === flagId ? { ...f, status: 'confirmed' as const, decided_at: decided } : f));
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '“': '”', '«': '»', '‘': '’' };

/** Cuts [start, end) out of the text and tidies the seam: spaces, orphaned punctuation, empty brackets. */
function cut(text: string, start: number, end: number): string {
  let b = text.slice(0, start);
  let a = text.slice(end);
  let spaced = /[ \t]$/.test(b) || /^[ \t]/.test(a);
  b = b.replace(/[ \t]+$/, '');
  a = a.replace(/^[ \t]+/, '');
  if (b && a && PAIRS[b[b.length - 1]] === a[0]) {
    // empty brackets left behind: drop them
    b = b.slice(0, -1);
    a = a.slice(1);
    spaced = spaced || /[ \t]$/.test(b) || /^[ \t]/.test(a);
    b = b.replace(/[ \t]+$/, '');
    a = a.replace(/^[ \t]+/, '');
  }
  // a sentence end after a separator: "Fresh, £3.90." becomes "Fresh."
  if (/^[.!?।؟…]/.test(a)) b = b.replace(/[ \t]*[,;:،؛\-–—]+$/, '');
  if (/^[,;:،؛]/.test(a) && (b === '' || /[\n,;:،؛(\[{\-–—]$/.test(b))) a = a.slice(1).replace(/^[ \t]+/, '');
  if (a === '' || a.startsWith('\n')) b = b.replace(/[ \t]*[:,;،؛\-–—]+$/, '');
  let sep = spaced ? ' ' : '';
  if (!b || !a || b.endsWith('\n') || a.startsWith('\n')) sep = '';
  else if (/^[.,;:!?।،؛؟)\]}”»’%]/.test(a)) sep = '';
  else if (/[(\[{“«‘]$/.test(b)) sep = '';
  return b + sep + a;
}

/**
 * The post with the flagged text removed from its field (every occurrence), spaces and
 * punctuation tidied. Not allowed when the flag cannot be highlighted: the text is not
 * reliably in the field, so the owner edits it instead.
 */
export function removeFlagText<P extends EditablePost>(post: P, flag: Flag): P {
  if (!flag.highlight) throw new GuardrailActionError('cannot_remove', 'This flag has no text to remove; edit the post instead');
  let text = fieldText(post, flag.field);
  if (!flag.text) return post;
  for (let guard = 0; guard < 50; guard++) {
    const at = text.indexOf(flag.text);
    if (at < 0) break;
    text = cut(text, at, at + flag.text.length);
  }
  return setField(post, flag.field, text);
}

function setField<P extends EditablePost>(post: P, field: FlagField, value: string): P {
  switch (field) {
    case 'caption':
      return { ...post, caption: value };
    case 'cta':
      return { ...post, cta: value };
    case 'image_text.headline':
      return { ...post, image_text: { ...post.image_text, headline: value } };
    case 'image_text.subline':
      return { ...post, image_text: { ...post.image_text, subline: value } };
    case 'image_text.bubble':
      return { ...post, image_text: { ...post.image_text, bubble: value } };
  }
}

const fold = (s: string) => s.normalize('NFC').toLowerCase();

/** After an owner edit: open flags whose text no longer appears in their field become `removed`. */
export function resolveRemovedSpans(post: EditablePost, flags: Flag[], now: Date = new Date()): Flag[] {
  const decided = now.toISOString();
  return flags.map((f) => {
    if (f.status !== 'open' || !f.highlight || f.kind === 'regulated_reminder') return f;
    const text = fieldText(post, f.field);
    const present = f.kind === 'avoid' ? avoidIssues(f.field, text, [f.text]).length > 0 : fold(text).includes(fold(f.text));
    return present ? f : { ...f, status: 'removed' as const, decided_at: decided };
  });
}
