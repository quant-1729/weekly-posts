import { describe, expect, it } from "vitest";
import { brandKitSchema } from "@/lib/design/types";
import type { StyleRead } from "@/lib/ai/schemas-v3";
import { contrast } from "@/lib/render/color";
import { fixContrast, readColors, suggestKit, suggestKitDetailed } from "@/lib/style/kit";
import { styleCopy } from "@/lib/style/copy";
import { fixtureStyleRead } from "@/lib/style/read";
import { KIT } from "./helpers";

const read = (over: Partial<StyleRead> = {}): StyleRead => ({ ...fixtureStyleRead([]), ...over });

describe("suggestKit", () => {
  it("maps a read to a valid, full kit and keeps the logo and mascot settings", () => {
    const current = { ...KIT, textLogo: false, mascot: true };
    const out = suggestKitDetailed(read(), current, "instagram");
    expect(out.clear).toBe(true);
    expect(() => brandKitSchema.parse(out.kit)).not.toThrow();
    expect(out.kit.source).toBe("instagram");
    expect(out.kit.themeId).toBe("clean");
    expect(out.kit.fonts).toEqual({ headline: "sans", body: "sans" });
    expect(out.kit.style).toEqual({ corners: "rounded", mode: "light", energy: "calm" });
    expect(out.kit.textLogo).toBe(false);
    expect(out.kit.mascot).toBe(true);
  });

  it("orders colours by share: the biggest coloured one is the primary, the biggest light one the background", () => {
    const kit = suggestKit(
      read({
        colors: [
          { hex: "#2c3e50", share: 0.1 },
          { hex: "#FFF8F0", share: 0.35 },
          { hex: "#c0392b", share: 0.45 },
          { hex: "#1e8449", share: 0.1 },
        ],
      }),
      KIT,
    );
    expect(kit.colors.background).toBe("#FFF8F0");
    expect(kit.colors.primary).toBe("#C0392B");
    // the next colours by share follow
    expect(kit.colors.secondary).toBe("#2C3E50");
    expect(kit.colors.accent).toBe("#1E8449");
  });

  it("sorts and de-duplicates the read's colours", () => {
    const colors = readColors(
      read({
        colors: [
          { hex: "#aa0000", share: 0.2 },
          { hex: "#AA0000", share: 0.1 },
          { hex: "#00aa00", share: 0.5 },
        ],
      }),
    );
    expect(colors).toEqual(["#00AA00", "#AA0000"]);
  });

  it("uses a dark colour as the background for a dark look", () => {
    const kit = suggestKit(
      read({
        mode: "dark",
        theme: "minimal_dark",
        colors: [
          { hex: "#111111", share: 0.6 },
          { hex: "#f1c40f", share: 0.4 },
        ],
      }),
      KIT,
    );
    expect(kit.colors.background).toBe("#111111");
    expect(kit.colors.primary).toBe("#F1C40F");
    expect(kit.style.mode).toBe("dark");
    expect(kit.themeId).toBe("minimal_dark");
  });

  it("fixes a primary colour that nearly disappears into the background, and says so", () => {
    const out = suggestKitDetailed(
      read({
        colors: [
          { hex: "#ffe9a8", share: 0.5 }, // pale yellow is the most used colour
          { hex: "#ffffff", share: 0.4 },
        ],
      }),
      KIT,
    );
    expect(out.clear).toBe(true);
    expect(contrast(out.kit.colors.primary, out.kit.colors.background)).toBeGreaterThanOrEqual(3);
    expect(out.notes).toContain(styleCopy.noteMainAdjusted);
  });

  it("makes every shape colour reach 3:1 on the background, for light and dark looks", () => {
    for (const mode of ["light", "dark"] as const) {
      const out = suggestKit(
        read({
          mode,
          colors: [
            { hex: mode === "light" ? "#f4f4f4" : "#0b0b0b", share: 0.5 },
            { hex: "#e8e8e8", share: 0.3 },
            { hex: "#d0d0d0", share: 0.2 },
          ],
        }),
        KIT,
      );
      expect(contrast(out.colors.primary, out.colors.background)).toBeGreaterThanOrEqual(3);
      expect(contrast(out.colors.accent, out.colors.background)).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns the current kit unchanged, with the 'pick a theme' message, when confidence is below 0.4", () => {
    const out = suggestKitDetailed(read({ confidence: 0.39 }), KIT, "instagram");
    expect(out.clear).toBe(false);
    expect(out.message).toBe("We couldn't find one clear look; pick a theme instead.");
    expect(out.kit).toBe(KIT);
    // 0.4 is enough
    expect(suggestKitDetailed(read({ confidence: 0.4 }), KIT).clear).toBe(true);
  });

  it("also keeps the current kit when the read has no usable colours", () => {
    const out = suggestKitDetailed(read({ colors: [] }), KIT);
    expect(out.clear).toBe(false);
    expect(out.kit).toBe(KIT);
  });

  it("derives secondary and accent when the read has only one colour", () => {
    const kit = suggestKit(read({ colors: [{ hex: "#c0392b", share: 1 }] }), KIT);
    expect(kit.colors.primary).toBe("#C0392B");
    for (const c of Object.values(kit.colors)) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set(Object.values(kit.colors)).size).toBeGreaterThanOrEqual(3);
  });
});

describe("fixContrast", () => {
  it("leaves a colour that already stands out", () => {
    expect(fixContrast("#000000", "#FFFFFF")).toMatchObject({ changed: false, ok: true });
  });
  it("darkens on a light background and lightens on a dark one", () => {
    const a = fixContrast("#ffee99", "#ffffff");
    expect(a.changed).toBe(true);
    expect(contrast(a.hex, "#ffffff")).toBeGreaterThanOrEqual(3);
    const b = fixContrast("#101820", "#0b0b0b");
    expect(b.changed).toBe(true);
    expect(contrast(b.hex, "#0b0b0b")).toBeGreaterThanOrEqual(3);
  });
});
