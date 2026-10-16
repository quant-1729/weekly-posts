// The owner's consent to use their own face (kind 'owner_photo', F-6), confirmed by email the same way payment IDs are
// (src/lib/payments/index.ts):
//   - the owner ticks the box on the Brand page: `requestFaceConsent` saves {user_id, at, text_version} on the face and
//     emails a link. The emailed token is random; only its SHA-256 hash is stored, with a 1-hour expiry.
//   - the link opens /f/{token}: GET shows a page and changes nothing (mail scanners open links); POST confirms and sets
//     consent.email_confirmed_at (service role, the token is the proof). The database refuses to approve an
//     owner_photo face without it, and `addOwnerPhoto` refuses photos before it.

import { randomBytes } from 'node:crypto';
import { APP_NAME } from '@/lib/app';
import { takeAll } from '@/lib/auth/rate-limit';
import { requireBrandMember } from '@/lib/brand/current';
import { getDb, type Tx } from '@/lib/db';
import { EmailSendError, sendEmail } from '@/lib/email';
import { getEnv } from '@/lib/env';
import { escapeHtml as esc } from '@/lib/links/format';
import { fill, s } from '@/lib/i18n/strings';
import { hashToken } from '@/lib/payments';
import { FaceError } from './errors';

export const FACE_CONSENT_TTL_MS = 60 * 60 * 1000;
export const FACE_CONSENT_EMAILS_PER_HOUR = 5;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ConsentJson {
  user_id?: string;
  at?: string;
  text_version?: string;
  email_confirmed_at?: string;
  token_hash?: string;
  expires_at?: string;
}

export interface ConsentStatus {
  /** The box was ticked and an email was sent at some point. */
  asked: boolean;
  confirmed: boolean;
  /** Asked, not confirmed, and the link no longer works. */
  expired: boolean;
}

/** What the consent of a face looks like to the card (never the token hash). */
export function consentStatus(c: ConsentJson | null | undefined, now: Date = new Date()): ConsentStatus {
  if (!c || !c.at) return { asked: false, confirmed: false, expired: false };
  if (c.email_confirmed_at) return { asked: true, confirmed: true, expired: false };
  const expired = !c.expires_at || new Date(c.expires_at).getTime() <= now.getTime();
  return { asked: true, confirmed: false, expired };
}

export function faceConsentEmail(args: { link: string; businessName: string }): { subject: string; html: string; text: string } {
  const t = s.faces.consent.email;
  const intro = fill(t.intro, { business: args.businessName });
  const href = esc(args.link);
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#fafaf9;font-family:Arial,Helvetica,sans-serif;color:#1c1917;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
<tr><td>
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#E4572E;">${esc(APP_NAME)}</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${esc(intro)}</p>
<p style="margin:0 0 20px;"><a href="${href}" style="display:inline-block;background:#E4572E;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 24px;border-radius:8px;">${esc(t.button)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#57534e;">${esc(t.linkFallback)}</p>
<p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${href}" style="color:#57534e;">${href}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#57534e;">${esc(t.expiry)}</p>
<p style="margin:0;font-size:13px;color:#57534e;">${esc(t.ignore)}</p>
</td></tr>
</table>
</body>
</html>`;
  const text = [intro, '', args.link, '', t.expiry, t.ignore, ''].join('\n');
  return { subject: t.subject, html, text };
}

/**
 * The owner ticked the consent box: saves the consent on a draft owner_photo face and emails the confirmation link.
 * A new request replaces an older one. Throws FaceError (consent_missing, bad_status, not_found, consent_no_email,
 * consent_rate_limited, consent_email).
 */
export async function requestFaceConsent(args: { userId: string; brandId: string; faceId: string; agreed: unknown; now?: Date }): Promise<{ expiresAt: string }> {
  const now = args.now ?? new Date();
  if (args.agreed !== true) throw new FaceError('consent_missing');
  await requireBrandMember(args.userId, args.brandId);
  if (!UUID_RE.test(args.faceId)) throw new FaceError('not_found');

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + FACE_CONSENT_TTL_MS);
  const consent: ConsentJson = { user_id: args.userId, at: now.toISOString(), text_version: s.faces.consent.textVersion, token_hash: hashToken(token), expires_at: expires.toISOString() };

  const { email, businessName } = await getDb().withUser(args.userId, async (tx) => {
    const [face] = await tx.query<{ kind: string; status: string }>('select kind, status from public.brand_faces where id = $1::uuid and brand_id = $2', [args.faceId, args.brandId]);
    if (!face) throw new FaceError('not_found');
    if (face.kind !== 'owner_photo' || face.status !== 'draft') throw new FaceError('bad_status');
    const [profile] = await tx.query<{ email: string | null }>('select email from public.profiles where id = $1', [args.userId]);
    if (!profile?.email) throw new FaceError('consent_no_email');
    if (!takeAll([{ key: `face-consent:${args.brandId}`, limit: FACE_CONSENT_EMAILS_PER_HOUR, windowMs: 60 * 60 * 1000 }], now.getTime())) {
      throw new FaceError('consent_rate_limited');
    }
    const [brand] = await tx.query<{ name: string }>(
      `select coalesce(nullif(trim(m.business_name), ''), b.name) as name from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [args.brandId],
    );
    await tx.query('update public.brand_faces set consent = $3::jsonb, updated_at = now() where id = $1::uuid and brand_id = $2', [args.faceId, args.brandId, JSON.stringify(consent)]);
    return { email: profile.email, businessName: brand?.name ?? '' };
  });

  const base = getEnv().appUrl;
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL is required to build links in production.');
  const message = faceConsentEmail({ link: `${base}/f/${token}`, businessName });
  try {
    await sendEmail({ to: email, kind: 'face_consent', userId: args.userId, brandId: args.brandId, ...message });
  } catch (e) {
    // No email, no way to confirm: take the request back rather than leave it dangling.
    await getDb()
      .withUser(args.userId, (tx) => tx.query('update public.brand_faces set consent = null where id = $1::uuid and brand_id = $2', [args.faceId, args.brandId]))
      .catch(() => undefined);
    if (e instanceof EmailSendError) throw new FaceError('consent_email');
    throw e;
  }
  return { expiresAt: expires.toISOString() };
}

