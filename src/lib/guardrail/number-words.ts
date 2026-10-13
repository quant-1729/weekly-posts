// Number words to digits (docs/guardrail.md section 3). Owners and the model write
// prices and quantities in words; the deterministic layer compares digits, so both
// sources and output are normalised first.
//
// Covers English, Hindi (Devanagari), Hinglish (roman Hindi), Spanish and French,
// plus Devanagari and Arabic-Indic digits. All positions refer to the ORIGINAL text:
// the digit conversion is one character for one character.

export type NumLang = 'en' | 'es' | 'fr' | 'hi' | 'hin';

type Cls = 'unit' | 'teen' | 'tens' | 'small' | 'hundred' | 'hundreds' | 'scale' | 'dozen' | 'frac' | 'mod';
interface Entry {
  v: number;
  c: Cls;
  /** Collides with an ordinary word ("do", "teen", "once", "un"): a lone token needs a money or unit word next to it. */
  amb?: boolean;
  /** Never multiplied by a digit ("5 cents" is not 500). */
  noDigit?: boolean;
}

const LANGS: NumLang[] = ['en', 'es', 'fr', 'hi', 'hin'];
const LEX: Record<NumLang, Map<string, Entry>> = { en: new Map(), es: new Map(), fr: new Map(), hi: new Map(), hin: new Map() };

const MARKS = new RegExp('\\p{M}', 'gu');
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(MARKS, '');
}
const DEVANAGARI = /[ऀ-ॿ]/;
/** Lookup key: NFC lower case; roman scripts also lose accents ("dieciséis" = "dieciseis"). */
export function wordKey(w: string): string {
  const k = w.normalize('NFC').toLowerCase();
  return DEVANAGARI.test(k) ? k : stripAccents(k);
}

