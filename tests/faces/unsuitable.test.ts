import { describe, expect, it } from "vitest";
import { unsuitableDescription } from "@/lib/faces/rules";
import { s } from "@/lib/i18n/strings";

describe("brand face descriptions: no sexual wording, no young ages", () => {
  it("refuses sexual or attractiveness wording and young ages", () => {
    expect(unsuitableDescription("A indian 18 year old hot girl")).not.toBeNull();
    expect(unsuitableDescription("a sexy chef")).toBe("sexy");
    expect(unsuitableDescription("a hot guy with a beard")).toBe("hot guy");
    expect(unsuitableDescription("a teenage boy in a cap")).toBe("teenage");
    expect(unsuitableDescription("a 19-year-old student")).not.toBeNull();
    expect(unsuitableDescription("aged 16, smiling")).not.toBeNull();
    expect(unsuitableDescription("a woman in a bikini")).toBe("bikini");
  });

  it("allows ordinary descriptions, adult ages and harmless uses of words", () => {
    expect(unsuitableDescription("a friendly woman in her twenties, smiling, in a teal kurta")).toBeNull();
    expect(unsuitableDescription("a 35 year old baker holding a whisk")).toBeNull();
    expect(unsuitableDescription("a cheerful cartoon chai cup, steam rising from the hot tea")).toBeNull();
    expect(unsuitableDescription("an elderly tailor with round glasses")).toBeNull();
  });

  it("has owner-facing words for both new refusals", () => {
    expect(s.faces.errors.unsuitable_description).toContain("a friendly woman in her twenties");
    expect(s.faces.generate.errors.image_blocked).toContain("safety check declined");
  });
});
