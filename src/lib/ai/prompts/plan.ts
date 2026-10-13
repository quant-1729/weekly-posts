// Weekly plan: brand + goal + occasions -> 3-5 post ideas with a day each (R3, F1).
// Owned by the orchestrator. Builders call buildPlanPrompt(); they do not edit it.
// Code picks which calendar occasions are passed in (see selectOccasions in the
// plan module); the model only chooses among them.

import type { ContentLanguage } from '../schemas';
import { FACT_RULES, LANGUAGE_NAMES, REGULATED_RULES } from './shared';
import type { PromptBrand } from './generate';

export const PLAN_PROMPT_VERSION = 'plan-v1';

export interface PlanOccasion {
  key: string;
  name: string; // English name
  name_hi: string;
  date: string; // YYYY-MM-DD
  end_date: string | null;
  angle: string; // post_angle_en from the calendar
  sensitive: boolean; // e.g. Muharram: greetings only, no selling
}

export const PLAN_SYSTEM = `You plan one week of social media posts for a small Indian business. The owner is busy and not a marketer: give 3 to 5 simple, doable ideas, each on its own day, that move their goal forward.

EACH IDEA
- title: 3-7 words, in the output language.
- description: 1-2 short lines in the output language: what to post and why it helps this week.
- photo_tip: one short line in the output language: what photo to take on their phone (e.g. "ताज़ी जलेबी की थाली, ऊपर से फोटो"), or "" for a text-only post.
- starter_text: one line in the output language the owner can send as-is to create the post. It may use only facts from the brand memory or the owner's goal; leave prices out unless they are there.
- suggested_day: a date from the WEEK DAYS list. Spread ideas across the week; at most one per day.
- occasion_key: the key of the occasion it uses, or "" if none.

RULES
- If the OCCASIONS list is not empty, at least one idea must use an occasion, on or a little before its date. Never put an idea after the occasion has passed.
- Sensitive occasions (marked SENSITIVE) get a respectful greeting idea only: no selling, no offers, no products.
- Match ideas to the goal: footfall (bring people to the shop), enquiries (get WhatsApp messages), offer (promote the owner's offer, in their words only), awareness (introduce the business and its products).
- Mix kinds of posts: a product, a behind-the-scenes or "how we make it", a customer or helpful tip, an occasion.
- Do not repeat the RECENT POSTS topics.
${FACT_RULES}

${REGULATED_RULES}

Return JSON matching the schema.`;

export function buildPlanPrompt(args: {
  brand: PromptBrand;
  regulated: boolean;
  language: ContentLanguage;
  goal: 'footfall' | 'enquiries' | 'offer' | 'awareness';
  goalDetail: string; // owner's own words, '' if none
  weekDays: Array<{ date: string; weekday: string }>; // 7 days, Monday first
  occasions: PlanOccasion[];
  recentTitles: string[]; // last 2 weeks' post summaries
}): { system: string; user: string } {
  const b = args.brand;
  const products = b.products.length
    ? b.products.map((p) => `${p.name}${p.price ? ` — ₹${p.price}${p.unit ? ` ${/^per\s/i.test(p.unit) ? p.unit : `per ${p.unit}`}` : ''}` : ''}`).join('; ')
    : '(none given)';
  const occ = args.occasions.length
    ? args.occasions
        .map((o) => `- key ${o.key}: ${o.name} (${o.name_hi}) on ${o.date}${o.end_date ? ` to ${o.end_date}` : ''}. Angle: ${o.angle}${o.sensitive ? ' SENSITIVE' : ''}`)
        .join('\n')
    : '(none this week)';
  const user = [
    `OUTPUT LANGUAGE: ${LANGUAGE_NAMES[args.language]}`,
    `BRAND MEMORY (owner source)\nBusiness: ${b.business_name} (${b.category}), ${b.city}\nProducts: ${products}\nAudience: ${b.audience || '(not given)'}\nTone: ${b.tone || 'friendly'}\nOther facts: ${b.notes || '(none)'}`,
    args.regulated ? 'This business is REGULATED. Apply the regulated business rules strictly.' : '',
    `WEEK GOAL (owner source): ${args.goal}${args.goalDetail ? `. Owner's words: "${args.goalDetail}"` : ''}`,
    `WEEK DAYS:\n${args.weekDays.map((d) => `- ${d.date} (${d.weekday})`).join('\n')}`,
    `OCCASIONS:\n${occ}`,
    `RECENT POSTS (do not repeat): ${args.recentTitles.length ? args.recentTitles.join('; ') : '(none)'}`,
    'Plan the week now.',
  ].filter(Boolean).join('\n\n');
  return { system: PLAN_SYSTEM, user };
}
