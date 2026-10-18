// Brand Face description suggestions, the franchise check, and the Describe step's tip and chips.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/brand/face-actions", () => ({ createFaceAction: vi.fn() }));

import { FaceDescribe } from "@/components/brand/face-describe";
import { copiesKnownCharacter, namesRealPerson, unsuitableDescription, validateFaceInput } from "@/lib/faces/rules";
import { colorPhrase, hexColorName, suggestFaceDescriptions, suggestionIsSafe, type SuggestBrand } from "@/lib/faces/suggest";
import { s } from "@/lib/i18n/strings";

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const CATEGORIES: { label: string; category: string; products?: string[]; regulated?: string }[] = [
  { label: "bakery", category: "Bakery", products: ["Fresh bread", "Cakes"] },
  { label: "cafe", category: "Cafe and coffee shop" },
  { label: "restaurant", category: "Family restaurant", products: ["Veg thali"] },
  { label: "clinic", category: "Dental clinic", regulated: "health" },
  { label: "pharmacy", category: "Pharmacy", regulated: "health" },
  { label: "wellness", category: "Wellness centre", regulated: "health" },
  { label: "salon", category: "Beauty salon" },
  { label: "tailor", category: "Tailor and boutique" },
  { label: "coaching", category: "Maths coaching classes" },
  { label: "shop", category: "Gift shop" },
  { label: "repair", category: "Mobile repair service" },
  { label: "fitness", category: "Yoga and fitness studio" },
  { label: "travel", category: "Travel agency" },
  { label: "finance", category: "Tax and accounting", regulated: "finance" },
  { label: "legal", category: "Law firm", regulated: "legal" },
  { label: "alcohol", category: "Craft brewery", regulated: "alcohol" },
  { label: "default", category: "Something unusual" },
  { label: "empty", category: "" },
];

const brandOf = (c: { category: string; products?: string[]; regulated?: string }, extra: Partial<SuggestBrand> = {}): SuggestBrand => ({
  businessName: "Patel Family Co",
  category: c.category,
  products: c.products ?? [],
  city: "Pune",
  country: "IN",
  colors: ["#0E8C8C", "#FF6F61", "#F5EBDD"],
  voice: "warm and friendly",
  regulated: c.regulated ?? "none",
  ...extra,
});

const NO_CREDENTIALS = /\b(?:doctor|nurse|lawyer|banker|surgeon|dentist|pharmacist|teacher|uniform|scrubs|stethoscope|lab coat)\b/i;
const NO_TEXT = /\b(?:text|letters?|logo|words?|writing|sign|slogan)\b/i;

describe("suggestFaceDescriptions", () => {
  it.each(CATEGORIES)("gives 3 safe drawn-character ideas for $label", (c) => {
    const out = suggestFaceDescriptions(brandOf(c), "illustrated");
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    for (const d of out) {
      expect(namesRealPerson(d, ["Patel Family Co"])).toBeNull();
      expect(namesRealPerson(d)).toBeNull();
      expect(unsuitableDescription(d)).toBeNull();
      expect(copiesKnownCharacter(d)).toBeNull();
      expect(d).not.toMatch(NO_CREDENTIALS);
      expect(d).not.toMatch(NO_TEXT);
      expect([...d].length).toBeLessThanOrEqual(300);
      expect(suggestionIsSafe(d)).toBe(true);
      // The save-time check accepts it as a real description.
      expect(() => validateFaceInput({ kind: "illustrated", name: "Mia", description: d, style: "flat" }, { regulated: c.regulated ?? "none", businessName: "Patel Family Co" })).not.toThrow();
    }
  });

  it.each(CATEGORIES)("gives 2 adult person ideas for $label, or none where a realistic person is not allowed", (c) => {
    const out = suggestFaceDescriptions(brandOf(c), "photoreal");
    if (["health", "finance", "legal", "alcohol"].includes(c.regulated ?? "none")) {
      expect(out).toEqual([]);
      return;
    }
    expect(out).toHaveLength(2);
    for (const d of out) {
      expect(suggestionIsSafe(d)).toBe(true);
      expect(d).toMatch(/adult/);
      expect(d).not.toMatch(NO_CREDENTIALS);
      expect(() => validateFaceInput({ kind: "photoreal", name: "Mia", description: d, style: "photo" }, { regulated: "none", businessName: "Patel Family Co" })).not.toThrow();
    }
  });

  it("is personalised: the idea follows the business type, the colour names and the voice", () => {
    const bakery = suggestFaceDescriptions(brandOf(CATEGORIES[0]), "illustrated");
    expect(bakery[0]).toBe("A friendly round cartoon bread loaf with a small chef's hat, big friendly eyes, simple flat shapes, in teal and coral");
    const clinic = suggestFaceDescriptions(brandOf(CATEGORIES[3], { colors: ["#2A9D9D", "#FFFFFF"], voice: "" }), "illustrated");
    expect(clinic[0]).toBe("A calm, friendly round cartoon leaf character with a gentle smile, simple flat shapes, in soft teal and white");
    expect(clinic.join(" ")).not.toMatch(/chef|bread/);
    const salon = suggestFaceDescriptions(brandOf(CATEGORIES[6]), "illustrated");
    expect(salon[0]).toMatch(/flower/);
    expect(suggestFaceDescriptions(brandOf(CATEGORIES[0], { voice: "playful and fun" }), "illustrated")[0]).toMatch(/^A playful /);
    const person = suggestFaceDescriptions(brandOf(CATEGORIES[6]), "photoreal");
    expect(person[0]).toBe("A friendly adult woman in her thirties, warm smile, simple casual clothes in teal and coral, holding nothing");
    // The business name and city are never put into a description (a name could be a famous one).
    for (const d of [...bakery, ...salon, ...person]) expect(d).not.toMatch(/Patel|Pune/);
  });

  it("uses what the business sells when it is a plain word, and drops one that would fail a rule", () => {
    const thali = suggestFaceDescriptions(brandOf(CATEGORIES[2]), "illustrated");
    expect(thali.some((d) => d.includes("veg thali"))).toBe(true);
    const bad = suggestFaceDescriptions(brandOf({ category: "Cafe", products: ["Disney cake"] }), "illustrated");
    expect(bad).toHaveLength(3);
    expect(bad.join(" ")).not.toMatch(/disney/i);
    const sexy = suggestFaceDescriptions(brandOf({ category: "Cafe", products: ["sexy cake"] }), "illustrated");
    expect(sexy).toHaveLength(3);
    expect(sexy.join(" ")).not.toMatch(/sexy/);
  });

  it("falls back to soft colours when the brand has none, and is deterministic", () => {
    const b = brandOf(CATEGORIES[0], { colors: [] });
    const out = suggestFaceDescriptions(b, "illustrated");
    expect(out.every((d) => /soft/.test(d))).toBe(true);
    expect(suggestFaceDescriptions(b, "illustrated")).toEqual(out);
  });
});

