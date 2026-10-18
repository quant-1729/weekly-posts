// Regulated categories (health, finance, education) get stricter claim rules (R8)
// and no mascot by default (R15a). Decided in code from the category label, so the
// result is predictable. Owned by the orchestrator.

const REGULATED_KEYWORDS = [
  // health
  'clinic', 'dental', 'dentist', 'doctor', 'hospital', 'medical', 'pharmacy', 'chemist', 'diagnostic',
  'pathology', 'lab', 'physio', 'ayurved', 'homeopath', 'nursing', 'health', 'skin', 'derma', 'eye care',
  'optical', 'diet', 'nutrition',
  // finance
  'tax', 'ca ', 'chartered accountant', 'accountant', 'finance', 'loan', 'insurance', 'investment',
  'mutual fund', 'share market', 'trading', 'bank', 'gst',
  // education
  'coaching', 'tuition', 'school', 'academy', 'institute', 'education', 'college',
];

export function isRegulatedCategory(category: string): boolean {
  const c = ` ${category.toLowerCase()} `;
  return REGULATED_KEYWORDS.some((k) => c.includes(k));
}

// v2 (Req 12): which regulated group a business falls in, from what it sells.
// The owner's choice in settings (brand_memory.regulated) overrides this.
export type RegulatedGroup = 'none' | 'health' | 'finance' | 'alcohol' | 'legal';

const V2_GROUPS: Array<[Exclude<RegulatedGroup, 'none'>, string[]]> = [
  ['health', ['clinic', 'dental', 'dentist', 'doctor', 'hospital', 'medical', 'pharmacy', 'chemist', 'physio', 'chiropract', 'therapy', 'therapist', 'nutrition', 'dietitian', 'optician', 'optometr', 'skin clinic', 'aesthetic', 'botox', 'supplement', 'weight loss', 'ayurved', 'homeopath', 'osteopath', 'acupunct', 'mental health', 'counsel', 'health', 'medic', 'wellness', 'longevity', 'patient', 'pharma']],
  ['finance', ['tax', 'accountant', 'accounting', 'bookkeep', 'cpa', 'chartered', 'finance', 'financial', 'loan', 'mortgage', 'insurance', 'invest', 'wealth', 'credit', 'bank', 'crypto', 'trading', 'pension']],
  ['alcohol', ['wine', 'beer', 'brewery', 'brewing', 'distill', 'liquor', 'spirits', 'cocktail', 'pub', 'bar', 'taproom', 'off-licence', 'off licence', 'bottle shop']],
  ['legal', ['law firm', 'lawyer', 'attorney', 'solicitor', 'barrister', 'legal', 'notary', 'advocate', 'immigration consult', 'paralegal']],
];

// Short keywords (bar, pub, tax, cpa, bank, loan…) match whole words only, so
// "barbershop" or "taxi" do not count; longer ones match as substrings.
// 'medic' must start a word ("comedic" is not health) and 'patient' must be a whole word ("impatient" is not).
const WHOLE_WORD = new Set(['patient']);
const WORD_START = new Set(['medic']);

function matches(text: string, word: string): boolean {
  if (WHOLE_WORD.has(word)) return new RegExp(`\\b${word}s?\\b`).test(text);
  if (WORD_START.has(word)) return new RegExp(`\\b${word}`).test(text);
  if (word.length <= 4) return new RegExp(`\\b${word}s?\\b`).test(text);
  return text.includes(word);
}

export function regulatedGroup(whatTheySell: string): RegulatedGroup {
  const t = whatTheySell.toLowerCase();
  for (const [group, words] of V2_GROUPS) if (words.some((w) => matches(t, w))) return group;
  return 'none';
}

/**
 * The group a brand is treated as: the owner's choice in settings (brand_memory.regulated) when set, otherwise
 * detected from what they sell ("Automatic" is stored as null). Use this wherever the stored value is read.
 */
export function resolveRegulated(stored: string | null | undefined, whatTheySell: string | null | undefined): RegulatedGroup | 'other' {
  return ((stored || null) as RegulatedGroup | 'other' | null) ?? regulatedGroup(whatTheySell ?? '');
}
