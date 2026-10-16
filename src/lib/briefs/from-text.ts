/**
 * Brief from the owner's words, typed or spoken (PRD v3 B-7, change C-08).
 *
 * `briefFromText` loads the brand (name, what it sells, country, language, time zone), its active
 * USPs and the contact blocks it has, REMOVES PAYMENT IDS from the owner's text (and from USP text),
 * asks Gemini (v3 prompt) and then checks the answer again in code, because the model may be wrong:
 *  - USP ids must be in the list we gave it (unknown ones are dropped);
 *  - dates must be real YYYY-MM-DD dates that pass the brief date rules (else dropped);
 *  - a new selling point is validated with the USP rules, must quote the owner's own words and use
 *    only numbers the owner wrote, and is returned as a SUGGESTION. It is never saved here;
 *  - the language must be one we offer; blocks must be ones the brand has.
 * Whatever is not returned is left empty for the owner. Nothing here saves a brief.
 *
 * The voice path is "transcribe, then this function": the transcript is owner text and is
 * redacted exactly like typed text.
 */
import { generateJson, AiError } from '@/lib/ai/client';
import { BRIEF_FROM_TEXT_SYSTEM, buildBriefFromTextUser, type BriefPromptUsp } from '@/lib/ai/prompts/v3';
import { briefFromTextJsonSchema, briefFromTextSchema, type BriefFromText } from '@/lib/ai/schemas-v3';
import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { fill, s } from '@/lib/i18n/strings';
import { redactForBrand } from '@/lib/payments';
import { POST_LANGUAGE_CODES } from '@/lib/setup/languages';
import { DailyCapError, assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage } from '@/lib/usage';
import { WeeklyCapError, assertUnderWeeklyCap } from '@/lib/usage/caps';
import { currencyForCountry } from '@/lib/usps/currency';
import { detailsFromForm, type FormValues } from '@/lib/usps/form';
import { parseUsp } from '@/lib/usps/schema';
import { listUsps } from '@/lib/usps/service';
import type { UspKind } from '@/lib/usps/types';
import { checkDateRange, isIsoDate, todayIn } from './dates';
import type { BlockKey, Blocks, CtaKind, PostType } from './types';
import { BLOCK_KEYS } from './types';

/** Longest description we accept (typed or spoken). */
export const BRIEF_TEXT_MAX = 2000;
/** Dates further away than this are treated as a mistake by the model, not a plan. */
export const MAX_DAYS_AHEAD = 730;

/** Contact blocks the brand can show: a block for each kind of default contact (same list the brief service uses). */
const CONTACT_BLOCKS = ['phone', 'whatsapp', 'website', 'email', 'address', 'hours', 'instagram', 'youtube', 'facebook'] as const satisfies readonly BlockKey[];

export type FilledField = 'postType' | 'primaryUsp' | 'secondaryUsps' | 'cta' | 'blocks' | 'dates' | 'language' | 'newUsp';

/** Why something the model said was not used (for logs and tests; not shown to the owner). */
export type DroppedReason =
  | 'unknown_usp'
  | 'secondary_without_primary'
  | 'invalid_date'
  | 'dates_order'
  | 'end_in_past'
  | 'date_too_far'
  | 'unknown_language'
  | 'unknown_block'
  | 'new_usp_invalid'
  | 'new_usp_ungrounded';

export interface NewUspSuggestion {
  kind: UspKind;
  title: string;
  details: Record<string, unknown>;
  /** The owner's own words this came from. */
  quote: string;
}

export interface BriefFromTextResult {
  /** Only the fields we could ground. A missing key is "left empty for the owner". */
  brief: {
    postType: PostType;
    primaryUspId?: string;
    secondaryUspIds?: string[];
    cta?: CtaKind;
    /** Set only when the owner named lines to show; absent means "use the brand's defaults". */
    blocks?: Blocks;
    startsOn?: string;
    endsOn?: string;
    language?: string;
  };
  /** A selling point the owner stated that is not in their list. Must be accepted by the owner before it is saved. */
  newUsp: NewUspSuggestion | null;
  /** Up to 3 one-line questions about things still to decide. */
  questions: string[];
  /** The fields filled from the description, for highlighting. */
  filled: FilledField[];
  dropped: DroppedReason[];
}

export type BriefTextErrorCode = 'empty' | 'too_long' | 'ai_failed';

export class BriefTextError extends Error {
  constructor(public readonly code: BriefTextErrorCode) {
    super(`Brief from text: ${code}`);
    this.name = 'BriefTextError';
  }
}

