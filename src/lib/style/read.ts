// "Keep my look" (C-17, G-2): read the brand's own look from its pictures and website colours, and suggest a kit.
// Runs only when the owner taps "Read my look" (never on page load). One Gemini vision call, logged as usage
// 'style_read' with its cost, limited to 3 reads a week.

import { generateJson } from '@/lib/ai/client';
import { STYLE_READ_PROMPT_VERSION, STYLE_READ_SYSTEM, buildStyleReadUser } from '@/lib/ai/prompts/v3';
import { styleReadJsonSchema, styleReadSchema, type StyleRead } from '@/lib/ai/schemas-v3';
import { assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage } from '@/lib/usage';
import { assertUnderWeeklyCap } from '@/lib/usage/caps';
import { styleCopy } from './copy';
import { suggestKitDetailed, type KitSource, type KitSuggestion } from './kit';
import { collectStyleSamples, type SampleDeps } from './samples';
import { loadCurrentKit } from './store';

export { STYLE_READ_PROMPT_VERSION };

export type StyleResultStatus =
  | 'ok' // read from pictures (and website colours)
  | 'colors_only' // fewer than 3 pictures: website colours only
  | 'nothing'; // nothing to learn from

export interface StyleResult {
  status: StyleResultStatus;
  source: KitSource | null;
  read: StyleRead | null;
  suggestion: KitSuggestion | null;
  /** Shown to the owner (colours only, nothing found). */
  note: string | null;
  counts: { images: number; fromInstagram: number; fromPhotos: number; websiteColors: number };
  usd: number;
}

/** A plausible answer for development and tests (fixture mode); built on the website colour when there is one. */
export function fixtureStyleRead(websiteColors: string[]): StyleRead {
  return {
    colors: [
      { hex: websiteColors[0] ?? '#C0392B', share: 0.5 },
      { hex: '#FFF8F0', share: 0.3 },
      { hex: '#2C3E50', share: 0.2 },
    ],
    mode: 'light',
    energy: 'calm',
    corners: 'rounded',
    text_density: 'medium',
    text_position: 'bottom',
    photo_share: 0.4,
    headline_font: 'sans',
    body_font: 'sans',
    theme: 'clean',
    confidence: 0.8,
    summary: 'Warm red on cream with dark blue text, rounded shapes and plenty of space.',
  };
}

export interface ReadDeps {
  samples?: SampleDeps;
  fixture?: StyleRead | (() => StyleRead);
}

/**
 * Reads the look and suggests a kit. Throws BrandAccessError, DailyCapError, WeeklyCapError, AiError.
 * With fewer than 3 pictures nothing is sent to the model: the suggestion uses the website colours only
 * and `note` says so. Does not save anything: the owner chooses "Keep my look".
 */
export async function readStyle(args: { userId: string; brandId: string }, deps: ReadDeps = {}): Promise<StyleResult> {
  const { userId, brandId } = args;
  const [samples, context] = await Promise.all([collectStyleSamples({ userId, brandId }, deps.samples), loadCurrentKit(userId, brandId)]);
  const counts = {
    images: samples.images.length,
    fromInstagram: samples.fromInstagram,
    fromPhotos: samples.fromPhotos,
    websiteColors: samples.websiteColors.length,
  };

  if (samples.colorsOnly) {
    if (samples.websiteColors.length === 0) {
      return { status: 'nothing', source: null, read: null, suggestion: null, note: styleCopy.nothing, counts, usd: 0 };
    }
    // No model call: the kit keeps its fonts, style and theme; only the colours come from the website.
    const k = context.kit;
    const read: StyleRead = {
      colors: samples.websiteColors.map((hex, i) => ({ hex, share: Math.max(0.1, 0.6 - i * 0.2) })),
      mode: k.style.mode,
      energy: k.style.energy,
      corners: k.style.corners,
      text_density: 'medium',
      text_position: 'mixed',
      photo_share: 0,
      headline_font: k.fonts.headline,
      body_font: k.fonts.body,
      theme: k.themeId,
      confidence: 0.6,
      summary: 'Your website colours.',
    };
    const suggestion = suggestKitDetailed(read, k, 'website');
    return { status: 'colors_only', source: 'website', read, suggestion, note: styleCopy.coloursOnly, counts, usd: 0 };
  }

  await assertUnderDailyCap(brandId);
  await assertUnderWeeklyCap(brandId, 'style_read');

  let result;
  try {
    result = await generateJson({
      system: STYLE_READ_SYSTEM,
      user: buildStyleReadUser({
        brandName: context.brandName,
        sells: context.sells,
        imageCount: samples.images.length,
        websiteColors: samples.websiteColors,
      }),
      media: samples.images,
      zodSchema: styleReadSchema,
      jsonSchema: styleReadJsonSchema,
      temperature: 0.2,
      timeoutMs: 40_000,
      budgetMs: 60_000,
      logContext: { brandId },
      fixture: deps.fixture ?? (() => fixtureStyleRead(samples.websiteColors)),
    });
  } catch (e) {
    const cost = failedCallUsd(e);
    if (cost > 0) await recordUsage(brandId, userId, 'style_read', cost, { ok: false, model: failedCallModel(e) });
    throw e;
  }
  const usd = result.stats?.usd ?? 0;
  await recordUsage(brandId, userId, 'style_read', usd, { model: result.stats?.model });

  const source: KitSource = samples.websiteColors.length > 0 ? 'mixed' : 'instagram';
  const suggestion = suggestKitDetailed(result.data, context.kit, source);
  return { status: 'ok', source, read: result.data, suggestion, note: suggestion.message, counts, usd };
}
