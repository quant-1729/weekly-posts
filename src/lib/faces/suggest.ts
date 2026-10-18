// Ready-to-use Brand Face descriptions (no AI, no cost): safe, original character ideas tied to the business, so the
// owner can start from one instead of a blank box that image tools may decline. Deterministic: the same brand always
// gets the same suggestions. Pure: no database, safe in the browser.
//
// Every suggestion passes the same rules the description is checked against on save (no real person, nothing about
// looks or age, no known cartoon or film character) and also carries no uniform or credential (doctor, nurse, lawyer,
// banker), no text, letters or logo on the character, and, for a person, an adult only. A suggestion that would fail
// is dropped (a product word the owner typed could be anything), and a safe generic one takes its place.

import { regulatedGroup } from '@/lib/ai/regulated';
import { copiesKnownCharacter, namesRealPerson, unsuitableDescription } from './rules';
import { faceKindAllowed } from './types';

export interface SuggestBrand {
  businessName?: string | null;
  /** What the business is / sells, in the owner's words ("Bakery", "Yoga studio"). */
  category?: string | null;
  /** Names of the main things it sells. */
  products?: readonly string[] | null;
  city?: string | null;
  country?: string | null;
  /** Brand colours as #RRGGBB. */
  colors?: readonly (string | null | undefined)[] | null;
  /** The brand's voice or tone in the owner's words ("warm and playful"). */
  voice?: string | null;
  /** The brand's regulated area; worked out from the category when missing. */
  regulated?: string | null;
}

export const SUGGESTION_MAX = 300;
export const ILLUSTRATED_SUGGESTIONS = 3;
export const PHOTOREAL_SUGGESTIONS = 2;

