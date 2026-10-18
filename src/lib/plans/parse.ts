// Weekly offer plans: the owner's week in one sentence ("Mon 10%, Tue 20%, Wed 30%, Fri 10%, Sat and Sun 15% off on
// all cakes") read by code into one offer per day. Pure: no AI, so nothing is invented; anything not understood is
// left for the owner to fill in.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export type OfferKind = 'percent' | 'amount' | 'text';

export interface PlanDayInput {
  day: Weekday;
  on: boolean;
  kind: OfferKind;
  /** Percent (1-100) or amount off. */
  value: number | null;
  /** For kind 'text': the offer as the owner says it ("Buy 1 get 1 free"). */
  text: string;
}

const DAY_RE: [RegExp, Weekday][] = [
  [/^mon(day)?$/i, 'mon'],
  [/^tue(s|sday)?$/i, 'tue'],
  [/^wed(nesday)?$/i, 'wed'],
  [/^thu(r|rs|rsday)?$/i, 'thu'],
  [/^fri(day)?$/i, 'fri'],
  [/^sat(urday)?$/i, 'sat'],
  [/^sun(day)?$/i, 'sun'],
  // Hindi / Hinglish day names
  [/^(somvar|सोमवार)$/i, 'mon'],
  [/^(mangalvar|मंगलवार)$/i, 'tue'],
  [/^(budhvar|बुधवार)$/i, 'wed'],
  [/^(guruvar|गुरुवार)$/i, 'thu'],
  [/^(shukravar|शुक्रवार)$/i, 'fri'],
  [/^(shanivar|शनिवार)$/i, 'sat'],
  [/^(ravivar|रविवार)$/i, 'sun'],
];

function dayOf(word: string): Weekday | null {
  const w = word.replace(/[^a-zA-Zऀ-ॿ]/g, '');
  for (const [re, d] of DAY_RE) if (re.test(w)) return d;
  return null;
}

const range = (a: Weekday, b: Weekday): Weekday[] => {
  const i = WEEKDAYS.indexOf(a);
  const j = WEEKDAYS.indexOf(b);
  return i <= j ? WEEKDAYS.slice(i, j + 1) : [...WEEKDAYS.slice(i), ...WEEKDAYS.slice(0, j + 1)];
};

export interface ParsedWeek {
  days: PlanDayInput[];
  /** What the offers are on, when the sentence says ("on all cakes"). */
  on: string;
  /** Parts of the sentence that were not understood. */
  unread: string[];
}

export function emptyWeek(): PlanDayInput[] {
  return WEEKDAYS.map((day) => ({ day, on: false, kind: 'percent', value: null, text: '' }));
}

/**
 * Reads a week of offers. Each part names one or more days ("Mon", "Sat & Sun", "Sat-Sun", "weekend", "every day")
 * followed by an offer ("10%", "20% off", "Rs 50 off", "₹50 off", "buy 1 get 1"). A part with days but no offer takes the
 * next part's offer ("Sat and Sun 15%").
 */