function add(lang: NumLang, words: string, v: number, c: Cls, flags: Partial<Entry> = {}) {
  for (const w of words.split('/')) LEX[lang].set(wordKey(w), { v, c, ...flags });
}

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------
['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].forEach((w, i) => add('en', w, i + 1, 'unit'));
['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'].forEach((w, i) => add('en', w, 10 + i, 'teen'));
['twenty', 'thirty', 'forty/fourty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'].forEach((w, i) => add('en', w, (i + 2) * 10, 'tens'));
add('en', 'hundred', 100, 'hundred');
add('en', 'thousand', 1e3, 'scale');
add('en', 'lakh/lakhs/lac/lacs', 1e5, 'scale');
add('en', 'million/millions', 1e6, 'scale');
add('en', 'crore/crores', 1e7, 'scale');
add('en', 'billion/billions', 1e9, 'scale');
add('en', 'dozen', 12, 'dozen');

// ---------------------------------------------------------------------------
// Spanish
// ---------------------------------------------------------------------------
['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'].forEach((w, i) => add('es', w, i + 1, 'unit'));
add('es', 'un/una', 1, 'unit', { amb: true });
['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve'].forEach((w, i) =>
  add('es', w, 10 + i, 'teen', w === 'once' ? { amb: true } : {}),
);
add('es', 'veinte', 20, 'tens');
['veintiuno/veintiun/veintiuna', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve'].forEach((w, i) =>
  add('es', w, 21 + i, 'small'),
);
['treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'].forEach((w, i) => add('es', w, (i + 3) * 10, 'tens'));
add('es', 'cien/ciento', 100, 'hundreds');
['doscientos/doscientas', 'trescientos/trescientas', 'cuatrocientos/cuatrocientas', 'quinientos/quinientas', 'seiscientos/seiscientas', 'setecientos/setecientas', 'ochocientos/ochocientas', 'novecientos/novecientas'].forEach((w, i) =>
  add('es', w, (i + 2) * 100, 'hundreds'),
);
add('es', 'mil', 1e3, 'scale');
add('es', 'millon/millones', 1e6, 'scale');
add('es', 'docena', 12, 'dozen');

// ---------------------------------------------------------------------------
// French
// ---------------------------------------------------------------------------
['un/une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'].forEach((w, i) => add('fr', w, i + 1, 'unit', i === 0 || w === 'neuf' ? { amb: true } : {}));
['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'].forEach((w, i) => add('fr', w, 10 + i, 'teen'));
['vingt/vingts', 'trente', 'quarante', 'cinquante', 'soixante'].forEach((w, i) => add('fr', w, (i + 2) * 10, 'tens'));
add('fr', 'cent/cents', 100, 'hundred', { amb: true, noDigit: true });
add('fr', 'mille', 1e3, 'scale');
add('fr', 'million/millions', 1e6, 'scale');
add('fr', 'douzaine', 12, 'dozen');

// ---------------------------------------------------------------------------
// Hindi (Devanagari): 1-99 are irregular, so a full table
// ---------------------------------------------------------------------------
const HI_SMALL = [
  'एक', 'दो', 'तीन', 'चार', 'पाँच/पांच', 'छह/छः/छे/छै', 'सात', 'आठ', 'नौ', 'दस',
  'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह/पन्द्रह', 'सोलह', 'सत्रह', 'अठारह/अट्ठारह', 'उन्नीस', 'बीस',
  'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस/अठाईस', 'उनतीस', 'तीस',
  'इकतीस', 'बत्तीस', 'तैंतीस/तेंतीस/तेतीस', 'चौंतीस/चौतीस', 'पैंतीस/पैतीस', 'छत्तीस', 'सैंतीस/सैतीस', 'अड़तीस', 'उनतालीस/उन्तालीस/उनचालीस', 'चालीस',
  'इकतालीस', 'बयालीस', 'तैंतालीस/तैतालीस', 'चौवालीस/चवालीस/चौंवालीस', 'पैंतालीस/पैतालीस', 'छियालीस', 'सैंतालीस/सैतालीस', 'अड़तालीस', 'उनचास', 'पचास',
  'इक्यावन', 'बावन', 'तिरपन/तिरेपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन/अठावन', 'उनसठ', 'साठ',
  'इकसठ', 'बासठ', 'तिरसठ/तिरेसठ', 'चौंसठ/चौसठ', 'पैंसठ/पैसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर/उनहतर', 'सत्तर',
  'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी/उनासी/उन्नासी', 'अस्सी',
  'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी/अठासी', 'नवासी', 'नब्बे',
  'इक्यानवे/इक्यानबे', 'बानवे/बानबे', 'तिरानवे/तिरानबे', 'चौरानवे/चौरानबे', 'पचानवे/पचानबे', 'छियानवे/छियानबे', 'सत्तानवे/सत्तानबे', 'अट्ठानवे/अठानवे', 'निन्यानवे/निन्यानबे',
];
HI_SMALL.forEach((w, i) => add('hi', w, i + 1, 'small', i === 1 ? { amb: true } : {})); // "दो" also means "give"
add('hi', 'सौ', 100, 'hundred');
add('hi', 'हज़ार/हजार/हज़ार', 1e3, 'scale');
add('hi', 'लाख', 1e5, 'scale');
add('hi', 'करोड़/करोड/करोड़', 1e7, 'scale');
add('hi', 'अरब', 1e9, 'scale');
add('hi', 'डेढ़/डेढ', 1.5, 'frac');
add('hi', 'ढाई/अढ़ाई/अढाई', 2.5, 'frac');
add('hi', 'सवा', 0.25, 'mod');
add('hi', 'साढ़े/साढे', 0.5, 'mod');
add('hi', 'पौने', -0.25, 'mod');
add('hi', 'दर्जन', 12, 'dozen');

// ---------------------------------------------------------------------------
// Hinglish (roman Hindi). Spellings vary widely; these are the common ones.
// ---------------------------------------------------------------------------
const HIN_SMALL = [
  'ek', 'do', 'teen', 'char/chaar', 'paanch/panch', 'chhe/chhah/chah/che', 'saat', 'aath', 'nau', 'das',
  'gyarah/gyaarah/giyarah', 'barah/baarah', 'terah/tera', 'chaudah/chaudaha', 'pandrah/pandra', 'solah/sola', 'satrah/satra', 'atharah/athaarah', 'unnis/unees', 'bees',
  'ikkis/ikkees', 'baais/bais', 'teis/teyis', 'chaubis/chaubees', 'pachchis/pachis/pacchis/pachees', 'chhabbis/chabbis', 'sattais/satais', 'atthais/athais', 'untis/unatees', 'tees/tis',
  'ikattis/iktis', 'battis/battees', 'taintis/tentis', 'chauntis', 'paintis/paitis', 'chhattis/chhatis', 'saintis', 'adtis/adtees', 'untalis/unchalis', 'chalees/chalis/chaalis',
  'ikktalis/iktalis', 'bayalis/byalis', 'taintalis/tentalis', 'chauvalis/chavalis', 'paintalis/paitalis', 'chiyalis/chhiyalis', 'saintalis', 'adtalis', 'unchas/unanchas', 'pachaas/pachas',
  'ikyavan/ikyawan', 'bavan/bawan', 'tirpan/tirepan', 'chauvan/chauwan', 'pachpan', 'chhappan/chappan', 'sattavan', 'atthavan/athavan', 'unsath', 'saath/saadh',
  'iksath', 'basath', 'tirsath', 'chausath', 'painsath', 'chhiyasath', 'sadsath', 'adsath', 'unhattar', 'sattar',
  'ikhattar', 'bahattar', 'tihattar', 'chauhattar', 'pachhattar/pachattar', 'chhihattar', 'satahattar/satattar', 'athhattar', 'unyasi/unaasi', 'assi',
  'ikyasi', 'bayasi', 'tirasi', 'chaurasi', 'pachasi', 'chhiyasi', 'sattasi', 'atthasi/athasi', 'navasi/nawasi', 'nabbe',
  'ikyanve', 'baanve/banve', 'tiranve', 'chauranve', 'pachanve', 'chhiyanve', 'sattanve', 'atthanve', 'ninyanve/ninyaanve',
];
const HIN_AMB = new Set([1, 2, 3, 8, 9, 59]); // do, teen, char, nau, das, saath (index from 0 = value-1)
HIN_SMALL.forEach((w, i) => add('hin', w, i + 1, 'small', HIN_AMB.has(i) ? { amb: true } : {}));
add('hin', 'sau', 100, 'hundred');
add('hin', 'hazaar/hajar/hazar/hajaar', 1e3, 'scale');
add('hin', 'lakh/lakhs/lac/lacs', 1e5, 'scale');
add('hin', 'crore/crores/karod', 1e7, 'scale');
add('hin', 'arab', 1e9, 'scale');
add('hin', 'dedh/derh', 1.5, 'frac');
add('hin', 'dhai/dhaai/adhai', 2.5, 'frac');
add('hin', 'sava/sawa', 0.25, 'mod');
add('hin', 'saadhe/sadhe/saade', 0.5, 'mod');
add('hin', 'paune/pone', -0.25, 'mod');

// ---------------------------------------------------------------------------
// Currency words (major/minor: "four pounds fifty" = 4.50) and context words
// ---------------------------------------------------------------------------
export interface CurrencyWord {
  /** ISO-like id; '$' is the generic dollar sign (US, Canada, Australia, Singapore). */
  code: string;
  /** What the normalised text carries before the amount. */
  symbol: string;
}
const cw = (words: string, code: string, symbol: string): Array<[string, CurrencyWord]> =>
  words.split('/').map((w) => [wordKey(w), { code, symbol }]);
export const CURRENCY_WORDS = new Map<string, CurrencyWord>([
  ...cw('pound/pounds/libra/libras', 'GBP', '£'),
  ...cw('dollar/dollars/dolar/dolares', '$', '$'),
  ...cw('euro/euros', 'EUR', '€'),
  ...cw('rupee/rupees/rupaye/rupaiye/rupya/रुपये/रुपए/रुपया', 'INR', '₹'),
  ...cw('dirham/dirhams', 'AED', 'AED '),
  ...cw('rand', 'ZAR', 'R'),
]);
const MINOR_UNITS = new Set(['pence', 'penny', 'pennies', 'cents', 'cent', 'centimes', 'centavos', 'paise', 'paisa', 'fils', 'पैसे', 'पैसा'].map(wordKey));
const CONNECTORS: Record<NumLang, Set<string>> = {
  en: new Set(['and']),
  es: new Set(['y']),
  fr: new Set(['et']),
  hi: new Set(),
  hin: new Set(),
};
const MINOR_CONNECTORS = new Set(['and', 'con', 'y', 'et']);
/** Words that make a lone ambiguous number word ("do", "teen") a real number. */
const CONTEXT_WORDS = new Set(
  [
    ...CURRENCY_WORDS.keys(),
    'rs', 'inr', 'aed', 'usd', 'gbp', 'eur', 'rupaye', 'baje', 'bajey', 'din', 'ghante', 'ghanta', 'minute', 'minutes', 'mahine', 'saal', 'percent', 'pratishat',
    'kg', 'kilo', 'gram', 'litre', 'piece', 'pieces', 'pcs', 'log', 'hours', 'hour', 'days', 'day', 'years', 'people',
    'रु', 'बजे', 'दिन', 'घंटे', 'घंटा', 'मिनट', 'प्रतिशत', 'साल', 'महीने', 'किलो', 'ग्राम', 'लीटर', 'पीस', 'लोग', 'घंटों', 'हफ्ते',
    'heures', 'jours', 'ans', 'personnes', 'horas', 'dias', 'anos', 'personas',
  ].map(wordKey),
);
const CURRENCY_BEFORE = /(?:[₹£$€]|\bRs\.?|\bINR|\bAED|\bUSD|\bGBP|\bEUR)\s?$/i;

// ---------------------------------------------------------------------------
// Digits in other scripts
// ---------------------------------------------------------------------------

const ASCII_MAP = (() => {
  const m = new Map<string, string>();
  for (let i = 0; i < 10; i++) {
    m.set(String.fromCharCode(0x0966 + i), String(i)); // Devanagari
    m.set(String.fromCharCode(0x0660 + i), String(i)); // Arabic-Indic
    m.set(String.fromCharCode(0x06f0 + i), String(i)); // Extended Arabic-Indic (Persian, Urdu)
  }
  return m;
})();
const NON_ASCII_DIGIT = /[०-९٠-٩۰-۹]/g;
const ARABIC_DECIMAL = new RegExp('(?<=\\d)٫(?=\\d)', 'g');
const ARABIC_THOUSANDS = new RegExp('(?<=\\d)٬(?=\\d)', 'g');

/** Devanagari and Arabic-Indic digits to ASCII, and Arabic decimal/thousands marks to . and ,. Same length as the input. */
export function toAsciiDigits(s: string): string {
  return s.replace(NON_ASCII_DIGIT, (d) => ASCII_MAP.get(d) ?? d).replace(ARABIC_DECIMAL, '.').replace(ARABIC_THOUSANDS, ',');
}

/** The same number the way checks.ts numbersIn() writes it: no thousands commas, no trailing .0, "4,50" read as 4.50. */
export function canonicalNumber(raw: string): string {
  const r = /^\d+,\d{1,2}$/.test(raw) ? raw.replace(',', '.') : raw.replace(/,/g, '');
  return r.replace(/\.0+$/, '');
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

export interface NumberSpan {
  start: number;
  end: number;
  /** Original text of the span. */
  text: string;
  /** Digits, as numbersIn() would read them ("4.50", "240", "1500000"). */
  value: string;
  /** True when the span holds a number word (or a digit with a scale word, like "2 सौ"). */
  words: boolean;
  /** A single number word, such as "one". */
  single: boolean;
  /** Set when the span also holds the currency ("four pounds fifty"). */
  currency?: CurrencyWord;
}

interface Tok {
  start: number;
  end: number;
  s: string;
  key: string;
  num: boolean;
  val: number;
}
const TOKEN = new RegExp('[\\p{L}\\p{M}]+|\\d+(?:[.,]\\d+)*', 'gu');
function tokenize(ascii: string): Tok[] {
  const out: Tok[] = [];
  for (const m of ascii.matchAll(TOKEN)) {
    const s = m[0];
    const num = /^\d/.test(s);
    out.push({ start: m.index!, end: m.index! + s.length, s, key: num ? s : wordKey(s), num, val: num ? Number(canonicalNumber(s)) : NaN });
  }
  return out;
}
const GAP = /^[ \t \-‐‑–]*$/;
function gapOk(ascii: string, a: Tok, b: Tok): boolean {
  return GAP.test(ascii.slice(a.end, b.start));
}
function lookup(lang: NumLang, t: Tok | undefined): Entry | undefined {
  return t && !t.num ? LEX[lang].get(t.key) : undefined;
}

interface St {
  total: number;
  lastScale: number;
  hundreds: number;
  below: number;
  has: boolean;
  frac: boolean;
  n: number;
  done: boolean;
}
const valueOf = (st: St) => st.total + st.hundreds + (st.has ? st.below : 0);

function apply(st: St, e: Entry, lang: NumLang): St | null {
  const s = { ...st };
  switch (e.c) {
    case 'unit':
    case 'teen':
    case 'tens':
    case 'small': {
      if (s.done) return null;
      if (s.has) {
        const b = s.below;
        if (s.frac) return null;
        const roman = lang === 'en' || lang === 'es' || lang === 'fr';
        if (roman && e.c === 'unit' && b >= 20 && b % 10 === 0) s.below = b + e.v;
        else if (lang === 'fr' && e.c === 'teen' && (b === 60 || b === 80)) s.below = b + e.v;
        else if (lang === 'fr' && e.c === 'unit' && b === 10 && e.v >= 7) s.below = b + e.v;
        else if (lang === 'en' && e.c === 'tens' && b < 10 && s.hundreds === 0 && s.total === 0) {
          // "one fifty" = 150
          s.hundreds = b * 100;
          s.below = e.v;
        } else return null;
      } else {
        s.below = e.v;
        s.has = true;
      }
      s.n++;
      return s;
    }
    case 'hundred': {
      if (s.done || s.hundreds > 0) return null;
      const coef = s.has ? s.below : 1;
      if (coef <= 0 || coef >= 100) return null;
      s.hundreds = coef * 100;
      s.below = 0;
      s.has = false;
      s.frac = false;
      s.n++;
      return s;
    }
    case 'hundreds': {
      if (s.done || s.has || s.hundreds > 0) return null;
      s.hundreds = e.v;
      s.n++;
      return s;
    }
    case 'scale': {
      if (s.done) return null;
      let coef = s.hundreds + (s.has ? s.below : 0);
      if (coef === 0) {
        if (s.n > 0) return null;
        coef = 1;
      }
      if (e.v >= s.lastScale || coef >= 1000) return null;
      s.total += coef * e.v;
      s.lastScale = e.v;
      s.hundreds = 0;
      s.below = 0;
      s.has = false;
      s.frac = false;
      s.n++;
      return s;
    }
    case 'dozen': {
      if (s.done) return null;
      const coef = s.hundreds + (s.has ? s.below : 0) || 1;
      s.total += coef * 12;
      s.hundreds = 0;
      s.below = 0;
      s.has = false;
      s.done = true;
      s.n++;
      return s;
    }
    case 'frac': {
      if (s.done || s.has || s.hundreds > 0) return null;
      s.below = e.v;
      s.has = true;
      s.frac = true;
      s.n++;
      return s;
    }
    default:
      return null;
  }
}

function connectorOk(st: St, lang: NumLang): boolean {
  if (st.n === 0 || st.done) return false;
  if (lang === 'en') return (st.hundreds > 0 || st.total > 0) && !st.has;
  if (lang === 'es' || lang === 'fr') return st.has && !st.frac && st.below >= 20 && st.below % 10 === 0;
  return false;
}

interface Parsed {
  value: number;
  next: number; // index of the first token after the phrase
  count: number; // tokens used
  lang: NumLang;
}

function parseAt(ascii: string, toks: Tok[], i: number, lang: NumLang): Parsed | null {
  let st: St = { total: 0, lastScale: Infinity, hundreds: 0, below: 0, has: false, frac: false, n: 0, done: false };
  let j = i;
  const first = toks[i];

  if (lang === 'en' && !first.num) {
    // "a hundred", "an hundred", "half a dozen"
    const nx = toks[i + 1];
    if ((first.key === 'a' || first.key === 'an') && nx && gapOk(ascii, first, nx)) {
      const e2 = lookup('en', nx);
      if (e2 && (e2.c === 'hundred' || e2.c === 'scale' || e2.c === 'dozen')) {
        st = { ...st, below: 1, has: true, n: 1 };
        j = i + 1;
      } else return null;
    } else if (first.key === 'half' && nx && gapOk(ascii, first, nx) && (nx.key === 'a' || nx.key === 'an') && toks[i + 2] && gapOk(ascii, nx, toks[i + 2]) && toks[i + 2].key === 'dozen') {
      return { value: 6, next: i + 3, count: 3, lang };
    }
  }

  while (j < toks.length) {
    const t = toks[j];
    if (j > i && !gapOk(ascii, toks[j - 1], t)) break;

    if (t.num) {
      const nx = toks[j + 1];
      const ne = nx && gapOk(ascii, t, nx) ? lookup(lang, nx) : undefined;
      if (ne && !st.has && !st.done && (ne.c === 'hundred' || ne.c === 'dozen' || (ne.c === 'scale' && !ne.noDigit)) && !(ne.c === 'hundred' && ne.noDigit)) {
        st = { ...st, below: t.val, has: true, frac: !Number.isInteger(t.val), n: st.n + 1 };
        j++;
        continue;
      }
      // "2 सौ 40": digits after a hundred or a scale word, Hindi only
      if ((lang === 'hi' || lang === 'hin') && st.n > 0 && !st.has && !st.done && Number.isInteger(t.val) && (st.hundreds > 0 ? t.val < 100 : st.total > 0 && t.val < st.lastScale)) {
        st = { ...st, below: t.val, has: true, n: st.n + 1 };
        j++;
        continue;
      }
      break;
    }

    const e = lookup(lang, t);
    if (e && e.c === 'mod') {
      if (st.n > 0 && (st.has || st.hundreds > 0)) break;
      const nx = toks[j + 1];
      const ne = nx && gapOk(ascii, t, nx) ? lookup(lang, nx) : undefined;
      if (ne && (ne.c === 'small' || ne.c === 'unit')) {
        st = { ...st, below: ne.v + e.v, has: true, frac: true, n: st.n + 1 };
        j += 2;
        continue;
      }
      if (ne && (ne.c === 'hundred' || ne.c === 'scale')) {
        st = { ...st, below: 1 + e.v, has: true, frac: true, n: st.n + 1 };
        j += 1;
        continue;
      }
      break;
    }
    if (e) {
      const nst = apply(st, e, lang);
      if (!nst) break;
      st = nst;
      j++;
      continue;
    }
    // connectors: "one hundred and five", "treinta y cinco", "vingt et un"
    if (CONNECTORS[lang].has(t.key) && connectorOk(st, lang) && toks[j + 1] && gapOk(ascii, t, toks[j + 1])) {
      const e2 = lookup(lang, toks[j + 1]);
      const nst = e2 ? apply(st, e2, lang) : null;
      if (nst) {
        st = nst;
        j += 2;
        continue;
      }
    }
    // French "quatre-vingt" = 80 (quatre was read as a unit above): fix up below
    break;
  }

  // French 80: "quatre vingt(s)" reads as 4 then 20, which apply() rejects; handle it directly.
  if (lang === 'fr' && st.n === 1 && first.key === 'quatre' && toks[i + 1] && /^vingts?$/.test(toks[i + 1].key) && gapOk(ascii, first, toks[i + 1])) {
    return parseFrench80(ascii, toks, i);
  }
  if (st.n === 0 || j === i) return null;
  return { value: Math.round(valueOf(st) * 100) / 100, next: j, count: j - i, lang };
}

function parseFrench80(ascii: string, toks: Tok[], i: number): Parsed | null {
  let st: St = { total: 0, lastScale: Infinity, hundreds: 0, below: 80, has: true, frac: false, n: 2, done: false };
  let j = i + 2;
  while (j < toks.length && gapOk(ascii, toks[j - 1], toks[j])) {
    const e = lookup('fr', toks[j]);
    if (e) {
      const nst = apply(st, e, 'fr');
      if (!nst) break;
      st = nst;
      j++;
    } else if (CONNECTORS.fr.has(toks[j].key) && toks[j + 1] && gapOk(ascii, toks[j], toks[j + 1])) {
      const e2 = lookup('fr', toks[j + 1]);
      const nst = e2 ? apply(st, e2, 'fr') : null;
      if (!nst) break;
      st = nst;
      j += 2;
    } else break;
  }
  return { value: Math.round(valueOf(st) * 100) / 100, next: j, count: j - i, lang: 'fr' };
}

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(2)));
}

