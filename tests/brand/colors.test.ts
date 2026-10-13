import { describe, expect, it } from "vitest";
import { PRESET_PALETTES, isHexColor, paletteFromPrimary, samePalette } from "@/lib/brand/colors";
import { parseProfile, TONE_OPTIONS } from "@/lib/brand/schema";
import { s } from "@/lib/i18n/strings";
import { validProfile } from "./helpers";

describe("colour palettes", () => {
  it("has six presets with valid hex colours and a display name each", () => {
    expect(PRESET_PALETTES).toHaveLength(6);
    for (const p of PRESET_PALETTES) {
      expect(isHexColor(p.primary) && isHexColor(p.secondary) && isHexColor(p.accent)).toBe(true);
      expect(s.brand.palettes).toHaveProperty(p.id);
    }
    expect(new Set(PRESET_PALETTES.map((p) => p.primary)).size).toBe(6);
  });

  it("every preset is accepted by the profile schema", () => {
    for (const p of PRESET_PALETTES) {
      const res = parseProfile(validProfile({ colors: { primary: p.primary, secondary: p.secondary, accent: p.accent } }));
      expect(res.ok).toBe(true);
    }
  });

  it("builds a full palette from one custom primary colour", () => {
    const p = paletteFromPrimary("#7b2d8e");
    expect(p.primary).toBe("#7B2D8E");
    expect(isHexColor(p.secondary) && isHexColor(p.accent)).toBe(true);
    expect(p.secondary).not.toBe(p.primary);
    expect(p.accent).not.toBe(p.primary);
    // The secondary is a light tint, so text in the primary colour reads on it.
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(p.secondary)).toBeGreaterThan(lum(p.primary));
    expect(parseProfile(validProfile({ colors: p })).ok).toBe(true);
  });

  it("compares palettes ignoring case", () => {
    expect(samePalette({ primary: "#aaaaaa", secondary: "#bbbbbb", accent: "#cccccc" }, { primary: "#AAAAAA", secondary: "#BBBBBB", accent: "#CCCCCC" })).toBe(true);
    expect(samePalette(undefined, PRESET_PALETTES[0])).toBe(false);
  });
});

describe("tone choices", () => {
  it("offers the four tones", () => {
    expect([...TONE_OPTIONS]).toEqual(["Friendly", "Festive and lively", "Premium", "Simple and respectful"]);
  });
});
