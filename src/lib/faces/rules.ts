// Brand Face rules that are plain code (docs/10 section 2, "Safety rules"). Pure: no database, safe in the browser.
// The service applies them on every write; the design step applies `faceShownFor` on every picture.

import { BLOCKLIST, findBlockedTerm } from '@/lib/ai/mascot-blocklist';
import { POST_TYPES, type PostType } from '@/lib/briefs/types';
import { CHARACTER_IDS, type CharacterId } from '@/lib/characters/types';
import { FAME_WORDS, FAMOUS_PEOPLE } from './blocklist';
import { FaceError } from './errors';
import {
  FACE_KINDS,
  FACE_STYLES,
  faceKindAllowed,
  type FaceKind,
  type FacePlacement,
  type FaceStyle,
} from './types';

export const FACE_NAME_MAX = 40;
export const FACE_DESCRIPTION_MAX = 600;
export const NEVER_SAY_MAX = 10;
export const NEVER_SAY_CHARS = 60;

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’.-]*$/u;

/** The words that point at a person ("looks like", "based on"), then optional articles; the name itself is checked after it. */
const LEAD_RE =
  /\b(?:look(?:s|ing|ed)?\s+like|resembl(?:es?|ing)|(?:based|modell?ed|styled)\s+(?:on|after)|inspired\s+by|in\s+the\s+image\s+of|(?:face|photo|picture|portrait)\s+of|same\s+(?:face|look)\s+as|similar\s+to)\s+(?:(?:a|an|the|famous|young|old)\s+)*/giu;
/** A capitalised name of two or more words ("Taylor Swift"). */
const NAME_AFTER_RE = /^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*)+/u;

const norm = (t: string) => t.toLowerCase().normalize('NFC');

