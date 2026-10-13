/**
 * The 249 ISO 3166-1 alpha-2 country codes (setup v2, Req 2). A fixed list rather than a
 * scan of Intl, so every browser and Node version offers the same countries. Names come
 * from Intl.DisplayNames. Safe to import in the browser.
 */
export const ISO_COUNTRY_CODES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const CODE_SET = new Set(ISO_COUNTRY_CODES);

export function isIsoCountry(code: unknown): code is string {
  return typeof code === "string" && CODE_SET.has(code);
}

export interface CountryOption {
  code: string;
  name: string;
}

/** Country names in English, sorted by name. */
export function countryOptions(locale = "en"): CountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: "region", fallback: "code" });
  return ISO_COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}

/** "en-GB" -> "GB". Null when the locale has no region part. */
export function regionOfLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  try {
    const region = new Intl.Locale(locale).region;
    return region && isIsoCountry(region) ? region : null;
  } catch {
    return null;
  }
}
