/**
 * Time zone helpers for setup (Req 2, 7). Safe to import in the browser.
 */

/** Old names some browsers still report, mapped to the name we store and list. */
const ALIASES: Readonly<Record<string, string>> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
};

export function normalizeTimezone(tz: string): string {
  return ALIASES[tz] ?? tz;
}

const TZ_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/** True for an IANA zone the runtime knows (Intl.DateTimeFormat accepts it). UTC offsets like "+01:00" are not zones. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !TZ_SHAPE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The browser's own time zone, or "" if it cannot tell. */
export function browserTimezone(): string {
  try {
    return normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
  } catch {
    return "";
  }
}

/** Every zone the runtime lists; a short fallback list where Intl.supportedValuesOf is missing. */
export function allTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let list: string[] = [];
  try {
    list = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone").map(normalizeTimezone) : [];
  } catch {
    list = [];
  }
  const unique = new Set(list);
  unique.add("UTC");
  return [...unique].sort();
}

/** "Europe/London" -> "London". "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
export function timezoneCity(tz: string): string {
  const last = tz.split("/").pop() ?? tz;
  return last.replace(/_/g, " ");
}

/** Plain words for a zone: "London time (British Summer Time)". Falls back to the city alone. */
export function describeTimezone(tz: string, now: Date = new Date()): string {
  const city = `${timezoneCity(tz)} time`;
  try {
    const part = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "long" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;
    return part && part !== city ? `${city} (${part})` : city;
  } catch {
    return city;
  }
}

/**
 * The country a zone belongs to, when exactly one country lists it. Null when the zone
 * is unknown or shared (then the locale decides).
 */
export function countryOfTimezone(tz: string, zonesByCountry: Readonly<Record<string, readonly string[]>>): string | null {
  const hits = Object.entries(zonesByCountry).filter(([, zones]) => zones.includes(tz));
  return hits.length === 1 ? hits[0][0] : null;
}
