import { randomInt, randomUUID } from "node:crypto";
import sharp from "sharp";
import { AiError, generateJson, generateText } from "@/lib/ai/client";
import { checkAllOutputs, type CheckIssue } from "@/lib/ai/checks";
import { buildGeneratePrompt, ownerSourcesText, type GenerateInput } from "@/lib/ai/prompts/generate";
import { TRANSCRIBE_INSTRUCTION, isTranscriptUsable } from "@/lib/ai/prompts/transcribe";
import { isRegulatedCategory } from "@/lib/ai/regulated";
import {
  CHANNELS,
  generateResultJsonSchema,
  generateResultSchema,
  type Channel,
  type ChannelOutput,
  type ContentLanguage,
  type GenerateResult,
} from "@/lib/ai/schemas";
import { MAX_WAV_BYTES, WAV_CHANNELS, WAV_SAMPLE_RATE, readWavInfo } from "@/lib/audio/wav";
import { PRESET_PALETTES, isHexColor, type Palette } from "@/lib/brand/colors";
import { BrandAccessError, requireBrandMember } from "@/lib/brand/current";
import { getBrandProfile } from "@/lib/brand/profile";
import { getDb } from "@/lib/db";
import { fill, s } from "@/lib/i18n/strings";
import { renderPostDetailed, type RenderResult } from "@/lib/render";
import { getStorage, type Storage } from "@/lib/storage";
import { DailyCapError, assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage, type UsageMeta } from "@/lib/usage";
import { POST_TRANSCRIPT_FIXTURE, generateFixture } from "./fixtures";

/**
 * One owner input -> a post with 4 outputs (R4).
 *
 *   validate -> daily cap -> post row (generating) -> store input
 *   -> [transcribe] -> generate -> checks (+ one regenerate) -> render -> outputs + post (draft)
 *
 * Everything the owner owns is read and written inside withUser, so row-level
 * security applies. Any failure after the post row exists sets it to `failed`.
 */

export const PHOTO_MAX_SIDE = 2048;
export const AI_PHOTO_MAX_SIDE = 1024;
export const MAX_TEXT_CHARS = 2000;

export type PostInput =
  | { type: "text"; text: string }
  | { type: "photo"; bytes: Uint8Array; caption?: string }
  | { type: "voice"; bytes: Uint8Array };

export type Stage = "understanding" | "writing" | "designing";

export interface Timings {
  transcribeMs: number;
  generateMs: number;
  renderMs: number;
  totalMs: number;
}

export type FailCode =
  | "cap"
  | "invalid_input"
  | "unusable_transcript"
  | "needs_input"
  | "no_brand"
  | "ai_failed"
  | "generic";

export type GenerateOutcome =
  | { ok: true; postId: string; postCode: string; timings: Timings; openFlags: number }
  | { ok: false; code: FailCode; message: string; postId: string | null; timings: Timings };

export interface GeneratePostOptions {
  userId: string;
  brandId: string;
  input: PostInput;
  storage?: Storage;
  now?: Date;
  onStage?: (stage: Stage) => void;
  /** Fixture mode only (live mode ignores these). Tests use them to steer the pipeline. */
  fixtures?: {
    /** The model result; a function receives 0 for the first call and 1 for the regenerate. */
    generate?: GenerateResult | ((attempt: number) => GenerateResult);
    transcript?: string;
  };
}

