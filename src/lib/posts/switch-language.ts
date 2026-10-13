import { AiError, generateJson } from "@/lib/ai/client";
import { checkChannelOutput, type CheckIssue } from "@/lib/ai/checks";
import { ownerSourcesText, type GenerateInput } from "@/lib/ai/prompts/generate";
import { buildSwitchLanguagePrompt } from "@/lib/ai/prompts/switch-language";
import { isRegulatedCategory } from "@/lib/ai/regulated";
import {
  CONTENT_LANGUAGES,
  switchLanguageResultJsonSchema,
  switchLanguageResultSchema,
  type Channel,
  type ChannelOutput,
  type ContentLanguage,
} from "@/lib/ai/schemas";
import { getBrandProfile } from "@/lib/brand/profile";
import { getDb } from "@/lib/db";
import { fill, s } from "@/lib/i18n/strings";
import { renderPostDetailed, templateInfo } from "@/lib/render";
import { getStorage, type Storage } from "@/lib/storage";
import { DailyCapError, assertUnderDailyCap, failedCallUsd, recordUsage } from "@/lib/usage";
import { flagsFromIssues, paletteWithDefaults } from "./generate";
import { switchFixture } from "./fixtures";
import {
  REVIEW_OUTPUT_COLUMNS,
  toReviewOutput,
  type OutputRow,
  type ReviewFlag,
  type ReviewOutput,
} from "./review";

/**
 * R5: switch one output to Hindi, Hinglish or English.
 *
 *   load output (as the user, RLS) -> same language? stop -> daily cap
 *   -> switch prompt (+ one retry on wrong script / too long) -> fact checks
 *   -> re-render image -> save the output row
 *
 * Nothing is written until the new text and image both exist, so any failure
 * leaves the old content in place.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SwitchTimings {
  aiMs: number;
  renderMs: number;
  totalMs: number;
}

export type SwitchFailCode = "not_found" | "invalid_input" | "cap" | "ai_failed" | "generic";

export type SwitchOutcome =
  /** `changed` is false when the output was already in the requested language (no AI call). */
  | { ok: true; changed: boolean; output: ReviewOutput; openFlags: number; timings: SwitchTimings }
  | { ok: false; code: SwitchFailCode; message: string };

export interface SwitchOptions {
  userId: string;
  outputId: string;
  to: ContentLanguage;
  storage?: Storage;
  now?: Date;
  /** Fixture mode only (live mode ignores this). Tests use it to steer the pipeline: the argument is 0 for the first call and 1 for the retry. */
  fixtures?: { result?: ChannelOutput | ((attempt: number) => ChannelOutput) };
}

interface LoadedOutput extends OutputRow {
  post_id: string;
  brand_id: string;
  image_text: ChannelOutput["image_text"] | null;
}

interface LoadedPost {
  input_type: "text" | "photo" | "voice";
  input_text: string | null;
  photo_path: string | null;
  post_code: string;
}

const blocking = (issues: CheckIssue[]) => issues.filter((i) => i.code === "wrong_script" || i.code === "too_long");
const FACT_CODES: CheckIssue["code"][] = ["unsupported_number", "unsupported_phrase", "contact_detail"];

function outputText(o: ChannelOutput): string {
  return [o.caption, o.cta, o.image_text.headline, o.image_text.subline, o.image_text.bubble, o.hashtags.join(" ")].join("\n");
}

const toLatinDigits = (x: string) => x.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));

/** True when the text a flag points at is still in the new output. */
function flagAppears(flag: ReviewFlag, haystack: string): boolean {
  const text = toLatinDigits(flag.text).trim().toLowerCase();
  if (!text) return false;
  const hay = toLatinDigits(haystack).toLowerCase();
  if (flag.kind === "price") {
    const numbers = (hay.replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => n.replace(/\.0+$/, ""));
    return numbers.includes(text.replace(/,/g, "").replace(/\.0+$/, ""));
  }
  return hay.includes(text);
}

/** Confirmed and removed flags stay; open flags stay only while their text is still there; new issues become open flags. */
function mergeFlags(existing: ReviewFlag[], newText: string, issues: CheckIssue[], channel: Channel, regulated: boolean): ReviewFlag[] {
  const kept = existing.filter((f) => f.status !== "open" || flagAppears(f, newText));
  const fresh = flagsFromIssues(issues, channel, regulated).filter(
    (n) => !kept.some((k) => k.status !== "removed" && k.kind === n.kind && k.text === n.text),
  );
  return [...kept, ...fresh];
}

