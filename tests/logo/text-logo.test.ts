import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { BrandKit } from "@/lib/design/types";
import { textLogo, textLogoSvg } from "@/lib/logo";
import { initShaping, shapeText } from "@/lib/render/shape";

const kit: BrandKit = {
  colors: { primary: "#1F4E9C", secondary: "#EAF1FB", accent: "#F59E0B", background: "#FFFFFF" },
  fonts: { headline: "sans", body: "sans" },
  style: { corners: "rounded", mode: "light", energy: "calm" },
  themeId: "clean",
  textLogo: true,
  mascot: false,
  source: "default",
};

/** Baselines of the glyph outlines: one distinct y per line of text. */
function lineCount(svg: string): number {
  const ys = new Set<string>();
  for (const m of svg.matchAll(/<path transform="translate\(([-\d.]+) ([-\d.]+)\)/g)) ys.add(m[2]);
  return ys.size;
}

/** Share of the PNG that is ink, and whether the corner is transparent. */
async function inkOf(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let ink = 0;
  for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] > 200) ink++;
  return { ink, cornerAlpha: data[3], width: info.width, height: info.height };
}

describe("text logo", () => {
  it("draws a Latin name on one line as outlines, with no text element, in the primary colour", async () => {
    const svg = (await textLogoSvg("Corner Bakery", kit))!;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("Corner"); // outlines only: the name is never written into the file
    expect(svg.toLowerCase()).toContain('fill="#1f4e9c"');
    expect(lineCount(svg)).toBe(1);
  });

  it("puts a long name on two lines", async () => {
    const svg = (await textLogoSvg("Sunrise Heritage Handloom Emporium and Sons", kit))!;
    expect(lineCount(svg)).toBe(2);
  });

  it("draws a Devanagari name", async () => {
    await initShaping();
    expect(shapeText("श्री राम स्वीट्स", 800, "ltr").missing).toBe(0);
    const logo = (await textLogo("श्री राम स्वीट्स", kit))!;
    expect(logo.svg).toContain("<path");
    const { ink } = await inkOf(logo.png);
    expect(ink).toBeGreaterThan(500);
  });

  it("draws an Arabic name right to left, wrapping a long one", async () => {
    await initShaping();
    expect(shapeText("مخبز الأمل للحلويات", 800, "rtl").missing).toBe(0);
    const short = (await textLogo("مخبز الأمل", kit))!;
    expect((await inkOf(short.png)).ink).toBeGreaterThan(500);
    const long = (await textLogoSvg("مخبز ومعجنات الأمل للحلويات الشرقية والغربية الفاخرة", kit))!;
    expect(long).toContain("<path");
    expect(lineCount(long)).toBeGreaterThanOrEqual(2);
  });

  it("uses the headline font of the kit", async () => {
    const sans = await textLogoSvg("Corner Bakery", kit);
    const serif = await textLogoSvg("Corner Bakery", { ...kit, fonts: { headline: "serif", body: "sans" } });
    expect(serif).not.toBe(sans);
  });

  it("makes a transparent PNG", async () => {
    const logo = (await textLogo("Corner Bakery", kit))!;
    const { cornerAlpha, ink, width, height } = await inkOf(logo.png);
    expect(cornerAlpha).toBe(0);
    expect(ink).toBeGreaterThan(1000);
    expect(width).toBeGreaterThan(height);
  });

  it("gives nothing for an empty name", async () => {
    expect(await textLogoSvg("   ", kit)).toBeNull();
    expect(await textLogo("", kit)).toBeNull();
  });
});
