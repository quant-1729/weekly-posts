// Contact normalisation (PRD v3 B-4, change C-09): what the owner types, turned into the stored
// value and the short text a post shows. Pure and offline (no network); the reachability check is
// in `service.ts`. Server-side: it loads libphonenumber metadata, so the browser form sends raw text.

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { normalizeInstagramHandle } from '@/lib/instagram/handle';
import { classifyIp, isBlockedHostname } from '@/lib/website/ip';
import { isIP } from 'node:net';
import { formatHours, parseHours } from './hours';
import { CONTACT_KINDS, type ContactInput, type ContactKind } from './types';

export type FieldErrors = Record<string, string>;

export type NormalizedContact =
  | { ok: true; kind: ContactKind; value: string; display: string; details: Record<string, unknown> }
  | { ok: false; fieldErrors: FieldErrors };

const DISPLAY_MAX = 120;
const VALUE_MAX = 500;

export function isContactKind(v: unknown): v is ContactKind {
  return typeof v === 'string' && (CONTACT_KINDS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Phone and WhatsApp
// ---------------------------------------------------------------------------

export type PhoneResult = { ok: true; e164: string; display: string; international: string; country: string | null } | { ok: false };

/**
 * Reads a phone number as the owner types it. Numbers without a "+" are read in `defaultCountry`
 * (the brand's country). `display` is always the international format (e.g. "+91 98200 12345").
 * Returns { ok: false } for anything that is not a valid number.
 */
export function normalizePhone(raw: string, defaultCountry: string | null): PhoneResult {
  const text = raw.trim();
  if (text.length < 5 || text.length > 40) return { ok: false };
  const country = /^[A-Z]{2}$/.test(defaultCountry ?? '') ? (defaultCountry as CountryCode) : undefined;
  let parsed;
  try {
    parsed = parsePhoneNumberFromString(text, country);
  } catch {
    return { ok: false };
  }
  if (!parsed || !parsed.isValid()) return { ok: false };
  return {
    ok: true,
    e164: parsed.number,
    // International format everywhere: national formats add trunk prefixes some countries don't write
    // (India shows mobiles as "098200 12345"), and posts travel; WhatsApp needs the country code anyway.
    display: parsed.formatInternational(),
    international: parsed.formatInternational(),
    country: parsed.country ?? null,
  };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type UrlResult = { ok: true; url: string; host: string; display: string } | { ok: false; error: 'invalid_url' };

/**
 * A web address as an https URL. Without a scheme "https://" is added; "http://" is upgraded to
 * https. Refused: other schemes (javascript:, ftp:, data: ...), credentials, ports other than 80
 * and 443, a host without a dot, localhost / .local / .internal names and private, loopback or
 * metadata IP addresses (the same rules the safe fetcher uses).
 */
export function normalizeUrl(raw: string): UrlResult {
  const text = raw.trim();
  if (text === '' || text.length > VALUE_MAX || /[\s<>"'\\]/.test(text)) return { ok: false, error: 'invalid_url' };
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+(\/|$)/.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) return { ok: false, error: 'invalid_url' };
  let u: URL;
  try {
    u = new URL(hasScheme ? text : `https://${text.replace(/^\/\//, '')}`);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'invalid_url' };
  if (u.username || u.password) return { ok: false, error: 'invalid_url' };
  if (u.port !== '' && u.port !== '80' && u.port !== '443') return { ok: false, error: 'invalid_url' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) {
    if (!classifyIp(host).ok) return { ok: false, error: 'invalid_url' };
  } else if (!host.includes('.') || isBlockedHostname(host) || host.startsWith('.') || host.endsWith('..')) {
    return { ok: false, error: 'invalid_url' };
  }
  u.protocol = 'https:';
  u.port = '';
  u.hash = '';
  let url = u.href;
  if (u.pathname === '/' && !u.search) url = url.replace(/\/$/, '');
  if (url.length > VALUE_MAX) return { ok: false, error: 'invalid_url' };
  const shown = url.replace(/^https:\/\//, '');
  return { ok: true, url, host, display: shown.length <= DISPLAY_MAX ? shown : host };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export function normalizeEmail(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (t.length > 254 || /\s/.test(t)) return null;
  const m = /^([^@\s]{1,64})@([^@\s]+\.[^@\s.]{2,})$/.exec(t);
  if (!m || m[1].startsWith('.') || m[1].endsWith('.') || m[1].includes('..') || m[2].includes('..')) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(m[1]) || !/^[a-z0-9.\u0080-￿-]+$/.test(m[2])) return null;
  return t;
}

// ---------------------------------------------------------------------------
// Social handles
// ---------------------------------------------------------------------------

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const FB_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com']);
const FB_RESERVED = new Set([
  'share', 'sharer', 'sharer.php', 'login', 'login.php', 'groups', 'events', 'watch', 'marketplace', 'pages', 'help', 'policies', 'privacy',
  'dialog', 'plugins', 'gaming', 'stories', 'reel', 'reels', 'photo', 'photos', 'video', 'videos', 'story.php', 'permalink.php', 'tr', 'ads',
]);

function asUrl(raw: string): URL | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/\//, '')}`);
  } catch {
    return null;
  }
}

export type SocialResult = { ok: true; value: string; display: string } | { ok: false };

/** "@bakery", "bakery" or a youtube.com address -> "@bakery"; channel, /c/ and /user/ addresses stay as https URLs. */
export function normalizeYoutube(raw: string): SocialResult {
  const t = raw.trim();
  if (t === '' || t.length > 300) return { ok: false };
  if (/youtube\.com|youtu\.be/i.test(t) || /^https?:\/\//i.test(t)) {
    const u = asUrl(t);
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !YT_HOSTS.has(u.hostname.toLowerCase())) return { ok: false };
    const parts = u.pathname.split('/').filter(Boolean);
    const first = parts[0] ?? '';
    if (/^@[A-Za-z0-9._-]{3,30}$/.test(first)) return { ok: true, value: first, display: first };
    if (['channel', 'c', 'user'].includes(first.toLowerCase()) && /^[A-Za-z0-9._-]{2,60}$/.test(parts[1] ?? '')) {
      const path = `${first.toLowerCase()}/${parts[1]}`;
      return { ok: true, value: `https://www.youtube.com/${path}`, display: `youtube.com/${path}` };
    }
    return { ok: false };
  }
  const name = t.replace(/^@/, '');
  return /^[A-Za-z0-9._-]{3,30}$/.test(name) ? { ok: true, value: `@${name}`, display: `@${name}` } : { ok: false };
}

/** "bakerylondon" or a facebook.com address -> the page name; profile.php?id=N stays as a URL. */
export function normalizeFacebook(raw: string): SocialResult {
  const t = raw.trim();
  if (t === '' || t.length > 300) return { ok: false };
  if (/facebook\.com|fb\.com/i.test(t) || /^https?:\/\//i.test(t)) {
    const u = asUrl(t);
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !FB_HOSTS.has(u.hostname.toLowerCase())) return { ok: false };
    const parts = u.pathname.split('/').filter(Boolean);
    const first = parts[0] ?? '';
    if (first.toLowerCase() === 'profile.php') {
      const id = u.searchParams.get('id') ?? '';
      return /^\d{5,20}$/.test(id)
        ? { ok: true, value: `https://www.facebook.com/profile.php?id=${id}`, display: `facebook.com/profile.php?id=${id}` }
        : { ok: false };
    }
    if (!/^[A-Za-z0-9.]{5,50}$/.test(first) || FB_RESERVED.has(first.toLowerCase())) return { ok: false };
    return { ok: true, value: first, display: `facebook.com/${first}` };
  }
  const name = t.replace(/^@/, '');
  if (!/^[A-Za-z0-9.]{5,50}$/.test(name) || FB_RESERVED.has(name.toLowerCase())) return { ok: false };
  return { ok: true, value: name, display: `facebook.com/${name}` };
}

// ---------------------------------------------------------------------------
// One entry point
// ---------------------------------------------------------------------------

const text = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/[ \t]+/g, ' ') : '');