function hasWord(text: string, phrase: string): boolean {
  const re = new RegExp(`(?:^|[^\\p{L}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'u');
  return re.test(text);
}

/**
 * The real or famous person (or fame word) a description points at, or null. Catches "looks like <Name>", words such
 * as celebrity and actor, and a list of well-known names (also written in lower case). `ignore` removes phrases first
 * (the business name, so "Patel Bakery" is not a hit).
 */
export function namesRealPerson(text: string, ignore: string[] = []): string | null {
  let t = text;
  for (const phrase of ignore) if (phrase.trim()) t = t.split(phrase).join(' ');
  const low = norm(t);
  for (const w of FAME_WORDS) if (hasWord(low, w)) return w;
  for (const name of FAMOUS_PEOPLE) if (hasWord(low, name)) return name;
  // The mascot blocklist's multi-word names (celebrities, politicians). Its single words (ram, mary, stitch) are only
  // applied to a face's name, not to free descriptions: "a ram on a hill" must not fail.
  for (const term of BLOCKLIST) if (term.includes(' ') && hasWord(low, term)) return term;
  for (const lead of t.matchAll(LEAD_RE)) {
    const m = NAME_AFTER_RE.exec(t.slice((lead.index ?? 0) + lead[0].length));
    if (m) return m[0];
  }
  return null;
}

// Words that make a brand face sexual or about attractiveness, and cues of a young age. A brand face is the face of a
// business: refused before anything is saved or paid for (the image model's own safety check would decline it anyway).
const SEXUAL_WORDS = [
  'sexy', 'seductive', 'sensual', 'sultry', 'busty', 'curvy', 'voluptuous', 'lingerie', 'bikini', 'nude', 'naked',
  'cleavage', 'erotic', 'provocative', 'revealing', 'skimpy', 'topless', 'hottie', 'hot girl', 'hot woman', 'hot lady',
  'hot guy', 'hot boy', 'hot man', 'hot babe', 'babe', 'attractive girl', 'beautiful girl', 'pretty girl', 'cute girl',
];
const YOUNG_WORDS = ['child', 'children', 'kid', 'kids', 'teen', 'teens', 'teenage', 'teenager', 'schoolgirl', 'schoolboy', 'minor', 'underage', 'little girl', 'little boy'];

/** The word that makes a person description unsuitable for a brand face (sexual wording or a young age), or null. */
export function unsuitableDescription(text: string): string | null {
  const low = norm(text);
  for (const w of [...SEXUAL_WORDS, ...YOUNG_WORDS]) if (hasWord(low, w)) return w;
  // An explicit age under 21 ("18 year old", "19-year-old", "aged 17", "age 16").
  const m = /(?:^|[^\p{N}])(\d{1,2})\s*(?:-|\s)?\s*(?:years?|yrs?|y\/o|yo)\b|\bage(?:d)?\s*(\d{1,2})\b/u.exec(low);
  if (m) {
    const age = Number(m[1] ?? m[2]);
    if (age < 21) return m[0].trim();
  }
  return null;
}

// Well-known cartoon, film and game characters, studios and franchises. Image tools refuse to copy them (and copying
// would be the owner's legal problem), so a brand face must be an original character. Matched as whole words, lower case.
const KNOWN_CHARACTERS = [
  'dora', 'dora the explorer', 'disney', 'pixar', 'dreamworks', 'marvel', 'dc comics', 'warner bros', 'nintendo', 'sanrio', 'ghibli', 'totoro',
  'pokemon', 'pokémon', 'pikachu', 'doraemon', 'nobita', 'shinchan', 'shin-chan', 'shin chan', 'crayon shin-chan', 'chhota bheem', 'chota bheem', 'bheem',
  'motu patlu', 'oggy', 'kicko', 'mickey', 'mickey mouse', 'minnie', 'minnie mouse', 'donald duck', 'goofy', 'spider-man', 'spiderman', 'spider man',
  'batman', 'superman', 'wonder woman', 'iron man', 'ironman', 'hulk', 'captain america', 'avengers', 'barbie', 'hello kitty', 'naruto', 'goku', 'dragon ball',
  'peppa', 'peppa pig', 'tom and jerry', 'mr bean', 'mr. bean', 'minion', 'minions', 'shrek', 'queen elsa', 'elsa from frozen', 'harry potter', 'hogwarts',
  'spongebob', 'sponge bob', 'sonic the hedgehog', 'mario', 'luigi', 'zelda', 'bugs bunny', 'daffy duck', 'looney tunes', 'tweety', 'simpsons', 'the simpsons',
  'homer simpson', 'paw patrol', 'bluey', 'cocomelon', 'masha', 'masha and the bear', 'winnie the pooh', 'pooh', 'mowgli', 'jungle book', 'lion king', 'simba',
  'toy story', 'buzz lightyear', 'scooby doo', 'scooby-doo', 'snoopy', 'garfield', 'pink panther', 'ben 10', 'teletubbies', 'my little pony', 'care bears',
  'smurfs', 'ninja turtles', 'powerpuff girls', 'kung fu panda', 'angry birds', 'minecraft', 'fortnite', 'roblox', 'pac-man', 'tintin', 'asterix', 'moana', 'mulan',
  'aladdin', 'cinderella', 'snow white',
];

// "in the style of X", "inspired by X", "based on X": the words that point at something to copy, then the name after it.
const COPY_LEAD_RE =
  /\b(?:(?:in\s+the\s+|the\s+)?(?:animation|animated|art|drawing|cartoon|anime)\s+style\s+of|in\s+the\s+style\s+of|style\s+of|inspired\s+(?:by|from)|copy\s+of|copied\s+from|(?:based|modell?ed)\s+(?:on|after)|looks?\s+like|same\s+as)\s+(?:(?:the|a|an|famous|popular)\s+)*(?:(?:animation|animated|art|drawing|cartoon|anime)\s+style\s+of\s+)?(?:(?:the|a|an)\s+)*/giu;
const COPY_NAME_AFTER_RE = /^\p{Lu}[\p{L}\p{N}'’.-]*(?:\s+(?:the\s+|of\s+|and\s+)?\p{Lu}[\p{L}\p{N}'’.-]*)*/u;
// A capitalised word after those leads that is a place, people or art tradition, not a character.
const NOT_A_CHARACTER = new Set([
  'indian', 'japanese', 'chinese', 'korean', 'asian', 'african', 'european', 'american', 'british', 'french', 'italian', 'spanish', 'mexican', 'nordic', 'western',
  'eastern', 'modern', 'classic', 'vintage', 'retro', 'traditional', 'madhubani', 'warli', 'mughal', 'rajasthani', 'kerala', 'bengal', 'bauhaus', 'art', 'nature', 'india', 'asia', 'africa', 'europe',
]);
// "from the cartoon / movie / game": something that exists already.
const FROM_WORK_RE = /\bfrom\s+(?:the\s+|a\s+|an\s+)?(?:cartoons?|movies?|films?|tv\s+shows?|tv\s+series|anime|comics?|video\s+games?)\b/iu;

/**
 * The known cartoon, film or game character, studio or franchise a description copies, or null. Catches a list of famous
 * names, "from the movie ...", and "in the style of / inspired by <Capitalised Name>". Plain text ("an explorer with a
 * bag", "inspired by Indian art") passes.
 */
export function copiesKnownCharacter(text: string): string | null {
  const low = norm(text);
  for (const name of KNOWN_CHARACTERS) if (hasWord(low, name)) return name;
  const from = FROM_WORK_RE.exec(text);
  if (from) return from[0].trim();
  for (const lead of text.matchAll(COPY_LEAD_RE)) {
    const m = COPY_NAME_AFTER_RE.exec(text.slice((lead.index ?? 0) + lead[0].length));
    if (m && !NOT_A_CHARACTER.has(m[0].split(/\s+/)[0].toLowerCase())) return m[0];
  }
  return null;
}

export interface FaceInputRaw {
  kind: unknown;
  name?: unknown;
  description?: unknown;
  style?: unknown;
  /** A mascot's kit character; undefined = Tween. */
  character?: unknown;
  placement?: unknown;
  neverSay?: unknown;
  postTypes?: unknown;
}

export interface CleanFaceInput {
  kind: FaceKind;
  name: string;
  description: string | null;
  style: FaceStyle | null;
  /** 'tween' or another offered character for a mascot; null for every other kind. */
  character: CharacterId | null;
  placement: FacePlacement;
  neverSay: string[];
  postTypes: PostType[] | null;
}

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function cleanPlacement(raw: unknown): FacePlacement {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new FaceError('bad_settings', 'placement');
  const p = raw as Record<string, unknown>;
  const out: FacePlacement = {};
  if (p.side !== undefined) {
    if (p.side !== 'left' && p.side !== 'right' && p.side !== 'auto') throw new FaceError('bad_settings', 'side');
    out.side = p.side;
  }
  if (p.size !== undefined) {
    if (p.size !== 'small' && p.size !== 'medium' && p.size !== 'large') throw new FaceError('bad_settings', 'size');
    out.size = p.size;
  }
  return out;
}

export function cleanNeverSay(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > NEVER_SAY_MAX) throw new FaceError('bad_settings', 'never_say');
  const out: string[] = [];
  for (const item of raw) {
    const phrase = clean(item);
    if (!phrase) continue;
    if ([...phrase].length > NEVER_SAY_CHARS) throw new FaceError('bad_settings', 'never_say');
    if (!out.some((o) => o.toLowerCase() === phrase.toLowerCase())) out.push(phrase);
  }
  return out;
}

export function cleanPostTypes(raw: unknown): PostType[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new FaceError('bad_settings', 'post_types');
  const out: PostType[] = [];
  for (const t of raw) {
    if (typeof t !== 'string' || !(POST_TYPES as readonly string[]).includes(t)) throw new FaceError('bad_settings', 'post_types');
    if (!out.includes(t as PostType)) out.push(t as PostType);
  }
  return out.length === 0 ? null : out;
}

/** A character id from the offered list (a working name or Laltain is refused). Undefined or null means Tween. Throws FaceError('bad_character'). */
export function cleanCharacter(raw: unknown): CharacterId {
  if (raw === undefined || raw === null || raw === '') return 'tween';
  if (typeof raw !== 'string' || !(CHARACTER_IDS as readonly string[]).includes(raw)) throw new FaceError('bad_character');
  return raw as CharacterId;
}

/** The face's name: short, plain letters, not a religious, political, celebrity or known-mascot name (same rule as a mascot's). */
export function cleanFaceName(raw: unknown, businessName: string): string {
  const name = clean(raw);
  if (!name || [...name].length > FACE_NAME_MAX || !NAME_RE.test(name)) throw new FaceError('bad_name');
  if (findBlockedTerm(name, [businessName]) || namesRealPerson(name, [businessName])) throw new FaceError('blocked_name');
  return name;
}

/**
 * Checks everything the owner typed for a new face. Throws FaceError. A realistic AI person is refused for health,
 * finance, legal and alcohol brands; a description that asks for a real or famous person is refused.
 */
export function validateFaceInput(input: FaceInputRaw, ctx: { regulated: string; businessName: string }): CleanFaceInput {
  if (typeof input.kind !== 'string' || !(FACE_KINDS as readonly string[]).includes(input.kind)) throw new FaceError('bad_kind');
  const kind = input.kind as FaceKind;
  if (!faceKindAllowed(kind, ctx.regulated)) throw new FaceError('kind_not_allowed');

  const character = kind === 'mascot' ? cleanCharacter(input.character) : null;
  const name = cleanFaceName(input.name, ctx.businessName);

  const description = clean(input.description);
  if ([...description].length > FACE_DESCRIPTION_MAX) throw new FaceError('bad_description');
  if (description) {
    const hit = namesRealPerson(description, [ctx.businessName]);
    if (hit) throw new FaceError('real_person', hit);
    const copied = copiesKnownCharacter(description);
    if (copied) throw new FaceError('copied_character', copied);
    if (kind === 'illustrated' || kind === 'photoreal') {
      const bad = unsuitableDescription(description);
      if (bad) throw new FaceError('unsuitable_description', bad);
    }
  }
  if ((kind === 'illustrated' || kind === 'photoreal') && !description) throw new FaceError('bad_description', 'a description is needed');

  let style: FaceStyle | null = null;
  if (input.style !== undefined && input.style !== null && input.style !== '') {
    if (typeof input.style !== 'string' || !(FACE_STYLES as readonly string[]).includes(input.style)) throw new FaceError('bad_style');
    style = input.style as FaceStyle;
  }
  if (kind === 'photoreal' && style && style !== 'photo') throw new FaceError('bad_style');

  return {
    kind,
    name,
    description: kind === 'mascot' ? null : description || null,
    style: kind === 'mascot' ? null : style,
    character,
    placement: cleanPlacement(input.placement),
    neverSay: cleanNeverSay(input.neverSay),
    postTypes: cleanPostTypes(input.postTypes),
  };
}

/**
 * Whether the face is drawn on a post of this type. A face limited to some post types stays off the others, and a
 * realistic AI person is never in a testimonial (it must not look like a customer or a reviewer).
 */
export function faceShownFor(face: { kind: FaceKind; postTypes?: PostType[] | null }, postType: PostType): boolean {
  if (face.postTypes && face.postTypes.length > 0 && !face.postTypes.includes(postType)) return false;
  if (face.kind === 'photoreal' && postType === 'testimonial') return false;
  return true;
}

/** The first "never say" phrase found in `text` (case-insensitive), or null. */
export function neverSayHit(text: string, neverSay: readonly string[]): string | null {
  const t = norm(text);
  for (const phrase of neverSay) {
    const p = norm(phrase.trim());
    if (p && t.includes(p)) return phrase;
  }
  return null;
}