// ---------------------------------------------------------------------------------------------
// The emailed link (service role: the token is the proof)
// ---------------------------------------------------------------------------------------------

export type ConsentLookup =
  | { state: 'ready'; faceName: string; businessName: string }
  | { state: 'expired' | 'used' | 'invalid' };

interface Found {
  id: string;
  brand_id: string;
  name: string;
  status: string;
  consent: ConsentJson | null;
  business: string | null;
}

async function find(tx: Tx, token: string, lock: boolean): Promise<Found | null> {
  const [row] = await tx.query<Found>(
    `select f.id::text as id, f.brand_id::text as brand_id, f.name, f.status, f.consent,
            coalesce(nullif(trim(m.business_name), ''), b.name) as business
       from public.brand_faces f join public.brands b on b.id = f.brand_id left join public.brand_memory m on m.brand_id = f.brand_id
      where f.kind = 'owner_photo' and f.consent ->> 'token_hash' = $1${lock ? ' for update of f' : ''}`,
    [hashToken(token)],
  );
  return row ?? null;
}

function judge(row: Found | null, now: Date): ConsentLookup {
  if (!row || row.status === 'retired') return { state: 'invalid' };
  if (row.consent?.email_confirmed_at) return { state: 'used' };
  if (!row.consent?.expires_at || new Date(row.consent.expires_at).getTime() <= now.getTime()) return { state: 'expired' };
  return { state: 'ready', faceName: row.name, businessName: row.business ?? '' };
}

/** What the emailed link is for. Reads only: this is what GET shows. */
export async function peekFaceConsent(token: string, now: Date = new Date()): Promise<ConsentLookup> {
  if (!TOKEN_RE.test(token)) return { state: 'invalid' };
  return getDb().withService(async (tx) => judge(await find(tx, token, false), now));
}

/** Confirms the consent behind the token (single use). Only the confirmation route's POST (after its CSRF check) may call this. */
export async function confirmFaceConsent(token: string, now: Date = new Date()): Promise<{ state: 'confirmed'; faceName: string } | { state: 'expired' | 'used' | 'invalid' }> {
  if (!TOKEN_RE.test(token)) return { state: 'invalid' };
  return getDb().withService(async (tx) => {
    const row = await find(tx, token, true);
    const verdict = judge(row, now);
    if (verdict.state !== 'ready' || !row) return { state: verdict.state === 'ready' ? ('invalid' as const) : verdict.state };
    // The hash stays, so the same link later says "already used"; the expiry no longer matters.
    const { expires_at: _exp, ...rest } = row.consent ?? {};
    void _exp;
    await tx.query('update public.brand_faces set consent = $3::jsonb, updated_at = now() where id = $1::uuid and brand_id = $2', [
      row.id,
      row.brand_id,
      JSON.stringify({ ...rest, email_confirmed_at: now.toISOString() }),
    ]);
    return { state: 'confirmed' as const, faceName: row.name };
  });
}
