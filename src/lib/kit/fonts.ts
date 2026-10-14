/**
 * Font files for the kit's font choices, for the Look section's samples. The open-licence (OFL) files
 * are in assets/fonts; this lists the ones that are there, so a role without a file is shown by name
 * only. Server-only (reads the folder); the Look section gets plain data.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { FONT_CHOICES, type FontChoice } from "@/lib/design/types";
import { isSafeFontFile, type FontFace } from "./font-css";

export { fontFaceCss, isSafeFontFile, type FontFace } from "./font-css";

/** The family file per role, as the design engine ships them (src/lib/render/shape.ts FACE_FILES). A file is `Family_400Regular.ttf`. */
const ROLE_FAMILY: Record<FontChoice, RegExp> = {
  sans: /^NotoSans_/,
  serif: /^PlayfairDisplay_/,
  rounded: /^Nunito_/,
  condensed: /^Oswald_/,
  display: /^ArchivoBlack_/,
};

export function fontsFolder(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "assets", "fonts");
}

/** The faces to load: for each role, its regular (400) and bold (700) file when they exist. A role with no files is shown by name. */
export function availableFontFaces(files?: string[]): FontFace[] {
  let list = files;
  if (!list) {
    try {
      list = readdirSync(fontsFolder());
    } catch {
      list = [];
    }
  }
  const usable = list.filter(isSafeFontFile);
  const out: FontFace[] = [];
  for (const role of FONT_CHOICES) {
    for (const file of usable.filter((f) => ROLE_FAMILY[role].test(f))) {
      const weight = /_400Regular\./.test(file) ? 400 : /_700Bold\./.test(file) ? 700 : 0;
      if (weight) out.push({ role, family: `kit-${role}`, file, weight });
    }
  }
  return out;
}
