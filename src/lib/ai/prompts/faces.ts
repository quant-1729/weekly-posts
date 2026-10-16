// Brand Face image prompts (F-5; docs/10-plan-research-and-brand-face.md section 2, docs/12 section B). Orchestrator-owned:
// ALL prompt text for making a face lives here. Nothing else builds a prompt string.
//
// Rules these prompts carry (CLAUDE.md): one fictional character, no text anywhere in the image (code draws all text),
// no logos, products, premises or other people, nothing that implies a profession or credentials, a flat pure-green
// background so code can cut the figure out, and for a realistic person "does not resemble any real or famous person".
// The only owner text is the character description, and it goes through redactPaymentIds here, so a payment ID typed
// into a description can never reach a model.

import { redactPaymentIds } from '@/lib/payments/redact';
import type { FaceKind, FacePose, FaceStyle } from '@/lib/faces/types';

/** Bump when any text below changes in a way that should be recorded in a face's provenance. */
export const FACE_PROMPT_VERSION = 'faces-v1';

/** The keying colour: the background of every generated image. The cut-out removes exactly this. */
export const FACE_KEY_HEX = '#00FF00';

/** One fixed style block per style. The owner picks the style; the description only adds the character. */
export const FACE_STYLE_BLOCKS: Record<FaceStyle, string> = {
  flat:
    'Flat vector illustration style: clean solid colour shapes, simple smooth outlines, minimal shading, friendly proportions, like a modern brand character.',
  '3d_cartoon':
    'Soft 3D cartoon style: rounded forms, smooth matte materials, gentle studio lighting, friendly stylised proportions, like an animated-film character. No harsh cast shadow on the ground.',
  line_art:
    'Line art illustration style: confident uniform dark outlines on light flat fills, very little shading, friendly simplified proportions.',
  photo:
    'Realistic studio photograph of a person, natural skin and hair, soft even lighting, sharp focus, neutral expression of a real photo, shot on a plain backdrop.',
};

/** The default style per kind when the owner did not choose one. */
export const DEFAULT_FACE_STYLE: Record<'illustrated' | 'photoreal', FaceStyle> = { illustrated: 'flat', photoreal: 'photo' };

/** Appended to every prompt that draws the character. */
export const FACE_FRAMING_RULES =
  'Single character, full body, centred, plain flat pure green #00FF00 background, no text, no letters, no logos, no products, no buildings, no other people, ' +
  'no props implying a profession (no white coat, stethoscope, scrubs, gavel, suit-and-briefcase banker look). ' +
  'The character wears plain casual clothing and nothing green, so the background can be removed cleanly. ' +
  'The background is one even colour with no gradient, floor line, shadow or reflection.';

/** Only for a realistic person. */
export const FACE_PHOTOREAL_RULE =
  'A fictional adult person who does not resemble any real or famous person. Clearly an adult. No uniform, badge or name tag.';

/** One line per pose, the same seven poses as Tween's post rig. */
export const FACE_POSE_LINES: Record<FacePose, string> = {
  wave: 'Pose: standing, one hand raised in a friendly wave, smiling, facing the viewer.',
  talk: 'Pose: standing, mouth slightly open as if talking, one hand making a gentle explaining gesture at chest height.',
  point: 'Pose: standing, one arm extended and pointing to the side with the index finger, looking toward the viewer.',
  think: 'Pose: standing, one hand on the chin, head slightly tilted, thoughtful expression, looking up and aside.',
  celebrate: 'Pose: standing, both arms raised in joy, big smile, a clear celebration pose. No confetti, no props.',
  present: 'Pose: standing, one open palm held out to the side as if presenting something. The hand is empty; nothing is held and nothing is shown.',
  idle: 'Pose: standing relaxed, arms at the sides, calm friendly expression, facing the viewer.',
};

/** Option i of FACE_OPTIONS: small differences so the owner has a real choice. Look only, never products or places. */
export const FACE_OPTION_VARIATIONS: readonly string[] = [
  'Variation: warm, calm expression; classic hairstyle.',
  'Variation: cheerful broad smile; a different hairstyle and hair colour.',
  'Variation: confident friendly look; slightly different build and clothing cut.',
  'Variation: relaxed, approachable look; a different accessory-free outfit colour mix.',
];