function hasContext(ascii: string, toks: Tok[], p: Parsed): boolean {
  const last = toks[p.next - 1];
  const nx = toks[p.next];
  if (nx && gapOk(ascii, last, nx) && CONTEXT_WORDS.has(nx.key)) return true;
  return CURRENCY_BEFORE.test(ascii.slice(Math.max(0, toks[p.next - p.count].start - 6), toks[p.next - p.count].start));
}

/** Word-number phrases (and digit + scale word, like "2 सौ") in text that is already ASCII-digit. */
function scanWords(ascii: string): NumberSpan[] {
  const toks = tokenize(ascii);
  const spans: NumberSpan[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    let best: Parsed | null = null;
    for (const lang of LANGS) {
      const known = t.num || lookup(lang, t) !== undefined || (lang === 'en' && (t.key === 'a' || t.key === 'an' || t.key === 'half')) || (lang === 'fr' && t.key === 'quatre');
      if (!known) continue;
      const p = parseAt(ascii, toks, i, lang);
      if (p && (!best || p.count > best.count)) best = p;
    }

    // "4 pounds fifty": digits as the major part
    if (t.num && toks[i + 1] && gapOk(ascii, t, toks[i + 1]) && CURRENCY_WORDS.has(toks[i + 1].key) && Number.isInteger(t.val)) {
      const ext = extendMinor(ascii, toks, i + 1, t.val, i);
      if (ext) {
        spans.push(ext.span);
        i = ext.next;
        continue;
      }
    }
    if (!best) {
      i++;
      continue;
    }
    // A lone ambiguous word ("do", "teen", "once") is a number only next to a money or unit word.
    if (best.count === 1 && !t.num) {
      const e = lookup(best.lang, t);
      if (e?.amb && !hasContext(ascii, toks, best)) {
        i++;
        continue;
      }
    }
    if (!t.num && best.count >= 1) {
      const ext = Number.isInteger(best.value) ? extendMinor(ascii, toks, best.next, best.value, i, best.lang) : null;
      if (ext) {
        spans.push(ext.span);
        i = ext.next;
        continue;
      }
    }
    const first = toks[i];
    const last = toks[best.next - 1];
    spans.push({
      start: first.start,
      end: last.end,
      text: ascii.slice(first.start, last.end),
      value: fmt(best.value),
      words: true,
      single: best.count === 1 && !t.num,
    });
    i = best.next;
  }
  return spans;
}

