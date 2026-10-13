// Switch-language prompt: one channel output -> the same output in another
// language/script (R5). Owned by the orchestrator (T-4).

import type { Channel, ChannelOutput, ContentLanguage } from '../schemas';
import {
  CHANNEL_SPECS,
  CTA_RULES,
  IMAGE_TEXT_RULES,
  LANGUAGE_NAMES,
  LANGUAGE_RULES,
} from './shared';

export const SWITCH_LANGUAGE_PROMPT_VERSION = 'switch-language-v2';

export const SWITCH_LANGUAGE_SYSTEM = `You rewrite a finished social media post for a small Indian business into another language or script. Rewrite it the way a local writer would say it in that language; do not translate word by word.

STRICT
- Keep exactly the same facts: every price, discount, offer, date, time, quantity and claim stays, with the same numbers. Add nothing new, drop nothing.
- Keep brand and product names as they are.
- No phone numbers, websites or links.
- Keep the same channel format and length limit.
- Adapt hashtags to the new language (hashtags in English letters).
- If a bubble or other image_text field is "", keep it "".

${CTA_RULES}

${IMAGE_TEXT_RULES}

Return JSON matching the schema.`;

export function buildSwitchLanguagePrompt(args: {
  channel: Channel;
  from: ContentLanguage;
  to: ContentLanguage;
  output: ChannelOutput;
}): { system: string; user: string } {
  const spec = CHANNEL_SPECS[args.channel];
  const tags = spec.hashtags[1] === 0 ? 'no hashtags' : `${spec.hashtags[0]}-${spec.hashtags[1]} hashtags`;
  const user = [
    `TARGET LANGUAGE: ${LANGUAGE_NAMES[args.to]}\n${LANGUAGE_RULES[args.to]}`,
    `CHANNEL: ${spec.label}. Caption max ${spec.captionMaxChars} characters, ${tags}.`,
    `CURRENT POST (${LANGUAGE_NAMES[args.from]}):\n${JSON.stringify(args.output, null, 2)}`,
    'Rewrite it now.',
  ].join('\n\n');
  return { system: SWITCH_LANGUAGE_SYSTEM, user };
}