export interface FacePromptInput {
  kind: Extract<FaceKind, 'illustrated' | 'photoreal'>;
  style: FaceStyle;
  /** The owner's description (redacted again here). */
  description: string;
  /** Brand colours as #RRGGBB, used only for clothing and accents. */
  colors?: readonly string[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The character: style block, the owner's words (redacted), brand colours, and the photoreal rule. */
function characterBlock(i: FacePromptInput): string {
  const colors = (i.colors ?? []).filter((c) => HEX.test(c) && c.toUpperCase() !== FACE_KEY_HEX);
  const lines = [
    FACE_STYLE_BLOCKS[i.style],
    `Character: ${redactPaymentIds(i.description).replace(/\s+/g, ' ').trim()}`,
    colors.length ? `Clothing and accents use these brand colours: ${colors.join(', ')}.` : '',
    i.kind === 'photoreal' ? FACE_PHOTOREAL_RULE : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Step a: one of the master options (no reference images). */
export function buildOptionPrompt(i: FacePromptInput, optionIndex: number): string {
  const variation = FACE_OPTION_VARIATIONS[optionIndex % FACE_OPTION_VARIATIONS.length];
  return [characterBlock(i), variation, FACE_POSE_LINES.idle, FACE_FRAMING_RULES].join('\n');
}

/** Step b: the character sheet; the master is the reference image. */
export function buildSheetPrompt(i: FacePromptInput): string {
  return [
    'Character sheet of the exact same character as the reference image: three full-body views side by side on one canvas, in this order: front view, three-quarter view, side view. Same face, hair, build, outfit, colours and style in all three views; standing relaxed.',
    characterBlock(i),
    FACE_FRAMING_RULES,
    'No labels, no captions, no arrows, no measurement marks, no text of any kind.',
  ].join('\n');
}

/** Step c: one pose; the master and the approved sheet are the reference images. */
export function buildPosePrompt(i: FacePromptInput, pose: FacePose): string {
  return [
    'Draw the exact same character as the reference images (the first is the master, the second is the character sheet). Keep the same face, hair, build, outfit, colours and style. Only the pose changes.',
    characterBlock(i),
    FACE_POSE_LINES[pose],
    FACE_FRAMING_RULES,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Vision check (Gemini text model with the images)
// ---------------------------------------------------------------------------------------------

export const FACE_CHECK_SYSTEM = `You check one generated image of a brand character against its master image. Answer only with the JSON asked for. Be strict: if unsure, answer the way that fails the image.

You are given the MASTER image first and the CANDIDATE image second.
- sameCharacter: true only if the candidate is clearly the same character as the master (same face, hair, build, outfit, colours, style).
- hasText: true if the candidate contains any letters, numbers, words or symbols that read as text.
- hasLogo: true if the candidate contains any logo, brand mark or emblem.
- showsProductOrPremises: true if it shows any product, food, bottle, object for sale, shop, building, room or scenery. A plain even background is fine.
- credentialCues: true if the outfit or props imply a profession or credentials (white coat, stethoscope, scrubs, gavel, judge robe, banker suit with briefcase, uniform, badge).
- extraLimbs: true if there are extra, missing or malformed limbs, hands or fingers, or two heads.
- notes: one short sentence naming the biggest problem, or "ok".`;

export const FACE_CHECK_USER =
  'Compare the candidate (second image) with the master (first image) and answer as JSON: {"sameCharacter": boolean, "hasText": boolean, "hasLogo": boolean, "showsProductOrPremises": boolean, "credentialCues": boolean, "extraLimbs": boolean, "notes": string}';

export const FACE_CHECK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    sameCharacter: { type: 'boolean' },
    hasText: { type: 'boolean' },
    hasLogo: { type: 'boolean' },
    showsProductOrPremises: { type: 'boolean' },
    credentialCues: { type: 'boolean' },
    extraLimbs: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['sameCharacter', 'hasText', 'hasLogo', 'showsProductOrPremises', 'credentialCues', 'extraLimbs', 'notes'],
  additionalProperties: false,
} as const;
