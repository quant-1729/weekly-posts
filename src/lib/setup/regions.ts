import Holidays from "date-holidays";
import { ISO_COUNTRY_CODES, isIsoCountry } from "./countries";

/**
 * Regions and zones per country, from the bundled holiday dataset (no network).
 * Server only: the dataset is large, so the setup page reads it here and hands the small
 * result to the wizard.
 */

export interface RegionOption {
  /** ISO 3166-2, e.g. "US-OR". */
  code: string;
  name: string;
}

let cache: { regions: Record<string, RegionOption[]>; zones: Record<string, string[]> } | null = null;

function load() {
  if (cache) return cache;
  const regions: Record<string, RegionOption[]> = {};
  const zones: Record<string, string[]> = {};
  for (const cc of ISO_COUNTRY_CODES) {
    let hd: Holidays;
    try {
      hd = new Holidays(cc);
    } catch {
      continue; // country not in the dataset
    }
    const states = hd.getStates(cc) as Record<string, string> | undefined;
    if (states && Object.keys(states).length > 0) {
      regions[cc] = Object.entries(states)
        .map(([code, name]) => ({ code: `${cc}-${code}`, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en"));
    }
    const tz = hd.getTimezones() as string[] | undefined;
    if (tz && tz.length > 0) zones[cc] = tz;
  }
  cache = { regions, zones };
  return cache;
}

/** Country -> regions, for the countries that have any. */
export function regionsByCountry(): Record<string, RegionOption[]> {
  return load().regions;
}

/** Country -> IANA zones, for the countries the dataset knows. */
export function timezonesByCountry(): Record<string, string[]> {
  return load().zones;
}

/** A region is valid when it is empty, or listed for the country as "CC-XX". */
export function isValidRegion(country: string, region: string): boolean {
  if (region === "") return true;
  if (!isIsoCountry(country)) return false;
  return (load().regions[country] ?? []).some((r) => r.code === region);
}