export function parseWeek(sentence: string): ParsedWeek {
  const days = emptyWeek();
  const unread: string[] = [];
  let text = sentence.replace(/\s+/g, ' ').trim();
  let on = '';
  const onMatch = /\b(?:on|for)\s+((?:all|every|our|any|selected)?\s*[a-z][a-z\s&'-]{2,40}?)\s*(?:[.!]|$)/i.exec(text);
  if (onMatch && !dayOf(onMatch[1].split(' ')[0])) {
    on = onMatch[1].trim();
    text = text.slice(0, onMatch.index).trim();
  }
  const parts = text.split(/[,;\n]|\.\s+|\s+(?:then|and then)\s+/i).map((p) => p.trim()).filter(Boolean);
  let pending: Weekday[] = [];
  for (const part of parts) {
    const words = part.split(/\s+/);
    const found: Weekday[] = [];
    const dayIdx = new Set<number>();
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const m = /^([a-z]+)\s*[-–]\s*([a-z]+)$/i.exec(w);
      if (m && dayOf(m[1]) && dayOf(m[2])) {
        found.push(...range(dayOf(m[1])!, dayOf(m[2])!));
        dayIdx.add(i);
      } else if (/^(to|till|until|-|–)$/i.test(w) && found.length && dayOf(words[i + 1] ?? '')) {
        found.push(...range(found[found.length - 1], dayOf(words[i + 1])!).slice(1));
        dayIdx.add(i).add(i + 1);
        i++;
      } else if (/^weekends?$/i.test(w)) {
        found.push('sat', 'sun');
        dayIdx.add(i);
      } else if (/^weekdays?$/i.test(w)) {
        found.push('mon', 'tue', 'wed', 'thu', 'fri');
        dayIdx.add(i);
      } else if (/^(daily|everyday)$/i.test(w) || (/^every$/i.test(w) && /^day$/i.test(words[i + 1] ?? ''))) {
        found.push(...WEEKDAYS);
        dayIdx.add(i);
        if (/^every$/i.test(w)) dayIdx.add(++i);
      } else if (dayOf(w)) {
        found.push(dayOf(w)!);
        dayIdx.add(i);
      }
    }
    const rest = words.filter((_, i) => !dayIdx.has(i)).join(' ');
    const offer = readOffer(rest);
    const filler = rest.replace(/\b(on|i|we|will|shall|issue|give|giving|offer|it|would|be|is|are|again|have|discount|discounts|off|and|aur|only|the|a|an|also|there|get|gets)\b/gi, '').replace(/[&:\-–]/g, '').trim();
    const targets = [...new Set([...pending, ...found])];
    if (offer.kind === 'text' && filler.length < 3) {
      pending = targets;
      continue;
    }
    pending = [];
    if (targets.length === 0) {
      unread.push(part);
      continue;
    }
    const clean = offer.kind === 'text' ? { ...offer, text: rest.replace(/^(on|:|-)\s+/i, '').trim().slice(0, 60) } : offer;
    for (const t of targets) days[WEEKDAYS.indexOf(t)] = { day: t, on: true, ...clean };
  }
  if (pending.length) unread.push(pending.map((d) => WEEKDAY_LABEL[d]).join(', '));
  return { days, on, unread };
}

/** "20%", "20% off", "flat 20 percent", "Rs 50 off", "₹50 off", anything else as text. */
export function readOffer(raw: string): { kind: OfferKind; value: number | null; text: string } {
  const t = raw.trim();
  const pct = /(\d{1,3}(?:\.\d)?)\s*(%|percent|per cent|pc)/i.exec(t);
  if (pct) {
    const v = Math.min(100, Number(pct[1]));
    return { kind: 'percent', value: v, text: '' };
  }
  const amt = /(?:₹|rs\.?|inr|rupees?)\s*(\d{1,6})|(\d{1,6})\s*(?:₹|rs\.?|rupees?)/i.exec(t);
  if (amt) return { kind: 'amount', value: Number(amt[1] ?? amt[2]), text: '' };
  const bare = /^(\d{1,2})$/.exec(t);
  if (bare) return { kind: 'percent', value: Number(bare[1]), text: '' };
  return { kind: 'text', value: null, text: t.slice(0, 60) };
}

/** The offer as the poster's big words. */
export function offerWords(d: Pick<PlanDayInput, 'kind' | 'value' | 'text'>, currency = 'INR'): string {
  if (d.kind === 'percent' && d.value) return `${d.value}% OFF`;
  if (d.kind === 'amount' && d.value) return `${currency === 'INR' ? '₹' : `${currency} `}${d.value} OFF`;
  return d.text.trim().toUpperCase();
}

/** The dates of a plan's week: the next 7 days from `start` (YYYY-MM-DD), keyed by weekday. */
export function weekDates(start: string): Record<Weekday, string> {
  const [y, m, d] = start.split('-').map(Number);
  const out = {} as Record<Weekday, string>;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const wd = WEEKDAYS[(dt.getUTCDay() + 6) % 7];
    out[wd] = dt.toISOString().slice(0, 10);
  }
  return out;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
