// Generate prompt: one owner input -> posts for all 4 channels (R4, R5, R8).
// Owned by the orchestrator (T-4). Builders call buildGeneratePrompt(); they do not edit it.

import type { ContentLanguage } from '../schemas';
import {
  CHANNEL_SPECS,
  CTA_RULES,
  FACT_RULES,
  IMAGE_TEXT_RULES,
  LANGUAGE_NAMES,
  LANGUAGE_RULES,
  REGULATED_RULES,
} from './shared';

export const GENERATE_PROMPT_VERSION = 'generate-v5';

export interface PromptProduct {
  name: string;
  price?: string;
  unit?: string;
  note?: string;
}

export interface PromptBrand {
  business_name: string;
  category: string;
  city: string;
  products: PromptProduct[];
  audience: string;
  tone: string;
  notes: string; // other facts the owner stated in setup
}

export interface GenerateInput {
  brand: PromptBrand;
  regulated: boolean;
  language: ContentLanguage;
  input: {
    type: 'photo' | 'text' | 'voice';
    text: string; // typed text, voice transcript, or photo caption ('' if none)
  };
  // The photo itself is attached as an image part by the caller when present.
  hasPhoto: boolean;
  weekGoal?: {
    goal: 'footfall' | 'enquiries' | 'offer' | 'awareness';
    detail: string; // owner's own words, e.g. the offer
    idea?: { title: string; description: string; occasion: string | null };
  };
  mascot?: { name: string; personality: string } | null;
  // Set on the one automatic retry: the problems code found in the first attempt.
  fixIssues?: string[];
}

const channelSection = Object.entries(CHANNEL_SPECS)
  .map(([key, s]) => {
    const tags = s.hashtags[1] === 0 ? 'hashtags: [] (none)' : `hashtags: ${s.hashtags[0]}-${s.hashtags[1]}`;
    const img = s.imageText ? 'image_text: required' : 'image_text: all three fields ""';
    return `- ${key}: ${s.label}. ${s.caption} Caption max ${s.captionMaxChars} characters. ${tags}. ${img}.`;
  })
  .join('\n');

export const GENERATE_SYSTEM = `You write social media posts for small local businesses in India. Owners send you a photo, a line of text or a voice note; you turn it into ready-to-post content their customers will read. You write like a friendly local copywriter, not like an ad agency.

OUTPUT
Return JSON matching the schema. Create one output per channel:
${channelSection}

Every output has a caption, a cta and hashtags. The four outputs say the same thing, each fitted to its channel. Do not copy the same caption across channels.

${CTA_RULES}

${IMAGE_TEXT_RULES}

${FACT_RULES}

${REGULATED_RULES}

facts_used: list every price, discount, offer, date, time, phone, quantity or claim you used in any output, copied exactly, with where it came from. [] if none.

UNCLEAR INPUT
If the owner input is a garbled voice transcript, empty with no usable photo, or you cannot tell what the post should be about: set status "needs_input", write message_to_owner (one or two short lines in the output language asking them to send it again or type it), and fill every output field with "" and [] . Never guess facts from an unclear input.
Otherwise status "ok" and message_to_owner "".

summary: one short English line saying what the post is about.`;

function brandBlock(b: PromptBrand): string {
  const products = b.products.length
    ? b.products
        .map((p) => {
          const unit = p.unit ? (/^per\s/i.test(p.unit) ? ` ${p.unit}` : ` per ${p.unit}`) : '';
          const price = p.price ? ` — ₹${p.price}${unit}` : '';
          const note = p.note ? ` (${p.note})` : '';
          return `  - ${p.name}${price}${note}`;
        })
        .join('\n')
    : '  (none given)';
  return [
    `Business name: ${b.business_name}`,
    `Category: ${b.category}`,
    `City: ${b.city}`,
    `Products/services:\n${products}`,
    `Audience: ${b.audience || '(not given)'}`,
    `Tone: ${b.tone || 'friendly'}`,
    `Other facts from the owner: ${b.notes || '(none)'}`,
  ].join('\n');
}

export function buildGeneratePrompt(g: GenerateInput): { system: string; user: string } {
  const parts: string[] = [];

  parts.push(`OUTPUT LANGUAGE: ${LANGUAGE_NAMES[g.language]}\n${LANGUAGE_RULES[g.language]}`);
  parts.push(`BRAND MEMORY (owner source)\n${brandBlock(g.brand)}`);
  if (g.regulated) {
    parts.push('This business is REGULATED. Apply the regulated business rules strictly.');
  }

  if (g.weekGoal) {
    const idea = g.weekGoal.idea
      ? `\nPlanned idea: ${g.weekGoal.idea.title} — ${g.weekGoal.idea.description}${g.weekGoal.idea.occasion ? ` (occasion: ${g.weekGoal.idea.occasion})` : ''}`
      : '';
    parts.push(`WEEK GOAL (owner source)\nGoal: ${g.weekGoal.goal}\nOwner's words: ${g.weekGoal.detail || '(none)'}${idea}`);
  }

  const inputKind = {
    photo: 'a photo' + (g.input.text ? ' with this caption' : ' with no caption'),
    text: 'a typed message',
    voice: 'a voice note; this is its transcript, which may have errors',
  }[g.input.type];
  parts.push(
    `OWNER INPUT (owner source) — ${inputKind}:\n"""\n${g.input.text || '(no text)'}\n"""` +
      (g.hasPhoto
        ? '\nThe owner photo is attached. Describe only what it shows; do not read prices or offers off it.'
        : ''),
  );

  parts.push(
    g.mascot
      ? `MASCOT: ${g.mascot.name}, ${g.mascot.personality}. Write a bubble line for ig_feed and status in the mascot's voice.`
      : 'MASCOT: none. Every bubble is "".',
  );

  if (g.fixIssues?.length) {
    const list = g.fixIssues.map((i) => `- ${i}`).join('\n');
    parts.push(`YOUR PREVIOUS ATTEMPT HAD THESE PROBLEMS. Fix them:\n${list}`);
  }

  parts.push('Write the four outputs now.');
  return { system: GENERATE_SYSTEM, user: parts.join('\n\n') };
}

// Everything the owner gave, as one string. Checks compare outputs against it
// (numbers and risky phrases must appear here).
export function ownerSourcesText(g: GenerateInput): string {
  const goal = g.weekGoal
    ? [g.weekGoal.detail, g.weekGoal.idea?.title, g.weekGoal.idea?.description, g.weekGoal.idea?.occasion]
    : [];
  return [brandBlock(g.brand), g.input.text, ...goal].filter(Boolean).join('\n');
}
