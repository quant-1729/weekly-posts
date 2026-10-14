/** Font-face data and CSS: pure, so the Look section (a client component) can use it. */
import type { FontChoice } from "@/lib/design/types";

const SAFE_FILE = /^[A-Za-z0-9_-]+\.(ttf|otf|woff2?)$/;
export const isSafeFontFile = (name: string) => SAFE_FILE.test(name);

export interface FontFace {
  role: FontChoice;
  /** CSS family name used by the sample text: `kit-{role}`. */
  family: string;
  /** File name served by /api/fonts/{file}. */
  file: string;
  /** Weight the face is declared with (a role shows its bold file when there is one). */
  weight: number;
}

/** The @font-face rules for the faces found. */
export function fontFaceCss(faces: FontFace[]): string {
  return faces
    .map((f) => `@font-face{font-family:"${f.family}";src:url("/api/fonts/${f.file}");font-weight:${f.weight};font-display:swap;}`)
    .join("\n");
}
