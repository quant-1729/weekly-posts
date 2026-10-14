// The USP form: which fields each kind shows, and the conversion between the flat form values (all
// strings) and the typed `details` the server validates. Pure; safe in the browser.

import { fill, s } from '@/lib/i18n/strings';
import { USP_TITLE_MAX, type UspKind } from './types';

export type FieldType = 'text' | 'number' | 'date' | 'bool' | 'currency';

export interface FieldDef {
  key: string;
  type: FieldType;
  required?: boolean;
  max?: number;
}

/** Flat form values: strings, and "true" or "" for checkboxes. */
export type FormValues = Record<string, string>;

export const USP_FIELDS: Record<UspKind, FieldDef[]> = {
  discount: [
    { key: 'percent', type: 'number' },
    { key: 'amountOff', type: 'number' },
    { key: 'currency', type: 'currency' },
    { key: 'on', type: 'text', required: true, max: 60 },
    { key: 'upTo', type: 'bool' },
    { key: 'validFrom', type: 'date' },
    { key: 'validTo', type: 'date' },
  ],
  price: [
    { key: 'item', type: 'text', required: true, max: 60 },
    { key: 'price', type: 'number', required: true },
    { key: 'currency', type: 'currency', required: true },
    { key: 'unit', type: 'text', max: 20 },
  ],
  quality: [
    { key: 'claim', type: 'text', required: true, max: 60 },
    { key: 'evidence', type: 'text', max: 120 },
  ],
  reviews: [
    { key: 'rating', type: 'number', required: true },
    { key: 'count', type: 'number', required: true },
    { key: 'platform', type: 'text', required: true, max: 30 },
  ],
  delivery: [
    { key: 'promise', type: 'text', required: true, max: 60 },
    { key: 'area', type: 'text', required: true, max: 60 },
    { key: 'conditions', type: 'text', max: 120 },
  ],
  guarantee: [
    { key: 'length', type: 'text', required: true, max: 30 },
    { key: 'terms', type: 'text', max: 200 },
  ],
  experience: [
    { key: 'years', type: 'number' },
    { key: 'credential', type: 'text', max: 60 },
  ],
  free_extra: [
    { key: 'what', type: 'text', required: true, max: 60 },
    { key: 'conditions', type: 'text', max: 120 },
  ],
  custom: [],
};

const num = (v: string | undefined): number | undefined => {
  const t = (v ?? '').trim();
  return t === '' ? undefined : Number(t);
};
const txt = (v: string | undefined): string | undefined => {
  const t = (v ?? '').trim();
  return t === '' ? undefined : t;
};

/** Form values to the typed details a kind expects. Empty fields are left out. */
export function detailsFromForm(kind: UspKind, v: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (k: string, val: unknown) => {
    if (val !== undefined) out[k] = val;
  };
  const currency = (txt(v.currency) ?? '').toUpperCase();
  switch (kind) {
    case 'discount': {
      set('percent', num(v.percent));
      const amount = num(v.amountOff);
      if (amount !== undefined) set('amountOff', { amount, currency });
      set('on', txt(v.on));
      out.upTo = v.upTo === 'true';
      set('validFrom', txt(v.validFrom));
      set('validTo', txt(v.validTo));
      break;
    }
    case 'price': {
      const amount = num(v.price);
      if (amount !== undefined || txt(v.item)) set('price', { amount: amount ?? Number.NaN, currency });
      set('item', txt(v.item));
      set('unit', txt(v.unit));
      break;
    }
    case 'custom':
      break;
    default:
      for (const f of USP_FIELDS[kind]) {
        set(f.key, f.type === 'number' ? num(v[f.key]) : txt(v[f.key]));
      }
  }
  return out;
}

/** Typed details back to form values (for editing). */
export function formFromDetails(kind: UspKind, d: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  const str = (x: unknown) => (x === undefined || x === null ? '' : String(x));
  if (kind === 'discount') {
    out.percent = str(d.percent);
    out.amountOff = str((d.amountOff as { amount?: number } | undefined)?.amount);
    out.currency = str((d.amountOff as { currency?: string } | undefined)?.currency);
    out.on = str(d.on);
    out.upTo = d.upTo === true ? 'true' : '';
    out.validFrom = str(d.validFrom);
    out.validTo = str(d.validTo);
  } else if (kind === 'price') {
    out.item = str(d.item);
    out.price = str((d.price as { amount?: number } | undefined)?.amount);
    out.currency = str((d.price as { currency?: string } | undefined)?.currency);
    out.unit = str(d.unit);
  } else {
    for (const f of USP_FIELDS[kind]) out[f.key] = str(d[f.key]);
  }
  return out;
}

/** The form field a server error path belongs to: "details.price.currency" -> "currency", "details.price.amount" -> "price". */
export function fieldOfError(path: string): string {
  if (path === 'title' || path === 'kind') return path;
  const parts = path.replace(/^details\.?/, '').split('.').filter(Boolean);
  if (parts.length === 0) return 'details';
  if (parts[parts.length - 1] === 'currency') return 'currency';
  return parts[0];
}

/** A short line to start from, built only from what the owner entered. */
export function suggestTitle(kind: UspKind, d: Record<string, unknown>): string {
  const t = s.usps.summary;
  const cut = (x: string) => (x.length <= USP_TITLE_MAX ? x : `${x.slice(0, USP_TITLE_MAX - 1).trimEnd()}…`);
  const money = (m: unknown) => {
    const o = m as { amount?: number; currency?: string } | undefined;
    return o?.amount !== undefined ? `${o.amount} ${o.currency ?? ''}`.trim() : '';
  };
  switch (kind) {
    case 'discount': {
      const prefix = d.upTo === true ? t.upTo : '';
      if (typeof d.percent === 'number') return cut(prefix + fill(t.percentOff, { percent: d.percent, on: String(d.on ?? '') }).trim());
      if (d.amountOff) return cut(prefix + fill(t.amountOff, { amount: money(d.amountOff), on: String(d.on ?? '') }).trim());
      return '';
    }
    case 'price':
      return cut(`${String(d.item ?? '')} ${money(d.price)}${d.unit ? ` / ${String(d.unit)}` : ''}`.trim());
    case 'quality':
      return cut(String(d.claim ?? ''));
    case 'reviews':
      return typeof d.rating === 'number' ? cut(fill(t.rating, { rating: d.rating, platform: String(d.platform ?? ''), count: String(d.count ?? '') })) : '';
    case 'delivery':
      return cut(String(d.promise ?? ''));
    case 'guarantee':
      return cut(`${String(d.length ?? '')} guarantee`.trim());
    case 'experience':
      return typeof d.years === 'number' ? cut(fill(t.years, { years: d.years })) : cut(String(d.credential ?? ''));
    case 'free_extra':
      return cut(String(d.what ?? ''));
    default:
      return '';
  }
}

/** A one-line summary of a USP's details for the list (valid dates, conditions ...). */
export function detailsSummary(kind: UspKind, d: Record<string, unknown>): string {
  const bits: string[] = [];
  if (kind === 'discount') {
    if (d.validFrom || d.validTo) bits.push([d.validFrom, d.validTo].filter(Boolean).join(' to '));
  } else if (kind === 'delivery') {
    bits.push(`${String(d.area ?? '')}`);
  } else if (kind === 'guarantee' && d.terms) bits.push(String(d.terms));
  else if (kind === 'free_extra' && d.conditions) bits.push(String(d.conditions));
  else if (kind === 'quality' && d.evidence) bits.push(String(d.evidence));
  else if (kind === 'experience' && d.credential && d.years) bits.push(String(d.credential));
  return bits.filter(Boolean).join(' · ');
}