/**
 * After a whole-number phrase: "<currency word> [and] <minor>" = major.minor with currency.
 * Returns null when the pattern is not there.
 */
function extendMinor(ascii: string, toks: Tok[], k: number, major: number, startTok: number, lang?: NumLang): { span: NumberSpan; next: number } | null {
  const cwTok = toks[k];
  const cur = cwTok && CURRENCY_WORDS.get(cwTok.key);
  if (!cur || !gapOk(ascii, toks[k - 1], cwTok)) return null;
  let m = k + 1;
  if (toks[m] && gapOk(ascii, cwTok, toks[m]) && MINOR_CONNECTORS.has(toks[m].key) && toks[m + 1] && gapOk(ascii, toks[m], toks[m + 1])) m++;
  if (!toks[m] || !gapOk(ascii, toks[m - 1], toks[m]) || toks[m].num) return null;
  let best: Parsed | null = null;
  for (const l of lang ? [lang] : LANGS) {
    if (lookup(l, toks[m]) === undefined) continue;
    const p = parseAt(ascii, toks, m, l);
    if (p && (!best || p.count > best.count)) best = p;
  }
  if (!best || !Number.isInteger(best.value) || best.value < 0 || best.value > 99) return null;
  let next = best.next;
  if (toks[next] && gapOk(ascii, toks[next - 1], toks[next]) && MINOR_UNITS.has(toks[next].key)) next++;
  const minor = String(best.value).padStart(2, '0');
  const first = toks[startTok];
  const last = toks[next - 1];
  return {
    next,
    span: {
      start: first.start,
      end: last.end,
      text: ascii.slice(first.start, last.end),
      value: `${major}.${minor}`,
      words: true,
      single: false,
      currency: cur,
    },
  };
}

