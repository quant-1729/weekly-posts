// Merge of the two layers (docs/guardrail.md section 2, v2 addendum):
//   flags = deterministic issues UNION AI statements that are unsupported,
// where, for a regulated brand, an outcome promise is flagged even when a fact supports it.
// - The AI layer never clears a code flag.
// - Two flags in the same post and field whose spans overlap are one flag; the AI span wins.
// - An AI text that is not an exact substring of the field is kept, with highlight false.

import { createHash } from 'node:crypto';
import type { AiStatement } from './ai';
import type { DetIssue } from './deterministic';
import { FLAG_FIELDS, fieldText, type Flag, type FlagField, type FlagKind, type GuardrailPost } from './types';

interface Cand {
  field: FlagField;
  text: string;
  kind: FlagKind;
  start: number; // -1 when the text is not in the field
  end: number;
  layer: 'code' | 'ai';
  regulated: boolean;
}

const norm = (s: string) => s.normalize('NFC').trim().toLowerCase();

export function flagId(field: string, kind: string, text: string): string {
  return `f_${createHash('sha1').update(`${field}|${kind}|${text}`).digest('hex').slice(0, 8)}`;
}

const overlaps = (a: Cand, b: Cand) => a.start >= 0 && b.start >= 0 && a.start < b.end && b.start < a.end;
// A span we cannot place is the same flag as another when one text holds the other.
function sameText(a: Cand, b: Cand): boolean {
  if (a.start >= 0 && b.start >= 0) return false;
  const x = norm(a.text);
  const y = norm(b.text);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

export function mergeFlags(args: {
  post: GuardrailPost;
  det: DetIssue[];
  /** Statements for this post only. */
  ai: AiStatement[];
  brandRegulated: boolean;
  /** Texts the owner already confirmed on this post: matching flags come back as confirmed. */
  confirmed?: string[];
  now: Date;
}): Flag[] {
  const { post, brandRegulated } = args;
  const confirmed = new Set((args.confirmed ?? []).map(norm));
  const decided = args.now.toISOString();
  const out: Flag[] = [];

  for (const field of FLAG_FIELDS) {
    const text = fieldText(post, field);

    const aiCands: Cand[] = args.ai
      .filter((s) => s.field === field && (!s.supported || (brandRegulated && s.outcome_promise)))
      .map((s) => {
        const start = s.text ? text.indexOf(s.text) : -1;
        return {
          field,
          text: s.text,
          kind: s.kind,
          start,
          end: start < 0 ? -1 : start + s.text.length,
          layer: 'ai' as const,
          // Regulated claims and outcome promises need the extra warning and tick.
          regulated: brandRegulated && (s.outcome_promise || s.kind === 'claim'),
        };
      });
    const promiseFirst = (c: Cand) => (c.regulated ? 0 : 1);
    const spanned = aiCands.filter((c) => c.start >= 0).sort((a, b) => promiseFirst(a) - promiseFirst(b) || a.end - a.start - (b.end - b.start) || a.start - b.start);
    const unspanned = aiCands.filter((c) => c.start < 0);
    const detCands: Cand[] = args.det
      .filter((i) => i.field === field && i.code !== 'avoid')
      .map((i) => ({
        field,
        text: i.text,
        kind: i.kind,
        start: i.highlight ? i.start : -1,
        end: i.highlight ? i.end : -1,
        layer: 'code' as const,
        regulated: brandRegulated && (i.regulated || i.kind === 'claim'),
      }));

    const picked: Array<Cand & { both: boolean }> = [];
    for (const c of [...spanned, ...unspanned, ...detCands]) {
      const hit = picked.find((p) => overlaps(p, c) || sameText(p, c));
      if (hit) {
        if (hit.layer !== c.layer) hit.both = true;
        hit.regulated ||= c.regulated;
        continue;
      }
      picked.push({ ...c, both: false });
    }
    // The same text in two places is one flag (removing it removes both).
    const byText = new Map<string, Cand & { both: boolean }>();
    for (const p of picked.sort((a, b) => (a.start < 0 ? 1e9 : a.start) - (b.start < 0 ? 1e9 : b.start))) {
      const key = norm(p.text);
      const prev = byText.get(key);
      if (prev) {
        if (prev.layer !== p.layer || p.both) prev.both = true;
        prev.regulated ||= p.regulated;
      } else byText.set(key, p);
    }
    for (const p of byText.values()) {
      const isConfirmed = confirmed.has(norm(p.text));
      out.push({
        id: flagId(field, p.kind, p.text),
        text: p.text,
        kind: p.kind,
        field,
        layer: p.both ? 'both' : p.layer,
        regulated: p.regulated,
        highlight: p.start >= 0,
        status: isConfirmed ? 'confirmed' : 'open',
        decided_at: isConfirmed ? decided : null,
      });
    }

    // Words to avoid are a different reason: never merged with a fact flag.
    const seen = new Set<string>();
    for (const i of args.det.filter((x) => x.field === field && x.code === 'avoid')) {
      const key = norm(i.text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: flagId(field, 'avoid', i.text), text: i.text, kind: 'avoid', field, layer: 'code', regulated: false, highlight: i.highlight, status: 'open', decided_at: null });
    }
  }
  return out;
}
