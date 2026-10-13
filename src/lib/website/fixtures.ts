import type { WebsiteFacts } from "@/lib/ai/schemas-v2";

/**
 * Sample extraction for the dev flow without AI (AI_MODE=fixture, no credentials, and all
 * tests): the 22 facts of test-data/v2/websites/corner-bakery/expected-facts.json. Each fact
 * is attached to the fetched page whose path ends with the expected page name, and its quote
 * is the fact's own text, so the quote check passes only where the page really has it.
 * Live mode ignores this.
 */
const CORNER_BAKERY: Array<[WebsiteFacts["facts"][number]["kind"], string, string, string]> = [
  ["product", "Sourdough loaf", "Sourdough loaf", "menu"],
  ["price", "Sourdough loaf", "£4.50", "menu"],
  ["product", "Rye and seed loaf", "Rye and seed loaf", "menu"],
  ["price", "Rye and seed loaf", "£4.80", "menu"],
  ["product", "Butter croissant", "Butter croissant", "menu"],
  ["price", "Butter croissant", "£2.40", "menu"],
  ["product", "Pain au chocolat", "Pain au chocolat", "menu"],
  ["price", "Pain au chocolat", "£2.60", "menu"],
  ["product", "Cinnamon bun", "Cinnamon bun", "menu"],
  ["price", "Cinnamon bun", "£3.20", "menu"],
  ["product", "Lemon drizzle cake slice", "Lemon drizzle cake slice", "menu"],
  ["price", "Lemon drizzle cake slice", "£3.60", "menu"],
  ["offer", "Friday discount", "10% off for orders over £30 on Fridays", "index"],
  ["hours", "Monday to Friday", "7am to 6pm", "contact"],
  ["hours", "Saturday", "8am to 5pm", "contact"],
  ["hours", "Sunday", "8:30am to 1pm", "contact"],
  ["hours", "Public holidays", "We are closed on Christmas Day and Boxing Day", "contact"],
  ["address", "Shop address", "27 Lansdowne Parade, London SE5 8QJ", "contact"],
  ["phone", "Phone", "+44 20 7946 0183", "contact"],
  ["email", "Email", "hello@cornerbakery.example", "contact"],
  ["differentiator", "Baked on site", "Baked on site every morning since 2009", "index"],
  ["differentiator", "Proving time", "Every sourdough is proved for 24 hours", "index"],
];

export function websiteFactsFixture(pageUrls: string[]): WebsiteFacts {
  const home = pageUrls[0] ?? "";
  const find = (name: string): string => {
    for (const u of pageUrls) {
      const path = new URL(u).pathname.replace(/\/+$/, "");
      if (name === "index" ? path === "" || path.endsWith("/index.html") : path === `/${name}` || path.endsWith(`/${name}.html`)) return u;
    }
    return name === "index" ? home : `${home ? new URL(home).origin : ""}/${name}`;
  };
  return {
    business_summary: "Corner Bakery is a neighbourhood bakery on Lansdowne Parade in Camberwell, London.",
    facts: CORNER_BAKERY.map(([kind, label, value, page]) => ({
      kind,
      label,
      value,
      quote: value,
      page_url: find(page),
      outcome_promise: false,
    })),
  };
}
