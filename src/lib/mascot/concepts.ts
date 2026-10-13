// Checks on mascot concepts (R15g). Pure functions: the blocklist is the
// orchestrator's (src/lib/ai/mascot-blocklist.ts); this file applies it.

import { findBlockedTerm } from '@/lib/ai/mascot-blocklist';
import type { MascotConcepts, MascotSpec } from '@/lib/ai/schemas';

export type Concept = MascotConcepts['concepts'][number];

/** head topi + thin mustache + bow tie is too close to well-known Indian mascots. */
export function hasExcludedCombination(spec: MascotSpec): boolean {
  return spec.head === 'topi' && spec.face.mustache === 'thin' && spec.neck === 'bow';
}

/**
 * Why a concept must be dropped, or null when it is fine. The business name is
 * ignored for the name and personality check (a shop called "Shri Ram Sweets"
 * is not a concept naming a god), but never for the hint.
 */
export function conceptProblem(c: Concept, businessName: string): 'blocked' | 'excluded_combination' | 'invalid_name' | null {
  const name = c.name.trim();
  if (!name || name.length > 12) return 'invalid_name';
  if (findBlockedTerm(c.name, [businessName]) || findBlockedTerm(c.name_local, [businessName])) return 'blocked';
  if (findBlockedTerm(c.personality, [businessName])) return 'blocked';
  if (hasExcludedCombination(c.spec)) return 'excluded_combination';
  return null;
}

/** Keeps the concepts that pass; drops duplicates by name. */
export function keepGoodConcepts(list: Concept[], businessName: string): Concept[] {
  const seen = new Set<string>();
  const out: Concept[] = [];
  for (const c of list) {
    if (conceptProblem(c, businessName)) continue;
    const key = c.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
