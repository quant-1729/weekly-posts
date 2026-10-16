import { open, type CityResponse, type Reader } from "maxmind";

/**
 * Approximate place of a visitor from their IP, looked up OFFLINE in the DB-IP "IP to City Lite" database
 * (MMDB format, CC BY 4.0: "IP geolocation by DB-IP"). The file path is GEOIP_DB_PATH; the Dockerfile downloads
 * it at build time. When the variable is unset, the file is missing or unreadable, or the address is private,
 * the answer is { country: null, city: null } and nothing is thrown. No network call is ever made, and the
 * address is not kept anywhere by this module.
 */

export const GEO_ATTRIBUTION = "IP geolocation by DB-IP";

export interface Geo {
  country: string | null;
  city: string | null;
}

const NONE: Geo = { country: null, city: null };
const readers = new Map<string, Promise<Reader<CityResponse> | null>>();

function readerFor(path: string): Promise<Reader<CityResponse> | null> {
  let r = readers.get(path);
  if (!r) {
    r = open<CityResponse>(path).catch((e: unknown) => {
      console.warn("[geo] could not open the geolocation database; city and country stay empty:", (e as Error)?.message ?? e);
      return null;
    });
    readers.set(path, r);
  }
  return r;
}

/** Tests only: forget opened databases. */
export function resetGeoForTests(): void {
  readers.clear();
}

export async function lookupGeo(ip: string | null | undefined): Promise<Geo> {
  const path = process.env.GEOIP_DB_PATH?.trim();
  if (!path || !ip) return NONE;
  try {
    const reader = await readerFor(path);
    if (!reader) return NONE;
    const hit = reader.get(ip);
    const country = hit?.country?.iso_code ?? hit?.registered_country?.iso_code ?? null;
    const city = hit?.city?.names?.en ?? null;
    return {
      country: country && /^[A-Z]{2}$/.test(country) ? country : null,
      city: city ? city.slice(0, 80) : null,
    };
  } catch {
    // An invalid address or a corrupt file: no place, never an error into sign-in.
    return NONE;
  }
}