/** Test hooks. `fixture` is what the model "answers" in fixture mode; a function receives the prompt that would be sent. */
export interface BriefFromTextDeps {
  fixture?: BriefFromText | ((prompt: { system: string; user: string }) => BriefFromText);
}

interface BrandCtx {
  name: string;
  sells: string;
  country: string | null;
  language: string;
  timezone: string;
}

async function loadBrand(userId: string, brandId: string): Promise<BrandCtx> {
  const [r] = await getDb().withUser(userId, (tx) =>
    tx.query<{ name: string; sells: string | null; country: string | null; post_language: string | null; timezone: string | null }>(
      `select coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.category as sells, m.country, m.post_language, m.timezone
         from public.brands b left join public.brand_memory m on m.brand_id = b.id
        where b.id = $1`,
      [brandId],
    ),
  );
  if (!r) throw new BrandAccessError();
  return { name: r.name, sells: r.sells ?? '', country: r.country, language: r.post_language ?? 'en', timezone: r.timezone ?? 'UTC' };
}

/** Kinds of default contacts the brand has, as block keys, in the usual order. */
async function loadAvailableBlocks(userId: string, brandId: string): Promise<BlockKey[]> {
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ kind: string }>('select distinct kind::text as kind from public.contact_points where brand_id = $1 and is_default', [brandId]),
  );
  const kinds = new Set(rows.map((r) => r.kind));
  return CONTACT_BLOCKS.filter((k) => kinds.has(k));
}

const SEP = '\u0000';

/** Removes payment IDs from several strings with one lookup of the brand's saved IDs. */
async function redactMany(brandId: string, texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  return (await redactForBrand(brandId, texts.join(SEP))).split(SEP);
}

function summariseDetails(details: Record<string, unknown>): string {
  const bits: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    bits.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return bits.join('; ').slice(0, 200);
}

function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function countryName(code: string | null): string {
  if (!code) return 'an unknown country';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** The model's language, matched to one we offer ("en-gb" to "en-GB", "hi-IN" to "hi"); null when it is not one of ours. */
function knownLanguage(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  const exact = POST_LANGUAGE_CODES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split('-')[0];
  return POST_LANGUAGE_CODES.find((c) => c.toLowerCase() === base) ?? null;
}

const norm = (t: string) => t.toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/\s+/g, ' ').trim();

/** Numbers written in the text, with thousands separators removed ("1,200" is 1200). */
function numbersIn(text: string): Set<number> {
  const flat = text.replace(/(\d)[,  ](?=\d{3}\b)/g, '$1');
  const out = new Set<number>();
  for (const m of flat.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(Number(m[0].replace(',', '.')));
  return out;
}

function collectNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) collectNumbers(x, out);
  return out;
}

const NUMBER_KEYS = new Set(['percent', 'amountOff', 'price', 'rating', 'count', 'years']);

/** Turns the model's flat fields into a validated, grounded suggestion, or says why not. */
function checkNewUsp(
  raw: BriefFromText['new_usp'][number],
  ownerText: string,
  country: string | null,
): { ok: true; usp: NewUspSuggestion } | { ok: false; reason: DroppedReason } {
  const quote = raw.quote.trim();
  if (!quote || !norm(ownerText).includes(norm(quote))) return { ok: false, reason: 'new_usp_ungrounded' };

  const values: FormValues = {};
  for (const [k, v] of Object.entries(raw.fields)) {
    if (typeof v === 'boolean') values[k] = v ? 'true' : '';
    else if (NUMBER_KEYS.has(k)) values[k] = String(v).replace(/[%,\s]/g, '');
    else values[k] = String(v);
  }
  if (!values.currency) values.currency = currencyForCountry(country);
  // Models sometimes name a discount's subject `what` (the free_extra field) instead of `on`.
  if (raw.kind === 'discount' && !values.on && values.what) values.on = values.what;
  const details = detailsFromForm(raw.kind, values);
  const title = raw.title.trim().slice(0, 60);
  const parsed = parseUsp({ kind: raw.kind, title, details });
  if (!parsed.ok) return { ok: false, reason: 'new_usp_invalid' };

  // Every number must be a number the owner wrote: a figure the model made up is never offered.
  const written = numbersIn(ownerText);
  for (const n of collectNumbers(parsed.data.details)) {
    if (!written.has(n)) return { ok: false, reason: 'new_usp_ungrounded' };
  }
  return { ok: true, usp: { kind: parsed.data.kind, title: parsed.data.title, details: parsed.data.details, quote } };
}

