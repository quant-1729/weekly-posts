// Brand voice from past posts (Req 4, 5): a short description plus example phrases. The model
// proposes phrases; code keeps only those that really appear in a past post (verbatim check).
// Words to avoid are never added automatically: the model's suggestions are stored in
// brand_memory.avoid_suggestions and shown to the owner, who adds or dismisses each one.
// Once the owner has edited the description or phrases (voice_edited_at), a refresh keeps
// their description and only adds new verified phrases.

import { generateJson } from "@/lib/ai/client";
import { buildVoicePrompt } from "@/lib/ai/prompts/v2-memory";
import { voiceJsonSchema, voiceSchema, type Voice } from "@/lib/ai/schemas-v2";
import { BrandAccessError, requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage } from "@/lib/usage";
import { assertUnderWeeklyCap } from "@/lib/usage/caps";
import { voiceFixture } from "./fixtures";
import { MAX_AVOID_WORDS, MAX_EXAMPLE_PHRASES, VOICE_DEBOUNCE_MS } from "./limits";

export { MAX_EXAMPLE_PHRASES };

const MAX_DESCRIPTION_CHARS = 1000;
const MAX_PHRASE_CHARS = 200;
const MAX_AVOID_CHARS = 60;

/** Lower case, whitespace collapsed (including line breaks), curly quotes straightened. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The phrases that appear (case-insensitive, whitespace-normalised) in at least one past post. No duplicates. */
export function keepVerbatimPhrases(phrases: string[], pastPosts: string[]): string[] {
  const haystacks = pastPosts.map(normalizeForMatch);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of phrases) {
    const key = normalizeForMatch(p);
    if (!key || seen.has(key)) continue;
    if (!haystacks.some((h) => h.includes(key))) continue;
    seen.add(key);
    kept.push(p.replace(/\s+/g, " ").trim());
  }
  return kept.slice(0, MAX_EXAMPLE_PHRASES);
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export type RefreshOutcome =
  | { status: "updated"; voiceDescription: string; examplePhrases: string[]; avoidSuggestions: string[] }
  | { status: "skipped" } // no past posts
  | { status: "superseded" } // a newer refresh for this brand took over (debounce)
  | { status: "failed" }; // the model or the daily cap stopped it; nothing was changed

// Kept on globalThis: route handlers and pages can be separate module copies in one server process
// (Next dev), and they must see the same debounce state.
interface VoiceState {
  sequence: number;
  latestToken: Map<string, number>;
  inFlight: Map<string, number>;
}
const g = globalThis as unknown as { __postmitraVoice?: VoiceState };
const state: VoiceState = (g.__postmitraVoice ??= {
  sequence: 0,
  latestToken: new Map(),
  inFlight: new Map(),
});
const { latestToken, inFlight } = state;

/**
 * The owner's phrases first (never removed), then new verified ones that are not there yet,
 * up to MAX_EXAMPLE_PHRASES in all.
 */
