import { describe, expect, it } from "vitest";
import { FaceError } from "@/lib/faces/errors";
import { faceShownFor, namesRealPerson, neverSayHit, validateFaceInput } from "@/lib/faces/rules";
import { faceCreateEstimateUsd, faceKindAllowed } from "@/lib/faces/types";

const ctx = { regulated: "none", businessName: "Corner Bakery" };
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof FaceError ? e.code : "other";
  }
  return null;
};

describe("a description may not name a real or famous person", () => {
  it.each([
    "She looks like Taylor Swift",
    "looks like taylor swift with an apron",
    "Looking like Tom Hanks, but friendlier",
    "A celebrity chef",
    "an actor in a white shirt",
    "based on Brad Pitt",
    "resembles Priya Sharma",
    "the face of Elon Musk",
    "a lookalike of my uncle",
    "a famous cricketer",
  ])("refuses %s", (text) => {
    expect(namesRealPerson(text)).not.toBeNull();
  });

  it.each([
    "A friendly baker in a green apron with short curly hair",
    "A calm woman in her thirties, warm smile, brand-coloured scarf",
    "Looks like a kind neighbour who loves bread",
    "A ram on a hill",
    "Cheerful man, tastes like Apple pie",
  ])("allows %s", (text) => {
    expect(namesRealPerson(text)).toBeNull();
  });

  it("ignores the business name", () => {
    expect(namesRealPerson("A baker for Elon Musk Cakes", ["Elon Musk Cakes"])).toBeNull();
  });
});

describe("validateFaceInput", () => {
  it("accepts a drawn character and cleans the settings", () => {
    const v = validateFaceInput(
      { kind: "illustrated", name: "  Mia ", description: "A friendly baker", style: "flat", neverSay: ["guaranteed", "Guaranteed", " "], postTypes: ["offer", "offer"], placement: { side: "left", size: "small" } },
      ctx,
    );
    expect(v).toMatchObject({ kind: "illustrated", name: "Mia", style: "flat", neverSay: ["guaranteed"], postTypes: ["offer"], placement: { side: "left", size: "small" } });
  });

  it("refuses a realistic AI person for health, finance, legal and alcohol brands", () => {
    for (const regulated of ["health", "finance", "legal", "alcohol"]) {
      expect(faceKindAllowed("photoreal", regulated)).toBe(false);
      expect(code(() => validateFaceInput({ kind: "photoreal", name: "Mia", description: "A person", style: "photo" }, { ...ctx, regulated }))).toBe("kind_not_allowed");
    }
    expect(code(() => validateFaceInput({ kind: "photoreal", name: "Mia", description: "A person", style: "photo" }, ctx))).toBeNull();
    expect(code(() => validateFaceInput({ kind: "illustrated", name: "Mia", description: "A nurse-like figure" }, { ...ctx, regulated: "health" }))).toBeNull();
  });

  it("refuses bad kinds, names, descriptions, styles and settings", () => {
    const base = { kind: "illustrated", name: "Mia", description: "A friendly baker" };
    expect(code(() => validateFaceInput({ ...base, kind: "robot" }, ctx))).toBe("bad_kind");
    expect(code(() => validateFaceInput({ ...base, name: "" }, ctx))).toBe("bad_name");
    expect(code(() => validateFaceInput({ ...base, name: "x".repeat(41) }, ctx))).toBe("bad_name");
    expect(code(() => validateFaceInput({ ...base, name: "Ganesh" }, ctx))).toBe("blocked_name");
    expect(code(() => validateFaceInput({ ...base, name: "Taylor Swift" }, ctx))).toBe("blocked_name");
    expect(code(() => validateFaceInput({ ...base, description: "" }, ctx))).toBe("bad_description");
    expect(code(() => validateFaceInput({ ...base, description: "x".repeat(601) }, ctx))).toBe("bad_description");
    expect(code(() => validateFaceInput({ ...base, description: "looks like Taylor Swift" }, ctx))).toBe("real_person");
    expect(code(() => validateFaceInput({ ...base, style: "oil_painting" }, ctx))).toBe("bad_style");
    expect(code(() => validateFaceInput({ ...base, placement: { side: "up" } }, ctx))).toBe("bad_settings");
    expect(code(() => validateFaceInput({ ...base, postTypes: ["poem"] }, ctx))).toBe("bad_settings");
    expect(code(() => validateFaceInput({ ...base, neverSay: "no" }, ctx))).toBe("bad_settings");
  });

  it("the owner's own face needs no description", () => {
    expect(code(() => validateFaceInput({ kind: "owner_photo", name: "Priya" }, ctx))).toBeNull();
  });
});

describe("where a face is shown", () => {
  it("never a realistic AI person on a testimonial", () => {
    expect(faceShownFor({ kind: "photoreal" }, "testimonial")).toBe(false);
    expect(faceShownFor({ kind: "photoreal" }, "offer")).toBe(true);
    expect(faceShownFor({ kind: "illustrated" }, "testimonial")).toBe(true);
    expect(faceShownFor({ kind: "mascot" }, "testimonial")).toBe(true);
  });
  it("only on the post types the owner chose", () => {
    expect(faceShownFor({ kind: "illustrated", postTypes: ["offer", "event"] }, "event")).toBe(true);
    expect(faceShownFor({ kind: "illustrated", postTypes: ["offer", "event"] }, "hiring")).toBe(false);
    expect(faceShownFor({ kind: "illustrated", postTypes: null }, "hiring")).toBe(true);
  });
  it("finds a phrase the face never says", () => {
    expect(neverSayHit("This is GUARANTEED to work", ["guaranteed"])).toBe("guaranteed");
    expect(neverSayHit("Come say hi!", ["guaranteed", ""])).toBeNull();
  });
  it("shows the price before an AI face is made", () => {
    expect(faceCreateEstimateUsd()).toBeGreaterThan(0.5);
  });
});