const DIGIT_RUN = /\d+(?:,\d+)*(?:\.\d+)?/g;

/** Every number in the text, digits or words, in order, positions in the ORIGINAL text. */
export function findNumberSpans(text: string): NumberSpan[] {
  const ascii = toAsciiDigits(text);
  const words = scanWords(ascii);
  const spans: NumberSpan[] = [...words];
  for (const m of ascii.matchAll(DIGIT_RUN)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (words.some((w) => start < w.end && w.start < end)) continue;
    spans.push({ start, end, text: text.slice(start, end), value: canonicalNumber(m[0]), words: false, single: false });
  }
  return spans.sort((a, b) => a.start - b.start).map((s) => ({ ...s, text: text.slice(s.start, s.end) }));
}

/** Text with each number phrase written as digits (ASCII digits, "4,50" as 4.50, "four pounds fifty" as £4.50). */
export function normalizeNumberWords(text: string): string {
  const ascii = toAsciiDigits(text);
  const spans = findNumberSpans(text);
  let out = '';
  let pos = 0;
  for (const s of spans) {
    out += ascii.slice(pos, s.start);
    if (s.words) out += s.currency ? `${s.currency.symbol}${s.value}` : s.value;
    else out += /^\d+,\d{1,2}$/.test(ascii.slice(s.start, s.end)) ? ascii.slice(s.start, s.end).replace(',', '.') : ascii.slice(s.start, s.end);
    pos = s.end;
  }
  return out + ascii.slice(pos);
}

/**
 * The text plus its digit forms, for use as a SOURCE: numbersIn() then sees the
 * original digits, the converted number words, and 4.5 / 4.50 spellings of the same
 * decimal. (For the text being checked, use normalizeNumberWords: it must not keep
 * half a number, such as the "2" of "2 सौ".)
 */
export function withNumberDigits(text: string): string {
  const norm = normalizeNumberWords(text);
  const extra = new Set<string>();
  for (const m of norm.matchAll(/\d+\.\d+/g)) {
    const stripped = m[0].replace(/0+$/, '');
    extra.add(stripped);
    if (/^\d+\.\d$/.test(m[0])) extra.add(`${m[0]}0`);
  }
  const lines = [text];
  if (norm !== text) lines.push(norm);
  if (extra.size) lines.push([...extra].join(' '));
  return lines.join('\n');
}