describe("colour names", () => {
  it("names hex colours in plain English", () => {
    expect(hexColorName("#0E8C8C")).toBe("teal");
    expect(hexColorName("#FF6F61")).toBe("coral");
    expect(hexColorName("#FFFFFF")).toBe("white");
    expect(hexColorName("#000000")).toBe("black");
    expect(hexColorName("#1B2A6B")).toBe("navy");
    expect(hexColorName("nope")).toBeNull();
    expect(colorPhrase(["#0E8C8C", "#0E8C8C", "#FF6F61"])).toBe("teal and coral");
    expect(colorPhrase([])).toBe("");
  });
});

describe("copiesKnownCharacter", () => {
  it("catches famous characters, studios, franchises and 'in the style of <Name>'", () => {
    for (const d of [
      "A cartoon character inspired by the animation style of Dora the Explorer, carries a bag",
      "inspired from animation style of Dora the explorer",
      "like Mickey Mouse but green",
      "a pikachu holding a cake",
      "Pokémon style creature",
      "a Disney princess",
      "in the style of Pixar",
      "a Chhota Bheem lookalike",
      "motu patlu type duo",
      "Hello Kitty with a bag",
      "a minion in a chef hat",
      "Shinchan with a bag",
      "inspired by Studio Ghibli",
      "in the style of Peppa Pig",
      "Naruto running",
      "like Spider-Man",
      "Elsa from Frozen",
      "a character from the cartoon Oggy",
      "in the style of Zorbo The Great",
    ]) {
      expect(copiesKnownCharacter(d), d).not.toBeNull();
    }
  });

  it("allows ordinary descriptions", () => {
    for (const d of [
      "an explorer with a bag",
      "A friendly adult woman in her thirties, warm smile, simple casual clothes in teal and coral, holding nothing",
      "a cheerful cartoon bread loaf with a chef's hat",
      "inspired by Indian art, flat shapes",
      "frozen yogurt cup with a smile",
      "a cartoon character with a bag",
      "a baker with a rolling pin",
    ]) {
      expect(copiesKnownCharacter(d), d).toBeNull();
    }
  });

  it("is refused on save with the 'copied_character' code and the owner-facing words", () => {
    const ctx = { regulated: "none", businessName: "Patel Bakery" };
    expect(() => validateFaceInput({ kind: "illustrated", name: "Mia", description: "A cartoon character inspired by the animation style of Dora the Explorer, carries a bag" }, ctx)).toThrowError(/copied_character/);
    expect(s.faces.errors.copied_character).toBe("Please describe your own character instead of a cartoon, film or game character — image tools refuse to copy them. Try one of the suggestions below.");
  });
});

describe("the Describe step", () => {
  const render = (kind: "illustrated" | "photoreal" | "owner_photo", suggestions: string[]) => renderToString(createElement(FaceDescribe, { kind, suggestions, onDone: () => undefined }));

  it("shows the tip and the suggestions as buttons that fill the field", () => {
    const sug = suggestFaceDescriptions(brandOf(CATEGORIES[0]), "illustrated");
    const html = render("illustrated", sug);
    const t = text(html);
    expect(t).toContain("Tip: describe your own character. Works best: simple shapes, a friendly face, your colours.");
    expect(t).toContain("Not allowed: real or famous people, cartoon or film characters, words about looks or body, ages under 21, uniforms.");
    expect(t).toContain("Try one of these:");
    expect(html.match(/data-face-suggestion(?!s)/g)).toHaveLength(3);
    for (const d of sug) expect(t).toContain(d);
  });

  it("shows no 'Try one of these' when there are no suggestions, and nothing for the owner's own photos", () => {
    expect(text(render("illustrated", []))).not.toContain("Try one of these:");
    expect(text(render("owner_photo", ["x"]))).not.toContain("Tip: describe your own character");
  });
});