// ---------------------------------------------------------------------------------------------
// Colour names
// ---------------------------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A plain English name for a #RRGGBB colour ("teal", "coral", "navy", "cream"); null when it is not a hex colour. */
export function hexColorName(hex: string): string | null {
  if (!HEX.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  if (l < 0.1) return 'black';
  if (l > 0.94) return 'white';
  if (sat < 0.12) return l < 0.35 ? 'charcoal' : l < 0.7 ? 'grey' : 'light grey';
  if (l > 0.85 && sat < 0.7) return h >= 15 && h < 70 ? 'cream' : h >= 300 || h < 15 ? 'blush' : h >= 70 && h < 170 ? 'mint' : 'pale blue';
  if (h < 12 || h >= 345) return l < 0.3 ? 'maroon' : l > 0.6 && sat > 0.6 ? 'coral' : 'red';
  if (h < 22) return l > 0.55 && sat > 0.6 ? 'coral' : l < 0.4 ? 'brown' : 'terracotta';
  if (h < 40) return l < 0.42 ? 'brown' : l > 0.7 ? 'peach' : 'orange';
  if (h < 52) return l < 0.4 ? 'olive' : 'gold';
  if (h < 68) return l < 0.4 ? 'olive' : 'yellow';
  if (h < 90) return 'lime';
  if (h < 160) return l < 0.3 ? 'forest green' : 'green';
  if (h < 195) return l < 0.3 ? 'deep teal' : 'teal';
  if (h < 215) return 'sky blue';
  if (h < 250) return l < 0.3 ? 'navy' : 'blue';
  if (h < 275) return 'indigo';
  if (h < 300) return 'purple';
  if (h < 330) return 'magenta';
  return 'pink';
}

/** "teal and coral" from the brand's colours (first two different names); '' when there are none. */
export function colorPhrase(colors: SuggestBrand['colors']): string {
  const names: string[] = [];
  for (const c of colors ?? []) {
    const n = typeof c === 'string' ? hexColorName(c) : null;
    if (n && !names.includes(n)) names.push(n);
    if (names.length === 2) break;
  }
  return names.join(' and ');
}

// ---------------------------------------------------------------------------------------------
// Business type and voice
// ---------------------------------------------------------------------------------------------

type Kind = 'food' | 'health' | 'beauty' | 'fashion' | 'education' | 'retail' | 'services' | 'fitness' | 'travel' | 'default';

const TYPE_WORDS: [Kind, string][] = [
  ['health', 'clinic|dental|dentist|doctor|hospital|medical|pharmac|chemist|physio|wellness|ayurved|homeopath|therap|health|diagnostic|optic|skin care|nutrition|dietit'],
  ['beauty', 'salon|beauty|spa\\b|barber|makeup|make-up|parlou?r|nail|hair|bridal|mehndi|mehendi|cosmetic|grooming'],
  ['fitness', 'gym|fitness|yoga|pilates|zumba|crossfit|martial|dance|sport|workout|trainer|personal training'],
  ['education', 'coaching|tuition|tutor|school|academy|institute|education|college|classes|course|learning|training|teach|lessons'],
  ['fashion', 'fashion|tailor|boutique|cloth|apparel|garment|saree|sari|dress|stitch|embroider|textile|jewel|footwear|shoe'],
  ['travel', 'travel|tour|trip|holiday|hotel|resort|homestay|hostel|trek|adventure|cab\\b|taxi|visa'],
  ['food', 'bak|cake|bread|pastr|cafe|café|coffee|tea\\b|teas\\b|chai|restaurant|food|kitchen|catering|sweet|mithai|snack|pizza|burger|biryani|thali|dhaba|bistro|eatery|juice|ice cream|dessert|chocolate|grocer|tiffin|meals?\\b'],
  ['services', 'repair|plumb|electric|clean|laundry|pest|paint|carpent|mechanic|garage|service|contractor|install|printing|photograph|studio|design|consult|agency|real estate|interior'],
  ['retail', 'shop|store|retail|mart|gift|furniture|toy|stationer|book|electronics|mobile|hardware|florist|flower|pet\\b|supermarket|boutique'],
];

function kindOf(text: string, regulated: string): Kind {
  if (regulated === 'health') return 'health';
  for (const [kind, words] of TYPE_WORDS) if (new RegExp(`(?:^|[^\\p{L}])(?:${words})`, 'iu').test(text)) return kind;
  return 'default';
}

const VOICES: [string, string][] = [
  ['calm|gentle|soothing|quiet|peaceful|soft', 'calm'],
  ['playful|fun|witty|quirky|cheeky|humou?r', 'playful'],
  ['warm|caring|kind|family|homely|friendly|casual|chatty|conversational|approachable', 'friendly'],
  ['bold|confident|energetic|energy|strong|dynamic|loud', 'cheerful'],
  ['elegant|premium|luxur|refined|classy|sophisticated|professional|formal', 'elegant'],
];

function voiceOf(voice: string | null | undefined, fallback: string): string {
  const t = voice ?? '';
  for (const [words, adj] of VOICES) if (new RegExp(`(?:^|[^\\p{L}])(?:${words})`, 'iu').test(t)) return adj;
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// Ideas per type. {v} is the voice word, {c} the colours.
// ---------------------------------------------------------------------------------------------

const ILLUSTRATED: Record<Kind, string[]> = {
  food: [
    'A {v} round cartoon bread loaf with a small chef\'s hat, big friendly eyes, simple flat shapes, in {c}',
    'A {v} cartoon steaming cup with a tiny smile and two small arms, simple rounded shapes, in {c}',
    'A {v} cartoon wooden spoon character with a wide smile and big eyes, simple flat shapes, in {c}',
  ],
  health: [
    'A calm, friendly round cartoon leaf character with a gentle smile, simple flat shapes, in soft {c}',
    'A {v} cartoon sun with a soft smile and small rounded rays, simple flat shapes, in soft {c}',
    'A {v} cartoon water drop character with big kind eyes, simple rounded shapes, in soft {c}',
  ],
  beauty: [
    'A {v} cartoon flower character with soft petals and a warm smile, simple flat shapes, in {c}',
    'A {v} cartoon butterfly with a friendly face and rounded wings, simple flat shapes, in {c}',
    'A {v} cartoon round hand mirror character with a gentle smile, simple flat shapes, in {c}',
  ],
  fashion: [
    'A {v} cartoon spool of thread with a friendly face and a tiny measuring tape scarf, simple flat shapes, in {c}',
    'A {v} cartoon clothes hanger character with big kind eyes and a small smile, simple flat shapes, in {c}',
    'A {v} cartoon button character with four dot eyes and a wide smile, simple round shapes, in {c}',
  ],
  education: [
    'A {v} cartoon owl with big round glasses and a kind smile, simple flat shapes, in {c}',
    'A {v} cartoon pencil character with big friendly eyes and a cheerful smile, simple flat shapes, in {c}',
    'A {v} cartoon lightbulb character with a smiling face, simple rounded shapes, in {c}',
  ],
  retail: [
    'A {v} cartoon shopping bag character with handle arms and a big smile, simple flat shapes, in {c}',
    'A {v} cartoon gift box with a bow and a friendly face, simple rounded shapes, in {c}',
    'A {v} cartoon round balloon character with a warm smile and a tiny string, simple flat shapes, in {c}',
  ],
  services: [
    'A {v} cartoon toolbox character with a big smile and little arms, simple flat shapes, in {c}',
    'A {v} cartoon friendly gear with big kind eyes, simple rounded shapes, in {c}',
    'A {v} cartoon wrench character with a cheerful face, simple flat shapes, in {c}',
  ],
  fitness: [
    'A {v} cartoon sneaker character with big eyes and a wide smile, simple flat shapes, in {c}',
    'A {v} cartoon water bottle character with a friendly face and small arms, simple rounded shapes, in {c}',
    'A {v} cartoon dumbbell character with a cheerful smile, simple flat shapes, in {c}',
  ],
  travel: [
    'A {v} cartoon suitcase character with little wheels and a big smile, simple flat shapes, in {c}',
    'A {v} cartoon paper plane with a friendly face, simple flat shapes, in {c}',
    'A {v} cartoon compass character with big kind eyes, simple rounded shapes, in {c}',
  ],
  default: [
    'A {v} cartoon mascot shaped like a smooth round pebble, with a friendly face, small arms and legs and a warm smile, simple flat shapes, in {c}',
    'A {v} cartoon smiling sun with small rounded rays, simple flat shapes, in {c}',
    'A {v} cartoon star character with a cheerful face and little arms, simple flat shapes, in {c}',
  ],
};

/** Where a food or retail brand can name what it sells: "A {v} cartoon <item> character ...". */
const ITEM_TEMPLATE = 'A {v} cartoon {item} character with big friendly eyes and a wide smile, simple flat shapes, in {c}';

const PHOTOREAL = [
  'A {v} adult woman in her thirties, warm smile, simple casual clothes in {c}, holding nothing',
  'A {v} adult man in his forties, relaxed smile, a plain shirt in {c}, hands by his sides',
];

// What a suggestion must never contain, on top of the save-time rules: credentials and uniforms, and anything that
// would put text or a logo on the character.
const NEVER_IN_SUGGESTION =
  /\b(?:doctor|dr\.?|nurse|lawyer|attorney|advocate|banker|surgeon|dentist|pharmacist|teacher|professor|uniform|scrubs|stethoscope|lab coat|badge|logo|letters?|text|words?|writing|sign|slogan|brand name|child|children|kid|kids|teen|teenage|baby)\b/i;

/** Whether a description is safe to offer: passes every save-time rule and carries no credential or text. */
export function suggestionIsSafe(description: string): boolean {
  return (
    [...description].length <= SUGGESTION_MAX &&
    !NEVER_IN_SUGGESTION.test(description) &&
    !namesRealPerson(description) &&
    !unsuitableDescription(description) &&
    !copiesKnownCharacter(description)
  );
}

/** One product name as a plain lower-case noun phrase ("veg thali"), or null when it is not simple enough to use. */
function itemOf(products: SuggestBrand['products']): string | null {
  for (const p of products ?? []) {
    const t = (p ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (/^[a-z]+(?: [a-z]+){0,2}$/.test(t) && t.length <= 28) return t;
  }
  return null;
}

const fillTemplate = (tpl: string, v: string, c: string, item = '') =>
  tpl
    .replace('{item}', item)
    .replace('{v}', v)
    .replace('in soft {c}', c ? `in soft ${c}` : 'in soft, friendly colours')
    .replace('in {c}', c ? `in ${c}` : 'in soft neutral colours');

/** "A elegant" -> "An elegant". */
const article = (text: string) => text.replace(/^A (?=[aeiouAEIOU])/, 'An ');

/**
 * Descriptions the owner can start from: 3 for a drawn character ('illustrated'), 2 for a realistic AI person
 * ('photoreal', none when the brand's area does not allow one). Made from the brand's category, what it sells,
 * colours and voice. Never contains the business name or place name (a name could be a famous one).
 */
export function suggestFaceDescriptions(brand: SuggestBrand, kind: 'illustrated' | 'photoreal'): string[] {
  const text = `${brand.category ?? ''} ${(brand.products ?? []).join(' ')}`;
  const regulated = brand.regulated || regulatedGroup(text);
  if (kind === 'photoreal' && !faceKindAllowed('photoreal', regulated)) return [];

  const type = kindOf(text, regulated);
  const v = voiceOf(brand.voice, type === 'health' ? 'calm' : 'friendly');
  const c = colorPhrase(brand.colors);
  const out: string[] = [];
  const push = (d: string) => {
    const done = article(d);
    if (suggestionIsSafe(done) && !out.includes(done)) out.push(done);
  };

  if (kind === 'photoreal') {
    for (const tpl of PHOTOREAL) push(fillTemplate(tpl, v === 'playful' ? 'cheerful' : v === 'elegant' ? 'calm' : v, c));
    // The photoreal templates always pass; this keeps the count even if a rule changes.
    return out.slice(0, PHOTOREAL_SUGGESTIONS);
  }

  const templates = [...ILLUSTRATED[type]];
  const item = type === 'food' || type === 'retail' ? itemOf(brand.products) : null;
  if (item) templates[2] = ITEM_TEMPLATE;
  for (const tpl of templates) push(fillTemplate(tpl, v, c, item ?? ''));
  // A product word that failed a rule is dropped: fill from the type's own ideas, then the generic ones.
  for (const tpl of [...ILLUSTRATED[type], ...ILLUSTRATED.default]) {
    if (out.length >= ILLUSTRATED_SUGGESTIONS) break;
    push(fillTemplate(tpl, v, c));
  }
  return out.slice(0, ILLUSTRATED_SUGGESTIONS);
}