/** What the model "answers" in fixture mode when a test gives none: a small, honest reading of the text. */
function defaultFixture(args: { text: string; usps: Array<{ id: string; title: string }> }): BriefFromText {
  const t = args.text.toLowerCase();
  const post_type: PostType = /%|\boff\b|discount|sale|deal/.test(t) ? 'offer' : /hiring|vacanc|job/.test(t) ? 'hiring' : /event|workshop|party/.test(t) ? 'event' : /new\b|launch/.test(t) ? 'new_product' : 'brand';
  const matches = args.usps.filter((u) => u.title.toLowerCase().split(/\s+/).some((w) => w.length > 3 && t.includes(w)));
  const cta: BriefFromText['cta'] = /whatsapp/.test(t) ? 'whatsapp' : /\bcall\b/.test(t) ? 'call' : /\bbook\b/.test(t) ? 'book' : /\border\b/.test(t) ? 'order' : /\bvisit\b/.test(t) ? 'visit' : '';
  const needsDate = post_type === 'offer' || post_type === 'event';
  return {
    post_type,
    primary_usp_id: matches[0]?.id ?? '',
    secondary_usp_ids: matches.slice(1, 3).map((u) => u.id),
    new_usp: [],
    cta,
    blocks: [],
    starts_on: '',
    ends_on: '',
    language: '',
    questions: needsDate ? ['Until when does it run?'] : [],
  };
}

/**
 * Turns the owner's description into a partial brief. See the file comment for the checks.
 * Throws BriefTextError ('empty' / 'too_long' / 'ai_failed'), BrandAccessError, DailyCapError or
 * WeeklyCapError. One `brief_from_text` usage event is recorded per call that reached the model.
 */
export async function briefFromText(
  args: { userId: string; brandId: string; text: string; now?: Date },
  deps: BriefFromTextDeps = {},
): Promise<BriefFromTextResult> {
  const { userId, brandId } = args;
  const now = args.now ?? new Date();
  await requireBrandMember(userId, brandId);

  const text = (typeof args.text === 'string' ? args.text : '').replace(/\s+/g, ' ').trim();
  if (!text) throw new BriefTextError('empty');
  if (text.length > BRIEF_TEXT_MAX) throw new BriefTextError('too_long');

  const [brand, usps, available] = await Promise.all([loadBrand(userId, brandId), listUsps(userId, brandId), loadAvailableBlocks(userId, brandId)]);

  // Payment IDs never reach a model: the owner's words (typed or transcribed) and the USP text are cleaned first.
  const ownerWords = await redactForBrand(brandId, text);
  const uspText = await redactMany(brandId, usps.flatMap((u) => [u.title, summariseDetails(u.details as Record<string, unknown>)]));
  const promptUsps: BriefPromptUsp[] = usps.map((u, i) => ({ id: u.id, kind: u.kind, title: uspText[i * 2], details: uspText[i * 2 + 1] }));

  const today = todayIn(now, brand.timezone);
  const prompt = {
    system: BRIEF_FROM_TEXT_SYSTEM,
    user: buildBriefFromTextUser({
      today,
      weekday: weekdayOf(today),
      brandName: brand.name,
      sells: brand.sells || 'various products and services',
      country: countryName(brand.country),
      defaultLanguage: brand.language,
      usps: promptUsps,
      availableBlocks: available,
      ownerWords,
    }),
  };

  await assertUnderDailyCap(brandId, now);
  await assertUnderWeeklyCap(brandId, 'brief_from_text', { now });

  let data: BriefFromText;
  try {
    const fixture = deps.fixture ?? (() => defaultFixture({ text, usps: usps.map((u) => ({ id: u.id, title: u.title })) }));
    const res = await generateJson({
      system: prompt.system,
      user: prompt.user,
      zodSchema: briefFromTextSchema,
      jsonSchema: briefFromTextJsonSchema,
      temperature: 0.2,
      logContext: { brandId },
      fixture: () => (typeof fixture === 'function' ? fixture(prompt) : fixture),
    });
    data = res.data;
    await recordUsage(brandId, userId, 'brief_from_text', res.stats?.usd ?? 0, { model: res.stats?.model });
  } catch (err) {
    // A call that answered but did not validate still cost money (H-2).
    const lost = failedCallUsd(err);
    if (lost > 0) await recordUsage(brandId, userId, 'brief_from_text', lost, { ok: false, model: failedCallModel(err) }).catch(() => undefined);
    console.warn(`[briefs] describe failed for brand ${brandId}: ${err instanceof AiError ? err.code : err instanceof Error ? err.name : 'error'}`);
    throw new BriefTextError('ai_failed');
  }

  return validate(data, { text, usps: usps.map((u) => u.id), available, today, timezone: brand.timezone, country: brand.country, now });
}

