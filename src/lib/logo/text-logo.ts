/**
 * A text logo: the business name set in the kit's headline font and brand colours, on a transparent
 * background (C-19). Used when the brand has no logo image and `kit.textLogo` is on.
 *
 * The drawing itself is the design engine's (src/lib/design/text-logo.ts): HarfBuzz-shaped glyph
 * outlines in the headline font, one or two lines, ink chosen from the kit colours so it reads. This
 * wrapper adds what the Brand page and the logo flow need: a blank name gives nothing, and the text
 * direction comes from the name (Arabic is set right to left).
 */
import { detectDirection } from "@/lib/render";
import { textLogoPng, textLogoSvg as drawSvg, type TextLogoOptions } from "@/lib/design/text-logo";
import type { BrandKit } from "@/lib/design/types";

export type { TextLogoOptions };

const clean = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 80);

/** The text logo as SVG (glyph outlines only, no text element), or null for an empty name. */
export async function textLogoSvg(name: string, kit: BrandKit, opts: TextLogoOptions = {}): Promise<string | null> {
  const text = clean(name);
  if (!text) return null;
  return drawSvg(text, kit, { dir: detectDirection(text), ...opts });
}

export interface TextLogo {
  svg: string;
  /** Transparent PNG. */
  png: Buffer;
}

/** The text logo as SVG and a transparent PNG, or null for an empty name. */
export async function textLogo(name: string, kit: BrandKit, opts: TextLogoOptions = {}): Promise<TextLogo | null> {
  const text = clean(name);
  if (!text) return null;
  const o = { dir: detectDirection(text), ...opts };
  return { svg: await drawSvg(text, kit, o), png: await textLogoPng(text, kit, o) };
}