class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 7 random characters from [a-z0-9] (posts.post_code). */
export function newPostCode(): string {
  let code = "";
  for (let i = 0; i < 7; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

const DEFAULT_PALETTE: Palette = PRESET_PALETTES[0];

export function paletteWithDefaults(colors: Partial<Palette>): Palette {
  const pick = (v: string | undefined, fallback: string) => (v && isHexColor(v) ? v : fallback);
  return {
    primary: pick(colors.primary, DEFAULT_PALETTE.primary),
    secondary: pick(colors.secondary, DEFAULT_PALETTE.secondary),
    accent: pick(colors.accent, DEFAULT_PALETTE.accent),
  };
}

const PHOTO_FORMATS: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", heif: "heic", avif: "avif" };

interface PreparedPhoto {
  /** The upload as received. */
  original: Uint8Array;
  originalExt: string;
  /** Auto-rotated, longest side 2048, JPEG. Used in the templates. */
  normalised: Buffer;
  /** Longest side 1024, JPEG. Sent to the model. */
  forAi: Buffer;
}

/** Normalises an uploaded photo. Photo clean-up (crop, brightness) is T-11, not here. */
export async function preparePhoto(bytes: Uint8Array): Promise<PreparedPhoto> {
  const input = Buffer.from(bytes);
  let ext: string;
  try {
    const meta = await sharp(input, { failOn: "none", limitInputPixels: 80_000_000 }).metadata();
    ext = (meta.format && PHOTO_FORMATS[meta.format]) || "";
  } catch {
    throw new InputError(s.create.errors.invalidPhoto);
  }
  if (!ext) throw new InputError(s.create.errors.invalidPhoto);
  try {
    const normalised = await sharp(input, { failOn: "none", limitInputPixels: 80_000_000 })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const forAi = await sharp(normalised)
      .resize({ width: AI_PHOTO_MAX_SIDE, height: AI_PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { original: bytes, originalExt: ext, normalised, forAi };
  } catch {
    throw new InputError(s.create.errors.invalidPhoto);
  }
}

type Prepared =
  | { type: "text"; text: string }
  | { type: "photo"; caption: string; photo: PreparedPhoto }
  | { type: "voice"; bytes: Uint8Array };

async function validateInput(input: PostInput): Promise<Prepared> {
  if (input.type === "text") {
    const text = input.text.trim();
    if (!text) throw new InputError(s.create.errors.emptyText);
    if (text.length > MAX_TEXT_CHARS) throw new InputError(s.create.errors.textTooLong);
    return { type: "text", text };
  }
  if (input.type === "photo") {
    const caption = (input.caption ?? "").trim();
    if (caption.length > MAX_TEXT_CHARS) throw new InputError(s.create.errors.textTooLong);
    if (input.bytes.byteLength === 0) throw new InputError(s.create.errors.invalidPhoto);
    return { type: "photo", caption, photo: await preparePhoto(input.bytes) };
  }
  if (input.bytes.byteLength > MAX_WAV_BYTES) throw new InputError(s.errors.audioTooLarge);
  const info = readWavInfo(input.bytes);
  if (!info || info.sampleRate !== WAV_SAMPLE_RATE || info.channels !== WAV_CHANNELS || info.bits !== 16 || info.seconds < 0.5) {
    throw new InputError(s.errors.invalidAudio);
  }
  return { type: "voice", bytes: input.bytes };
}

const blocking = (issues: CheckIssue[]) => issues.filter((i) => i.code === "wrong_script" || i.code === "too_long");

export interface FactFlag {
  id: string;
  text: string;
  kind: "price" | "claim" | "phone";
  regulated: boolean;
  status: "open";
}

const FLAG_KIND: Partial<Record<CheckIssue["code"], FactFlag["kind"]>> = {
  unsupported_number: "price",
  unsupported_phrase: "claim",
  contact_detail: "phone",
};

/** Unsupported numbers and phrases and contact details become open fact flags for the output's channel. */
export function flagsFromIssues(issues: CheckIssue[], channel: Channel, regulated: boolean): FactFlag[] {
  const seen = new Set<string>();
  const flags: FactFlag[] = [];
  for (const issue of issues) {
    const kind = FLAG_KIND[issue.code];
    if (issue.channel !== channel || !kind) continue;
    const key = `${kind}:${issue.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({ id: randomUUID(), text: issue.detail, kind, regulated, status: "open" });
  }
  return flags;
}

function failureFor(e: unknown): { code: FailCode; message: string } {
  if (e instanceof InputError) return { code: "invalid_input", message: e.message };
  if (e instanceof DailyCapError) return { code: "cap", message: fill(s.errors.dailyCap, { cap: e.cap }) };
  if (e instanceof BrandAccessError) return { code: "no_brand", message: s.create.errors.noBrand };
  if (e instanceof AiError) return { code: "ai_failed", message: s.errors.aiFailed };
  console.error("[posts] generate failed", e);
  return { code: "generic", message: s.errors.generic };
}

async function insertPost(args: {
  userId: string;
  brandId: string;
  inputType: PostInput["type"];
  language: ContentLanguage;
}): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newPostCode();
    const rows = await getDb().withUser(args.userId, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.posts (brand_id, created_by, source, input_type, language, status, post_code)
         values ($1, $2, 'web', $3::public.input_type, $4::public.content_language, 'generating', $5)
         on conflict (post_code) do nothing
         returning id`,
        [args.brandId, args.userId, args.inputType, args.language, code],
      ),
    );
    if (rows[0]) return { id: rows[0].id, code };
  }
  throw new Error("Could not allocate a post code");
}

async function markFailed(userId: string, postId: string): Promise<void> {
  try {
    await getDb().withUser(userId, (tx) =>
      tx.query("update public.posts set status = 'failed' where id = $1", [postId]),
    );
  } catch (e) {
    console.error("[posts] could not mark post failed", e);
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function generatePost(opts: GeneratePostOptions): Promise<GenerateOutcome> {
  const { userId, brandId } = opts;
  const storage = opts.storage ?? getStorage();
  const startedAt = Date.now();
  const timings: Timings = { transcribeMs: 0, generateMs: 0, renderMs: 0, totalMs: 0 };
  const stage = (st: Stage) => opts.onStage?.(st);
  let postId: string | null = null;

  const fail = async (code: FailCode, message: string): Promise<GenerateOutcome> => {
    if (postId) await markFailed(userId, postId);
    timings.totalMs = Date.now() - startedAt;
    console.info(`[posts] failed ${code} post=${postId ?? "-"} total=${timings.totalMs}ms`);
    return { ok: false, code, message, postId, timings };
  };

  try {
    stage("understanding");
    await requireBrandMember(userId, brandId);
    const profile = await getBrandProfile(userId, brandId);
    if (!profile || !profile.setupCompleted) throw new BrandAccessError();
    const draft = profile.draft;
    const language: ContentLanguage = draft.default_language || draft.languages[0] || "hi";

    const prepared = await validateInput(opts.input);
    await assertUnderDailyCap(brandId, opts.now);

    const post = await insertPost({ userId, brandId, inputType: prepared.type, language });
    postId = post.id;
    const base = `${brandId}/posts/${post.id}`;

    // ---- store the original input; normalise the photo ----
    let inputText = "";
    let photo: PreparedPhoto | null = null;
    let inputMediaPath: string | null = null;
    let photoPath: string | null = null;
    if (prepared.type === "text") {
      inputText = prepared.text;
    } else if (prepared.type === "photo") {
      photo = prepared.photo;
      inputText = prepared.caption;
      await storage.put("inputs", `${base}/original.${photo.originalExt}`, photo.original, `image/${photo.originalExt === "jpg" ? "jpeg" : photo.originalExt}`);
      await storage.put("inputs", `${base}/photo.jpg`, photo.normalised, "image/jpeg");
      inputMediaPath = `inputs/${base}/original.${photo.originalExt}`;
      photoPath = `inputs/${base}/photo.jpg`;
    } else {
      await storage.put("inputs", `${base}/original.wav`, prepared.bytes, "audio/wav");
      inputMediaPath = `inputs/${base}/original.wav`;
      const t = Date.now();
      let text: string;
      let usd = 0;
      let meta: UsageMeta = { ok: false };
      try {
        const res = await generateText({
          budgetMs: 20_000,
          timeoutMs: 15_000,
          instruction: TRANSCRIBE_INSTRUCTION,
          media: [{ mimeType: "audio/wav", data: prepared.bytes }],
          logContext: { brandId },
          fixture: opts.fixtures?.transcript ?? POST_TRANSCRIPT_FIXTURE,
        });
        text = res.text;
        usd = res.stats?.usd ?? 0;
        meta = { model: res.stats?.model };
      } finally {
        timings.transcribeMs = Date.now() - t;
        // The call was attempted, so it counts against the cap even if it failed.
        await recordUsage(brandId, userId, "transcribe", usd, meta);
      }
      inputText = text.trim();
    }
    await getDb().withUser(userId, (tx) =>
      tx.query(
        "update public.posts set input_text = $2, input_media_path = $3, photo_path = $4 where id = $1",
        [post.id, inputText || null, inputMediaPath, photoPath],
      ),
    );
    if (prepared.type === "voice" && !isTranscriptUsable(inputText)) {
      // Never generate from a bad transcript (PRD section 8).
      return await fail("unusable_transcript", s.create.errors.unusableVoice);
    }

    // ---- generate ----
    stage("writing");
    const regulated = isRegulatedCategory(draft.category);
    const genInput: GenerateInput = {
      brand: {
        business_name: draft.business_name,
        category: draft.category,
        city: draft.city,
        products: draft.products,
        audience: draft.audience,
        tone: draft.tone,
        notes: draft.notes,
      },
      regulated,
      language,
      input: { type: prepared.type, text: inputText },
      hasPhoto: photo !== null,
      mascot: null,
    };
    const media = photo ? [{ mimeType: "image/jpeg", data: photo.forAi }] : undefined;
    const fixtureSource = opts.fixtures?.generate;
    const callModel = async (attempt: number, fixIssues?: string[]): Promise<GenerateResult> => {
      const prompt = buildGeneratePrompt({ ...genInput, fixIssues });
      const fixture = () =>
        typeof fixtureSource === "function" ? fixtureSource(attempt) : (fixtureSource ?? generateFixture(language));
      const t = Date.now();
      let usd = 0;
      let meta: UsageMeta = { ok: false };
      try {
        const { data, stats } = await generateJson({
          budgetMs: 35_000,
          timeoutMs: 20_000, // R4: whole post under 60 s, incl. transcribe and render
          system: prompt.system,
          user: prompt.user,
          media,
          zodSchema: generateResultSchema,
          jsonSchema: generateResultJsonSchema,
          logContext: { brandId },
          fixture,
        });
        usd = stats?.usd ?? 0;
        meta = { model: stats?.model };
        return data;
      } catch (e) {
        usd = failedCallUsd(e); // an answer that did not validate still cost money (H-2)
        meta = { ok: false, model: failedCallModel(e) };
        throw e;
      } finally {
        timings.generateMs += Date.now() - t;
        await recordUsage(brandId, userId, attempt === 0 ? "generate" : "regenerate", usd, meta);
      }
    };

    let result = await callModel(0);
    if (result.status === "needs_input") {
      return await fail("needs_input", result.message_to_owner.trim() || s.create.errors.emptyText);
    }

    const sources = ownerSourcesText(genInput);
    let issues = checkAllOutputs(result.outputs, language, sources);
    if (blocking(issues).length > 0) {
      // Wrong script or too long: try once more, and keep the better result.
      const fix = blocking(issues).map((i) => `${i.channel} ${i.field}: ${i.code} (${i.detail})`);
      const second = await callModel(1, fix);
      if (second.status === "ok") {
        const secondIssues = checkAllOutputs(second.outputs, language, sources);
        if (blocking(secondIssues).length <= blocking(issues).length) {
          result = second;
          issues = secondIssues;
        }
      }
    }

    // ---- render ----
    stage("designing");
    const renderStart = Date.now();
    const colors = paletteWithDefaults(draft.colors);
    let logo: Buffer | undefined;
    if (profile.logoPath?.startsWith("brand-assets/")) {
      const file = await storage.get("brand-assets", profile.logoPath.slice("brand-assets/".length));
      if (file) logo = Buffer.from(file.bytes);
    }
    const brandForRender = { name: draft.business_name, colors, logo };
    const renderChannel = (channel: "ig_feed" | "status"): Promise<RenderResult> => {
      const out = result.outputs[channel];
      const square = channel === "ig_feed";
      return renderPostDetailed({
        format: square ? "square" : "tall",
        templateId: square ? (photo ? "sq-photo-band" : "sq-text") : photo ? "tl-photo-top" : "tl-text",
        brand: brandForRender,
        photo: photo?.normalised,
        text: { ...out.image_text, cta: out.cta },
      });
    };
    const [ig, st] = await Promise.all([renderChannel("ig_feed"), renderChannel("status")]);
    const renderBase = `${brandId}/${post.id}`;
    await storage.put("renders", `${renderBase}/ig_feed.png`, ig.png, "image/png");
    await storage.put("renders", `${renderBase}/status.png`, st.png, "image/png");
    const imageFor: Record<Channel, { path: string; templateId: string } | null> = {
      ig_feed: { path: `renders/${renderBase}/ig_feed.png`, templateId: ig.templateId },
      status: { path: `renders/${renderBase}/status.png`, templateId: st.templateId },
      // Facebook uses the square image.
      facebook: { path: `renders/${renderBase}/ig_feed.png`, templateId: ig.templateId },
      gbp: null,
    };
    timings.renderMs = Date.now() - renderStart;

    // ---- save outputs and finish ----
    let openFlags = 0;
    await getDb().withUser(userId, async (tx) => {
      for (const channel of CHANNELS) {
        const out: ChannelOutput = result.outputs[channel];
        const flags = flagsFromIssues(issues, channel, regulated);
        openFlags += flags.length;
        const image = imageFor[channel];
        await tx.query(
          `insert into public.outputs
             (post_id, brand_id, channel, language, caption, cta, hashtags, image_text,
              template_id, image_path, fact_flags, original)
           values ($1, $2, $3::public.channel, $4::public.content_language, $5, $6,
                   array(select jsonb_array_elements_text($7::jsonb)), $8::jsonb,
                   $9, $10, $11::jsonb, $12::jsonb)`,
          [
            post.id,
            brandId,
            channel,
            language,
            out.caption,
            out.cta,
            JSON.stringify(out.hashtags),
            JSON.stringify(out.image_text),
            image?.templateId ?? null,
            image?.path ?? null,
            JSON.stringify(flags),
            JSON.stringify(out),
          ],
        );
      }
      await tx.query("update public.posts set status = 'draft' where id = $1", [post.id]);
    });

    timings.totalMs = Date.now() - startedAt;
    console.info(
      `[posts] ok post=${post.id} type=${prepared.type} lang=${language} flags=${openFlags} ` +
        `transcribe=${timings.transcribeMs}ms generate=${timings.generateMs}ms render=${timings.renderMs}ms total=${timings.totalMs}ms`,
    );
    return { ok: true, postId: post.id, postCode: post.code, timings, openFlags };
  } catch (e) {
    const f = failureFor(e);
    return fail(f.code, f.message);
  }
}