/**
 * Normalises what the owner typed for one contact. `country` is the brand's ISO country, used to
 * read phone numbers written without "+". On success: the stored `value`, the `display` text and
 * `details` (hours per day, full address, wa.me link). On failure: field errors with short codes
 * (`required`, `too_long`, `invalid_phone`, `invalid_url`, `invalid_email`, `invalid_handle`,
 * `hours_time`, `hours_overlap`, `hours_none_open`, `invalid_hours`).
 */
export function normalizeContact(input: ContactInput | unknown, ctx: { country: string | null }): NormalizedContact {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const kind = o.kind;
  if (!isContactKind(kind)) return { ok: false, fieldErrors: { kind: 'invalid' } };
  const fail = (field: string, code: string): NormalizedContact => ({ ok: false, fieldErrors: { [field]: code } });
  const raw = text(o.value);
  const label = text(o.label);
  if (label.length > DISPLAY_MAX) return fail('label', 'too_long');

  switch (kind) {
    case 'phone':
    case 'whatsapp': {
      if (!raw) return fail('value', 'required');
      const p = normalizePhone(raw, ctx.country);
      if (!p.ok) return fail('value', 'invalid_phone');
      const details: Record<string, unknown> = { international: p.international };
      if (p.country) details.country = p.country;
      if (kind === 'whatsapp') details.link = `https://wa.me/${p.e164.slice(1)}`;
      return { ok: true, kind, value: p.e164, display: p.display, details };
    }
    case 'website':
    case 'map':
    case 'booking':
    case 'custom_link': {
      if (!raw) return fail('value', 'required');
      const u = normalizeUrl(raw);
      if (!u.ok) return fail('value', 'invalid_url');
      if (kind === 'custom_link' && !label) return fail('label', 'required');
      return { ok: true, kind, value: u.url, display: label || u.display, details: { host: u.host } };
    }
    case 'email': {
      if (!raw) return fail('value', 'required');
      const e = normalizeEmail(raw);
      return e ? { ok: true, kind, value: e, display: e, details: {} } : fail('value', 'invalid_email');
    }
    case 'address': {
      if (!raw) return fail('value', 'required');
      if (raw.length > DISPLAY_MAX) return fail('value', 'too_long');
      const full = text(o.full);
      if (full.length > VALUE_MAX) return fail('full', 'too_long');
      return { ok: true, kind, value: full || raw, display: raw, details: { full: full || raw } };
    }
    case 'hours': {
      const h = parseHours(o.days);
      if (!h.ok) return fail('days', h.error);
      const shown = formatHours(h.days);
      return { ok: true, kind, value: shown, display: shown, details: { days: h.days } };
    }
    case 'instagram': {
      if (!raw) return fail('value', 'required');
      const handle = normalizeInstagramHandle(raw);
      return handle ? { ok: true, kind, value: handle, display: `@${handle}`, details: {} } : fail('value', 'invalid_handle');
    }
    case 'youtube': {
      if (!raw) return fail('value', 'required');
      const y = normalizeYoutube(raw);
      return y.ok ? { ok: true, kind, value: y.value, display: y.display, details: {} } : fail('value', 'invalid_handle');
    }
    case 'facebook': {
      if (!raw) return fail('value', 'required');
      const f = normalizeFacebook(raw);
      return f.ok ? { ok: true, kind, value: f.value, display: f.display, details: {} } : fail('value', 'invalid_handle');
    }
  }
}