/** The code-side checks on the model's answer. Pure; exported for tests. */
export function validate(
  data: BriefFromText,
  ctx: { text: string; usps: string[]; available: BlockKey[]; today: string; timezone: string; country: string | null; now: Date },
): BriefFromTextResult {
  const dropped: DroppedReason[] = [];
  const filled: FilledField[] = ['postType'];
  const brief: BriefFromTextResult['brief'] = { postType: data.post_type };
  const known = new Set(ctx.usps);

  // USPs: only ids we gave the model; a point can't be both main and extra; at most 2 extra.
  let primary = data.primary_usp_id.trim();
  if (primary && !known.has(primary)) {
    dropped.push('unknown_usp');
    primary = '';
  }
  const secondary: string[] = [];
  for (const id of data.secondary_usp_ids.map((x) => x.trim()).filter(Boolean)) {
    if (!known.has(id)) dropped.push('unknown_usp');
    else if (id !== primary && !secondary.includes(id)) secondary.push(id);
  }
  if (!primary && secondary.length > 0) {
    dropped.push('secondary_without_primary');
    secondary.length = 0;
  }
  if (primary) {
    brief.primaryUspId = primary;
    filled.push('primaryUsp');
  }
  if (secondary.length > 0) {
    brief.secondaryUspIds = secondary.slice(0, 2);
    filled.push('secondaryUsps');
  }

  if (data.cta) {
    brief.cta = data.cta;
    filled.push('cta');
  }

  // Dates: real calendar dates, in order, end not in the past, and not absurdly far away.
  let startsOn: string | null = data.starts_on.trim() || null;
  let endsOn: string | null = data.ends_on.trim() || null;
  const farthest = dayNumber(ctx.today) + MAX_DAYS_AHEAD;
  for (const which of ['start', 'end'] as const) {
    const v = which === 'start' ? startsOn : endsOn;
    if (v === null) continue;
    let reason: DroppedReason | null = null;
    if (!isIsoDate(v)) reason = 'invalid_date';
    else if (dayNumber(v) > farthest) reason = 'date_too_far';
    if (reason) {
      dropped.push(reason);
      if (which === 'start') startsOn = null;
      else endsOn = null;
    }
  }
  const range = checkDateRange({ startsOn, endsOn }, { timezone: ctx.timezone, now: ctx.now, requireEndNotPast: true });
  if (range === 'end_in_past') {
    dropped.push('end_in_past');
    endsOn = null;
  } else if (range === 'dates_order') {
    dropped.push('dates_order');
    startsOn = null;
    endsOn = null;
  }
  if (startsOn) brief.startsOn = startsOn;
  if (endsOn) brief.endsOn = endsOn;
  if (startsOn || endsOn) filled.push('dates');

  // Language: only one we offer.
  const lang = knownLanguage(data.language);
  if (data.language.trim() && !lang) dropped.push('unknown_language');
  if (lang) {
    brief.language = lang;
    filled.push('language');
  }

  // Blocks: the lines the owner asked for, among those the brand has. Empty means "the brand's defaults".
  const wanted = [...new Set(data.blocks)].filter((b): b is BlockKey => (BLOCK_KEYS as readonly string[]).includes(b));
  const usable = wanted.filter((b) => ctx.available.includes(b));
  if (usable.length < wanted.length) dropped.push('unknown_block');
  if (usable.length > 0) {
    const blocks: Blocks = {};
    for (const k of ctx.available) blocks[k] = usable.includes(k);
    if (startsOn || endsOn) blocks.dates = true;
    brief.blocks = blocks;
    filled.push('blocks');
  }

  // A new selling point: validated and grounded, then only suggested.
  let newUsp: NewUspSuggestion | null = null;
  if (data.new_usp.length > 0) {
    const checked = checkNewUsp(data.new_usp[0], ctx.text, ctx.country);
    if (checked.ok) {
      newUsp = checked.usp;
      filled.push('newUsp');
    } else dropped.push(checked.reason);
  }

  const questions = data.questions.map((q) => q.trim()).filter(Boolean).slice(0, 3);
  return { brief, newUsp, questions, filled, dropped };
}

/** Owner-facing words for a failure of `briefFromText`, or null when it is not one of ours. */
export function describeBriefTextError(e: unknown): { code: 'cap' | 'not_found' | BriefTextErrorCode; message: string } | null {
  if (e instanceof BriefTextError) return { code: e.code, message: s.create.describe.errors[e.code] };
  if (e instanceof DailyCapError) return { code: 'cap', message: fill(s.errors.dailyCap, { cap: e.cap }) };
  if (e instanceof WeeklyCapError) return { code: 'cap', message: e.message };
  if (e instanceof BrandAccessError) return { code: 'not_found', message: s.brandV2.notFound };
  return null;
}
