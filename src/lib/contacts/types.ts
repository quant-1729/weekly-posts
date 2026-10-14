// Contact set types (PRD v3 B-4, change C-09). Mirrors `public.contact_points` in 0014_v3_details.sql.
// Pure; safe to import in the browser.

export const CONTACT_KINDS = [
  'phone', 'whatsapp', 'website', 'email', 'address', 'hours', 'map', 'booking', 'instagram', 'youtube', 'facebook', 'custom_link',
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const CONTACT_SOURCES = ['owner', 'setup', 'website', 'instagram', 'youtube'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/** Kinds whose value is a web link (they can be checked for reachability). */
export const LINK_KINDS: ReadonlySet<ContactKind> = new Set(['website', 'map', 'booking', 'custom_link']);

/** Kinds the brand can have only one of. */
export const SINGLE_KINDS: ReadonlySet<ContactKind> = new Set(['hours']);

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export interface TimeRange {
  /** "HH:MM", 24-hour. */
  open: string;
  /** "HH:MM", up to "24:00". */
  close: string;
}

/** Opening hours per day. An empty list means closed. */
export type HoursDays = Record<DayKey, TimeRange[]>;

export interface ContactPoint {
  id: string;
  brandId: string;
  kind: ContactKind;
  /** Normalised: E.164 phone, https URL, handle, lower-case email, full address, hours text. */
  value: string;
  /** How a post shows it. */
  display: string | null;
  details: Record<string, unknown>;
  isDefault: boolean;
  verifiedAt: string | null;
  source: ContactSource;
}

/** What the owner types. Which fields count depends on the kind (see `normalizeContact`). */
export interface ContactInput {
  kind: ContactKind;
  /** Phone/WhatsApp number, URL, email, handle, or the short address. */
  value?: string;
  /** A name for the link (custom link, booking). */
  label?: string;
  /** Full address (address only). */
  full?: string;
  /** Opening hours (hours only). */
  days?: unknown;
  isDefault?: boolean;
  /** Who typed it: the owner (default) or a setup screen. Only used when creating. */
  source?: 'owner' | 'setup';
}
