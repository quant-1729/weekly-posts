// Facts-only guardrail, AI layer (R8, T-12). Owned by the orchestrator.
// Lists every checkable fact in the generated outputs and says whether the owner
// sources support it. Code merges this with the deterministic checks (checks.ts);
// a fact is flagged if EITHER layer flags it. See docs/guardrail.md.

import type { Channel, ChannelOutput } from '../schemas';

export const FACT_CHECK_PROMPT_VERSION = 'fact-check-v1';

export const FACT_CHECK_SYSTEM = `You are a strict fact checker for social media posts written for small Indian businesses. The business owner is responsible for every claim in the post, so anything not backed by the owner must be caught.

SOURCES are the only truth: the owner's input, the brand memory, the week goal, and facts the owner has already confirmed. Nothing else counts: not general knowledge, not the photo, not what is "usually" true.

TASK
Go through every output field (caption, cta, image_text.headline, image_text.subline, image_text.bubble) and list every CHECKABLE statement of these kinds:
- price: any amount of money, including number words ("दो सौ", "do sau", "two hundred").
- discount: percent or amount off, sale, cashback.
- offer: free items, buy-one-get-one, free delivery, free consultation, combos, gifts.
- date: dates, days, deadlines, "till Sunday", "this week only", festival dates.
- time: opening hours, times, "open late", "24x7".
- phone: phone numbers, any contact number.
- quantity: weights, sizes, counts, durations, distances, stock limits ("10 kg", "30 minutes", "3 km", "only 20 left").
- claim: quality or ingredient claims (pure ghee, 100% pure, organic, handmade, pure silk, original parts), superlatives and rankings (best, No. 1, cheapest, most trusted), years or customers served, awards, comparisons, guarantees, warranties, and any health, medical, financial or educational outcome (cure, painless, results, ranks, returns, savings).

Do NOT list: greetings, festival wishes, friendly words with no checkable content ("tasty", "fresh", "come visit", "beautiful designs"), the business name, the city, or product names on their own.

For each statement:
- text: copy the SHORTEST exact span from the output field that contains the fact, character for character, so the app can highlight it.
- supported: true only if the SOURCES state the same fact with the same meaning and the same numbers. Digits and number words are equal ("240" = "दो सौ चालीस"); the same fact in another language is equal ("Sunday" = "रविवार"). A changed number, a stronger version ("free delivery" when the source says "free delivery above Rs 300"), or a fact that is only implied is NOT supported.
- source_quote: the matching words from the sources, or "" if unsupported.
- regulated_claim: true if it is a health, medical, financial or educational outcome, safety or guarantee claim (even if supported). These get an extra warning.

List each distinct fact once per field where it appears. If there are no checkable statements, return an empty list.
Return JSON matching the schema.`;

export interface FactCheckSources {
  ownerInput: string;
  brandMemory: string; // the same brand block the generate prompt used
  weekGoal: string; // '' if none
  confirmedFacts: string[]; // flags the owner already confirmed on this post
}

export function buildFactCheckPrompt(args: {
  sources: FactCheckSources;
  outputs: Partial<Record<Channel, ChannelOutput>>;
}): { system: string; user: string } {
  const s = args.sources;
  const sources = [
    `OWNER INPUT:\n"""\n${s.ownerInput || '(none)'}\n"""`,
    `BRAND MEMORY:\n${s.brandMemory}`,
    `WEEK GOAL: ${s.weekGoal || '(none)'}`,
    `FACTS THE OWNER CONFIRMED: ${s.confirmedFacts.length ? s.confirmedFacts.map((f) => `"${f}"`).join('; ') : '(none)'}`,
  ].join('\n\n');
  const outputs = Object.entries(args.outputs)
    .map(([channel, o]) =>
      `[${channel}]\n` +
      JSON.stringify(
        {
          caption: o.caption,
          cta: o.cta,
          'image_text.headline': o.image_text.headline,
          'image_text.subline': o.image_text.subline,
          'image_text.bubble': o.image_text.bubble,
        },
        null,
        1,
      ),
    )
    .join('\n\n');
  return { system: FACT_CHECK_SYSTEM, user: `SOURCES\n${sources}\n\nOUTPUTS TO CHECK\n${outputs}\n\nList the checkable facts now.` };
}
