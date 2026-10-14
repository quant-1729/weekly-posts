// USP library types (PRD v3 B-2, change C-05). Orchestrator-owned: builders import these,
// they don't redefine them. Mirrors `public.usp_kind` in supabase/migrations/0014_v3_details.sql.

import { z } from 'zod';

export const USP_KINDS = ['discount', 'price', 'quality', 'reviews', 'delivery', 'guarantee', 'experience', 'free_extra', 'custom'] as const;
export type UspKind = (typeof USP_KINDS)[number];

export const USP_SOURCES = ['owner', 'setup', 'website', 'instagram', 'youtube'] as const;
export type UspSource = (typeof USP_SOURCES)[number];

/** Max characters of the short line a post shows (matches the table check). */
export const USP_TITLE_MAX = 60;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const currency = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. GBP');
const money = z.object({ amount: z.number().positive(), currency });
const short = (max: number) => z.string().trim().min(1).max(max);

/**
 * Fields per USP kind. Everything here is owner-entered or imported with a source; nothing is
 * invented. Rules that need the owner's confirmation are marked with `needsConfirmation` below.
 */
export const USP_DETAILS = {
  discount: z
    .object({
      percent: z.number().gt(0).lte(100).optional(),
      amountOff: money.optional(),
      on: short(60), // what the discount is on
      upTo: z.boolean().default(false), // "up to" only when the owner says so
      validFrom: isoDate.optional(),
      validTo: isoDate.optional(),
    })
    .refine((d) => d.percent !== undefined || d.amountOff !== undefined, { message: 'Give a percentage or an amount off' })
    .refine((d) => !d.validFrom || !d.validTo || d.validFrom <= d.validTo, { message: 'The start date must be before the end date' }),
  price: z.object({ item: short(60), price: money, unit: z.string().trim().max(20).optional() }),
  quality: z.object({ claim: short(60), evidence: z.string().trim().max(120).optional() }),
  reviews: z.object({ rating: z.number().min(0).max(5), count: z.number().int().positive(), platform: short(30) }),
  delivery: z.object({ promise: short(60), area: short(60), conditions: z.string().trim().max(120).optional() }),
  guarantee: z.object({ length: short(30), terms: z.string().trim().max(200).optional() }),
  experience: z
    .object({ years: z.number().int().positive().max(300).optional(), credential: z.string().trim().max(60).optional() })
    .refine((d) => d.years !== undefined || !!d.credential, { message: 'Give the years or the credential' }),
  free_extra: z.object({ what: short(60), conditions: z.string().trim().max(120).optional() }),
  custom: z.object({}),
} satisfies Record<UspKind, z.ZodTypeAny>;

export type UspDetails<K extends UspKind = UspKind> = z.infer<(typeof USP_DETAILS)[K]>;

export interface Usp<K extends UspKind = UspKind> {
  id: string;
  brandId: string;
  kind: K;
  title: string;
  details: UspDetails<K>;
  source: UspSource;
  sourceRef: string | null;
  confirmed: boolean;
  active: boolean;
  sort: number;
}

/** Kinds whose claim may only appear on a post after the owner confirms it (PRD v3 B-2, C-12). */
export const NEEDS_CONFIRMATION: ReadonlySet<UspKind> = new Set(['quality', 'reviews', 'experience']);
