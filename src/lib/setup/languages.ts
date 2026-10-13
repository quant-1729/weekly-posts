/**
 * Post languages offered in setup (Req 2), as BCP-47 tags. Labels come from
 * Intl.DisplayNames. Safe to import in the browser.
 */

/** Same pattern as the brand_memory.post_language check in the database. */
export const BCP47_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** English variants with their own spelling and wording. The key is the business's country. */
export const ENGLISH_BY_COUNTRY: Readonly<Record<string, string>> = {
  GB: "en-GB",
  US: "en-US",
  AU: "en-AU",
  CA: "en-CA",
  IN: "en-IN",
  SG: "en-SG",
  ZA: "en-ZA",
  NZ: "en-NZ",
  IE: "en-IE",
};

const OTHER_LANGUAGES = [
  "hi", "ar", "es", "fr", "de", "pt", "it", "nl", "id", "ms", "tl", "zh-Hans", "ja", "ko", "ta", "bn", "mr", "te", "ur",
] as const;

export const POST_LANGUAGE_CODES: readonly string[] = [
  "en",
  ...Object.values(ENGLISH_BY_COUNTRY),
  ...OTHER_LANGUAGES,
];

/** English with the country's variant when it is a common one, else plain `en`. */
export function defaultPostLanguage(country: string | null | undefined): string {
  return (country && ENGLISH_BY_COUNTRY[country]) || "en";
}

export interface LanguageOption {
  code: string;
  label: string;
}

export function languageOptions(locale = "en"): LanguageOption[] {
  const names = new Intl.DisplayNames([locale], { type: "language", languageDisplay: "standard", fallback: "code" });
  return POST_LANGUAGE_CODES.map((code) => ({ code, label: names.of(code) ?? code }));
}