export function mergePhrases(owners: string[], fresh: string[]): string[] {
  const out = [...owners];
  const seen = new Set(owners.map(normalizeForMatch));
  for (const p of fresh) {
    if (out.length >= MAX_EXAMPLE_PHRASES) break;
    const key = normalizeForMatch(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** True while a refresh for this brand is waiting out the debounce or running (this server process only). */
export function isVoiceRefreshing(brandId: string): boolean {
  return (inFlight.get(brandId) ?? 0) > 0;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readInputs(userId: string, brandId: string) {
  return getDb().withUser(userId, async (tx) => {
    const posts = await tx.query<{ extracted_text: string | null }>(
      "select extracted_text from public.photos where brand_id = $1 and kind = 'past_post' and extracted_text is not null order by created_at asc, id asc",
      [brandId],
    );
    const [memory] = await tx.query<{ business_name: string | null; tone: string | null }>(
      "select business_name, tone from public.brand_memory where brand_id = $1",
      [brandId],
    );
    return {
      pastPosts: posts.map((p) => p.extracted_text ?? "").filter((t) => t.trim().length > 0),
      businessName: memory?.business_name ?? "",
      tone: memory?.tone?.trim() || "friendly",
    };
  });
}

/**
 * Re-reads the brand's voice from its past posts. Does nothing without past posts. Debounced:
 * when another refresh for the same brand starts within `debounceMs` (default 10 s), only the
 * last one runs. Never throws for model problems: it returns { status: "failed" } and leaves the
 * saved voice as it was.
 */
export async function refreshVoice(args: {
  userId: string;
  brandId: string;
  debounceMs?: number;
  /** Test/dev override for the model's answer in fixture mode. Gets the past post texts. */
  fixture?: (pastPosts: string[]) => Voice;
}): Promise<RefreshOutcome> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const token = ++state.sequence;
  latestToken.set(brandId, token);
  inFlight.set(brandId, (inFlight.get(brandId) ?? 0) + 1);
  try {
    const wait = args.debounceMs ?? VOICE_DEBOUNCE_MS;
    if (wait > 0) await sleep(wait);
    if (latestToken.get(brandId) !== token) return { status: "superseded" };

    const input = await readInputs(userId, brandId);
    if (input.pastPosts.length === 0) return { status: "skipped" };

    let voice: Voice;
    try {
      await assertUnderDailyCap(brandId);
      await assertUnderWeeklyCap(brandId, "upload_extract");
      const prompt = buildVoicePrompt({
        businessName: input.businessName,
        pickedTone: input.tone,
        pastPosts: input.pastPosts,
        websiteCopy: "",
      });
      const fixture = args.fixture ?? voiceFixture;
      const res = await generateJson({
        system: prompt.system,
        user: prompt.user,
        zodSchema: voiceSchema,
        jsonSchema: voiceJsonSchema,
        temperature: 0.2,
        timeoutMs: 30_000,
        budgetMs: 45_000,
        logContext: { brandId },
        fixture: () => fixture(input.pastPosts),
      });
      await recordUsage(brandId, userId, "upload_extract", res.stats?.usd ?? 0, { model: res.stats?.model });
      voice = res.data;
    } catch (e) {
      const lost = failedCallUsd(e); // an answer that did not validate still cost money (H-2)
      if (lost > 0) await recordUsage(brandId, userId, "upload_extract", lost, { ok: false, model: failedCallModel(e) }).catch(() => undefined);
      console.warn("[uploads] voice refresh failed; keeping the saved voice", e instanceof Error ? e.message : e);
      return { status: "failed" };
    }
    if (latestToken.get(brandId) !== token) return { status: "superseded" };

    const examplePhrases = keepVerbatimPhrases(voice.example_phrases, input.pastPosts);
    const voiceDescription = voice.voice_description.trim().slice(0, MAX_DESCRIPTION_CHARS);
    const proposed = [
      ...new Set(voice.avoid_suggestions.map((w) => w.replace(/\s+/g, " ").trim().slice(0, MAX_AVOID_CHARS)).filter(Boolean)),
    ].slice(0, 6);

    // Read the owner's current fields and write in one step, so an edit made while the model
    // was thinking is not lost.
    const saved = await getDb().withUser(userId, async (tx) => {
      const [cur] = await tx.query<{
        voice_edited_at: string | null;
        voice_description: string | null;
        example_phrases: string[] | null;
        words_to_avoid: string[] | null;
      }>(
        "select voice_edited_at, voice_description, example_phrases, words_to_avoid from public.brand_memory where brand_id = $1 for update",
        [brandId],
      );
      if (!cur) throw new BrandAccessError();
      const ownerEdited = cur.voice_edited_at !== null;
      const description = ownerEdited ? cur.voice_description : voiceDescription || null;
      const phrases = ownerEdited ? mergePhrases(cur.example_phrases ?? [], examplePhrases) : examplePhrases;
      const have = new Set((cur.words_to_avoid ?? []).map(normalizeForMatch));
      const avoid = proposed.filter((w) => !have.has(normalizeForMatch(w)));
      await tx.query(
        "update public.brand_memory set voice_description = $2, example_phrases = $3::text[], avoid_suggestions = $4::text[] where brand_id = $1",
        [brandId, description, phrases, avoid],
      );
      return { voiceDescription: description ?? "", examplePhrases: phrases, avoidSuggestions: avoid };
    });
    return { status: "updated", ...saved };
  } finally {
    const left = (inFlight.get(brandId) ?? 1) - 1;
    if (left <= 0) inFlight.delete(brandId);
    else inFlight.set(brandId, left);
  }
}

// ---------------------------------------------------------------------------
// Reading and editing the voice fields (the owner can view and change every one)
// ---------------------------------------------------------------------------

export interface VoiceView {
  voiceDescription: string | null;
  examplePhrases: string[];
  wordsToAvoid: string[];
  /** The model's latest "words to avoid" ideas (brand_memory.avoid_suggestions), minus those already on the list. */
  avoidSuggestions: string[];
  refreshing: boolean;
}

export async function getVoice(userId: string, brandId: string): Promise<VoiceView> {
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{
      voice_description: string | null;
      example_phrases: string[] | null;
      words_to_avoid: string[] | null;
      avoid_suggestions: string[] | null;
    }>(
      "select voice_description, example_phrases, words_to_avoid, avoid_suggestions from public.brand_memory where brand_id = $1",
      [brandId],
    ),
  );
  const avoid = row?.words_to_avoid ?? [];
  const have = new Set(avoid.map(normalizeForMatch));
  return {
    voiceDescription: row?.voice_description ?? null,
    examplePhrases: row?.example_phrases ?? [],
    wordsToAvoid: avoid,
    avoidSuggestions: (row?.avoid_suggestions ?? []).filter((w) => !have.has(normalizeForMatch(w))),
    refreshing: isVoiceRefreshing(brandId),
  };
}

/** Adds one word or style to words_to_avoid (the owner's tap on a suggestion). No duplicates. */
export async function addWordToAvoid(args: { userId: string; brandId: string; word: string }): Promise<string[]> {
  const word = args.word.replace(/\s+/g, " ").trim().slice(0, MAX_AVOID_CHARS);
  await requireBrandMember(args.userId, args.brandId);
  if (!word) return (await getVoice(args.userId, args.brandId)).wordsToAvoid;
  const list = await getDb().withUser(args.userId, async (tx) => {
    const [row] = await tx.query<{ words_to_avoid: string[] | null; avoid_suggestions: string[] | null }>(
      "select words_to_avoid, avoid_suggestions from public.brand_memory where brand_id = $1 for update",
      [args.brandId],
    );
    const current = row?.words_to_avoid ?? [];
    const remaining = (row?.avoid_suggestions ?? []).filter((w) => normalizeForMatch(w) !== normalizeForMatch(word));
    if (current.some((w) => normalizeForMatch(w) === normalizeForMatch(word)) || current.length >= MAX_AVOID_WORDS) {
      await tx.query("update public.brand_memory set avoid_suggestions = $2::text[] where brand_id = $1", [args.brandId, remaining]);
      return current;
    }
    const next = [...current, word];
    await tx.query(
      "update public.brand_memory set words_to_avoid = $2::text[], avoid_suggestions = $3::text[] where brand_id = $1",
      [args.brandId, next, remaining],
    );
    return next;
  });
  return list;
}

/** The owner's tap on "Dismiss": the suggestion is removed and never added to the list. */
export async function dismissAvoidSuggestion(args: { userId: string; brandId: string; word: string }): Promise<string[]> {
  await requireBrandMember(args.userId, args.brandId);
  const key = normalizeForMatch(args.word);
  return getDb().withUser(args.userId, async (tx) => {
    const [row] = await tx.query<{ avoid_suggestions: string[] | null }>(
      "select avoid_suggestions from public.brand_memory where brand_id = $1 for update",
      [args.brandId],
    );
    const next = (row?.avoid_suggestions ?? []).filter((w) => normalizeForMatch(w) !== key);
    await tx.query("update public.brand_memory set avoid_suggestions = $2::text[] where brand_id = $1", [args.brandId, next]);
    return next;
  });
}

export interface VoiceEdit {
  voiceDescription?: string;
  examplePhrases?: string[];
  wordsToAvoid?: string[];
}

function cleanList(list: string[], maxItems: number, maxChars: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = String(raw).replace(/\s+/g, " ").trim().slice(0, maxChars);
    const key = normalizeForMatch(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, maxItems);
}

/**
 * The owner's own edits. Only the fields given are changed. Editing the description or the
 * phrases sets voice_edited_at, so a later refresh from past posts cannot overwrite them.
 */
export async function updateVoice(args: { userId: string; brandId: string; edit: VoiceEdit }): Promise<void> {
  const { userId, brandId, edit } = args;
  await requireBrandMember(userId, brandId);
  const sets: string[] = [];
  const params: unknown[] = [brandId];
  if (edit.voiceDescription !== undefined) {
    params.push(edit.voiceDescription.trim().slice(0, MAX_DESCRIPTION_CHARS) || null);
    sets.push(`voice_description = $${params.length}`);
  }
  if (edit.examplePhrases !== undefined) {
    params.push(cleanList(edit.examplePhrases, MAX_EXAMPLE_PHRASES, MAX_PHRASE_CHARS));
    sets.push(`example_phrases = $${params.length}::text[]`);
  }
  if (edit.wordsToAvoid !== undefined) {
    params.push(cleanList(edit.wordsToAvoid, MAX_AVOID_WORDS, MAX_AVOID_CHARS));
    sets.push(`words_to_avoid = $${params.length}::text[]`);
  }
  if (sets.length === 0) return;
  if (edit.voiceDescription !== undefined || edit.examplePhrases !== undefined) sets.push("voice_edited_at = now()");
  await getDb().withUser(userId, (tx) => tx.query(`update public.brand_memory set ${sets.join(", ")} where brand_id = $1`, params));
}
