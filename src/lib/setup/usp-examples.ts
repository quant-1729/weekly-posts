/**
 * Tappable examples for "What do customers like about you?" (setup, PRD v3 D-3).
 *
 * They are only suggestions of wording: generic, with no numbers, prices, ratings, awards or superlatives
 * ("best in town"), so tapping one never puts a claim the owner has not made into their mouth. The owner
 * edits or replaces them; whatever stays in the box is the owner's own line. Safe to import in the browser.
 */

export type ExampleGroup = "food" | "beauty" | "trades" | "shop" | "general";

const GENERAL = ["Friendly service", "Helpful, honest advice", "Easy to get in touch", "Careful, tidy work"] as const;

const EXAMPLES: Record<ExampleGroup, readonly string[]> = {
  food: ["Made fresh every day", "Friendly service", "Simple, tasty food", "Made with care"],
  beauty: ["Relaxed, friendly space", "Careful, personal service", "Clean and tidy", "Appointments to suit you"],
  trades: ["Clear, honest advice", "Careful, tidy work", "Quick to reply", "Friendly service"],
  shop: ["Friendly service", "Helpful advice", "Carefully chosen products", "Easy to find"],
  general: GENERAL,
};

const GROUP_WORDS: Array<[ExampleGroup, RegExp]> = [
  [
    "food",
    /\b(bread|bakery|baker|cake|cakes|coffee|cafe|caf[eé]|restaurant|food|kitchen|catering|sweets?|snacks?|pizza|burger|tea|juice|ice ?cream|dessert|meals?|takeaway|takeout|pastr(?:y|ies)|chocolate|grocer(?:y|ies))\b/i,
  ],
  ["beauty", /\b(salon|hair|barber|beauty|spa|nails?|massage|makeup|facial|skin|wellness|yoga|fitness|gym|tattoo)\b/i],
  [
    "trades",
    /\b(repair|repairs|plumb\w*|electric\w*|clean\w*|account\w*|tutor\w*|lessons?|coaching|consult\w*|legal|lawyer|design\w*|photograph\w*|builder|building|paint\w*|garden\w*|landscap\w*|mechanic|taxi|transport|moving|service|services)\b/i,
  ],
  ["shop", /\b(shop|store|boutique|clothes|clothing|fashion|jewel\w*|gift|gifts|toys?|books?|furniture|flowers?|florist|pharmacy|hardware|electronics|phones?)\b/i],
];

/** Which set of examples fits what the owner sells. */
export function exampleGroupFor(sell: string): ExampleGroup {
  for (const [group, re] of GROUP_WORDS) if (re.test(sell)) return group;
  return "general";
}

/** Three or four short example lines for what the owner sells. */
export function uspExamplesFor(sell: string): string[] {
  return [...EXAMPLES[exampleGroupFor(sell)]];
}

/** Every example in every group (used by the tests to check the rules). */
export function allUspExamples(): string[] {
  return [...new Set(Object.values(EXAMPLES).flat())];
}