function failureFor(e: unknown): { code: SwitchFailCode; message: string } {
  if (e instanceof DailyCapError) return { code: "cap", message: fill(s.errors.dailyCap, { cap: e.cap }) };
  if (e instanceof AiError) return { code: "ai_failed", message: s.review.switch.failed };
  console.error("[posts] switch language failed", e);
  return { code: "generic", message: s.review.switch.failed };
}

export async function switchOutputLanguage(opts: SwitchOptions): Promise<SwitchOutcome> {
  const { userId, outputId, to } = opts;
  const startedAt = Date.now();
  const timings: SwitchTimings = { aiMs: 0, renderMs: 0, totalMs: 0 };

  if (!CONTENT_LANGUAGES.includes(to)) return { ok: false, code: "invalid_input", message: s.review.switch.invalidLanguage };
  if (!UUID_RE.test(outputId)) return { ok: false, code: "not_found", message: s.review.switch.notFound };

  try {
    const storage = opts.storage ?? getStorage();

    // ---- load as the user: a non-member sees nothing ----
    const loaded = await getDb().withUser(userId, async (tx) => {
      const [out] = await tx.query<LoadedOutput>(
        `select ${REVIEW_OUTPUT_COLUMNS}, post_id, brand_id, image_text from public.outputs where id = $1`,
        [outputId],
      );
      if (!out) return null;
      const [post] = await tx.query<LoadedPost>(
        "select input_type::text as input_type, input_text, photo_path, post_code from public.posts where id = $1",
        [out.post_id],
      );
      return post ? { out, post } : null;
    });
    if (!loaded) return { ok: false, code: "not_found", message: s.review.switch.notFound };
    const { out, post } = loaded;
    const brandId = out.brand_id;
    const channel = out.channel;
    const from = out.language;

    if (from === to) {
      return { ok: true, changed: false, output: toReviewOutput(out, post.post_code), openFlags: countOpen(out.fact_flags), timings };
    }

    const profile = await getBrandProfile(userId, brandId);
    if (!profile) return { ok: false, code: "not_found", message: s.review.switch.notFound };
    const draft = profile.draft;
    const regulated = isRegulatedCategory(draft.category);

    await assertUnderDailyCap(brandId, opts.now);

    // ---- sources the switch may use ----
    const previous: ChannelOutput = {
      caption: out.caption,
      cta: out.cta ?? "",
      hashtags: out.hashtags ?? [],
      image_text: out.image_text ?? { headline: "", subline: "", bubble: "" },
    };
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
      language: to,
      input: { type: post.input_type, text: post.input_text ?? "" },
      hasPhoto: post.photo_path !== null,
      mascot: null,
    };
    const existingFlags = out.fact_flags ?? [];
    const ownerSources = ownerSourcesText(genInput);
    // Facts already in the old version, or confirmed by the owner, may carry over; the switch adds none.
    const factSources = [
      ownerSources,
      ...existingFlags.filter((f) => f.status === "confirmed").map((f) => f.text),
      outputText(previous),
    ].join("\n");

    // ---- switch ----
    const prompt = buildSwitchLanguagePrompt({ channel, from, to, output: previous });
    const fixtureSource = opts.fixtures?.result;
    const callModel = async (attempt: number): Promise<ChannelOutput> => {
      const t = Date.now();
      let usd = 0;
      try {
        const { data, stats } = await generateJson({
          budgetMs: 20_000,
          timeoutMs: 8_000, // R5: under 10 s; a stalled call is retried once
          system: prompt.system,
          user: prompt.user,
          zodSchema: switchLanguageResultSchema,
          jsonSchema: switchLanguageResultJsonSchema,
          temperature: 0.4,
          logContext: { brandId },
          fixture: () =>
            typeof fixtureSource === "function" ? fixtureSource(attempt) : (fixtureSource ?? switchFixture(channel, to)),
        });
        usd = stats?.usd ?? 0;
        return data;
      } catch (e) {
        usd = failedCallUsd(e); // an answer that did not validate still cost money (H-2)
        throw e;
      } finally {
        timings.aiMs += Date.now() - t;
        // The call was attempted, so it counts against the cap even if it failed.
        await recordUsage(brandId, userId, "switch_language", usd);
      }
    };
    // Script and length are judged against the owner's sources only: the old text must not
    // make unchanged English words look like allowed brand names in a Hindi result.
    const blockingOf = (r: ChannelOutput) => blocking(checkChannelOutput(channel, r, to, ownerSources));

    let result = await callModel(0);
    const firstBlocking = blockingOf(result);
    if (firstBlocking.length > 0) {
      // Wrong script or too long: try once more and keep the better result (same rule as generate).
      let capReached = false;
      try {
        await assertUnderDailyCap(brandId, opts.now);
      } catch (e) {
        if (!(e instanceof DailyCapError)) throw e;
        capReached = true;
      }
      if (!capReached) {
        const second = await callModel(1);
        if (blockingOf(second).length <= firstBlocking.length) result = second;
      }
    }

    const factIssues = checkChannelOutput(channel, result, to, factSources).filter((i) => FACT_CODES.includes(i.code));
    const flags = mergeFlags(existingFlags, outputText(result), factIssues, channel, regulated);

    // ---- re-render the image (outputs that have one) ----
    let imagePath = out.image_path;
    let templateId = out.template_id;
    const renderStart = Date.now();
    if (out.image_path && out.template_id) {
      let logo: Buffer | undefined;
      if (profile.logoPath?.startsWith("brand-assets/")) {
        const file = await storage.get("brand-assets", profile.logoPath.slice("brand-assets/".length));
        if (file) logo = Buffer.from(file.bytes);
      }
      let photo: Buffer | undefined;
      if (post.photo_path?.startsWith("inputs/")) {
        const file = await storage.get("inputs", post.photo_path.slice("inputs/".length));
        if (file) photo = Buffer.from(file.bytes);
      }
      const info = templateInfo(out.template_id);
      const format = info?.format ?? (channel === "status" ? "tall" : "square");
      const rendered = await renderPostDetailed({
        format,
        templateId: info ? out.template_id : format === "square" ? "sq-text" : "tl-text",
        brand: { name: draft.business_name, colors: paletteWithDefaults(draft.colors), logo },
        photo,
        text: { ...result.image_text, cta: result.cta },
      });
      // Each channel owns its file. Facebook started out sharing ig_feed's PNG; its first
      // switch gives it facebook.png, so ig_feed's image is not touched.
      const renderBase = `${brandId}/${out.post_id}`;
      const file = `${renderBase}/${channel}.png`;
      await storage.put("renders", file, rendered.png, "image/png");
      imagePath = `renders/${file}`;
      templateId = rendered.templateId;
    }
    timings.renderMs = Date.now() - renderStart;

    // ---- save ----
    // `original` and `edited_at` are left as they were.
    const saved = await getDb().withUser(userId, async (tx) => {
      const [row] = await tx.query<OutputRow>(
        `update public.outputs set
           language = $2::public.content_language, caption = $3, cta = $4,
           hashtags = array(select jsonb_array_elements_text($5::jsonb)),
           image_text = $6::jsonb, template_id = $7, image_path = $8, fact_flags = $9::jsonb,
           updated_at = now()
         where id = $1
         returning ${REVIEW_OUTPUT_COLUMNS}`,
        [
          outputId,
          to,
          result.caption,
          result.cta,
          JSON.stringify(result.hashtags),
          JSON.stringify(result.image_text),
          templateId,
          imagePath,
          JSON.stringify(flags),
        ],
      );
      return row;
    });
    if (!saved) return { ok: false, code: "not_found", message: s.review.switch.notFound };

    timings.totalMs = Date.now() - startedAt;
    console.info(
      `[posts] switch ok output=${outputId} channel=${channel} ${from}->${to} flags=${countOpen(flags)} ` +
        `ai=${timings.aiMs}ms render=${timings.renderMs}ms total=${timings.totalMs}ms`,
    );
    return { ok: true, changed: true, output: toReviewOutput(saved, post.post_code), openFlags: countOpen(flags), timings };
  } catch (e) {
    const f = failureFor(e);
    console.info(`[posts] switch failed ${f.code} output=${outputId} total=${Date.now() - startedAt}ms`);
    return { ok: false, ...f };
  }
}

function countOpen(flags: ReviewFlag[] | null): number {
  return (flags ?? []).filter((f) => f.status === "open").length;
}
