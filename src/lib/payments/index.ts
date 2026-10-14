// Payment IDs for payment QR codes (PRD v3 B-4.1, change C-10). Table: public.payment_ids (migration 0014).
//
// Rules:
//  - The owner types the ID. It is never written, edited or suggested by AI (see ./redact.ts).
//  - A new or changed ID is 'pending' until the owner opens the emailed link and presses Confirm.
//    The emailed token is random; only its SHA-256 hash is stored, with a 1-hour expiry.
//  - Signed-in users can insert only 'pending' rows and update only to 'pending'/'retired' (RLS).
//    Activation runs as the service role, from the confirmation route only.
//  - One active ID per brand and scheme: confirming a new one retires the old one in the same step.

import { createHash, randomBytes } from "node:crypto";
import { APP_NAME } from "@/lib/app";
import { takeAll } from "@/lib/auth/rate-limit";
import { getDb, type Tx } from "@/lib/db";
import { EmailSendError, sendEmail } from "@/lib/email";
import { getEnv } from "@/lib/env";
import { PAYMENT_SCHEMES, cleanPayeeName, isPaymentScheme, validPayeeName, type PaymentSchemeId } from "@/lib/qr/payment";
import { paymentCopy as copy } from "./copy";

import { redactPaymentIds } from "./redact";

export { redactPaymentIds, findPaymentIds, containsPaymentId, foreignPaymentIds, redactDeep, REDACTED_PAYMENT_ID } from "./redact";

export const CONFIRM_TTL_MS = 60 * 60 * 1000;
export const CONFIRM_EMAILS_PER_HOUR = 5;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaymentStatus = "pending" | "active" | "retired";

export interface PaymentIdView {
  id: string;
  brandId: string;
  scheme: PaymentSchemeId;
  address: string;
  payeeName: string;
  status: PaymentStatus;
  confirmedAt: string | null;
  createdAt: string;
  /** Only for a pending ID: when its confirmation link stops working. */
  expiresAt: string | null;
}

export type PaymentErrorCode = "address" | "payeeName" | "scheme" | "not_owner" | "already_active" | "rate_limited" | "email_failed" | "no_email" | "not_found";

export class PaymentError extends Error {
  constructor(public readonly code: PaymentErrorCode) {
    super(`Payment ID: ${code}`);
    this.name = "PaymentError";
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

interface Row {
  id: string;
  brand_id: string;
  scheme: PaymentSchemeId;
  address: string;
  payee_name: string;
  status: PaymentStatus;
  confirmed_at: Date | string | null;
  created_at: Date | string;
  confirm_expires_at: Date | string | null;
}
const COLUMNS = `id::text as id, brand_id::text as brand_id, scheme::text as scheme, address, payee_name, status,
                 confirmed_at, created_at, confirm_expires_at`;
const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

function toView(r: Row): PaymentIdView {
  return {
    id: r.id,
    brandId: r.brand_id,
    scheme: r.scheme,
    address: r.address,
    payeeName: r.payee_name,
    status: r.status,
    confirmedAt: iso(r.confirmed_at),
    createdAt: iso(r.created_at)!,
    expiresAt: r.status === "pending" ? iso(r.confirm_expires_at) : null,
  };
}

// ---------------------------------------------------------------------------
// Owner actions (run as the signed-in user: row-level security applies)
// ---------------------------------------------------------------------------

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function paymentConfirmEmail(args: { link: string; scheme: PaymentSchemeId; address: string; payeeName: string }): { subject: string; html: string; text: string } {
  const t = copy.email;
  const label = PAYMENT_SCHEMES[args.scheme].label;
  const intro = t.intro(label, args.address, args.payeeName);
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
  const text = [intro, "", args.link, "", t.expiry, t.ignore, ""].join("\n");
  return { subject: t.subject(label), html, text };
}

/**
 * Saves a typed payment ID as 'pending' and emails the owner a confirmation link. Only the brand
 * owner can do this (row-level security checks it again). An older pending ID of the same scheme
 * is cancelled. The active ID, if any, keeps working until this one is confirmed.
 */
export async function addPaymentId(args: {
  userId: string;
  brandId: string;
  scheme: string;
  address: string;
  payeeName: string;
  now?: Date;
}): Promise<PaymentIdView> {
  const now = args.now ?? new Date();
  if (!isPaymentScheme(args.scheme)) throw new PaymentError("scheme");
  const scheme = args.scheme;
  const address = (args.address ?? "").trim();
  if (!PAYMENT_SCHEMES[scheme].validateAddress(address)) throw new PaymentError("address");
  const payeeName = cleanPayeeName(args.payeeName ?? "");
  if (!validPayeeName(payeeName)) throw new PaymentError("payeeName");
  if (!UUID_RE.test(args.brandId)) throw new PaymentError("not_owner");

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + CONFIRM_TTL_MS);

  const { view, email } = await getDb().withUser(args.userId, async (tx) => {
    const [own] = await tx.query<{ ok: boolean }>("select public.is_brand_owner($1::uuid) as ok", [args.brandId]);
    if (!own?.ok) throw new PaymentError("not_owner");
    const [active] = await tx.query<{ n: number }>(
      "select count(*)::int as n from public.payment_ids where brand_id = $1 and scheme = $2::public.payment_scheme and status = 'active' and lower(address) = lower($3) and lower(payee_name) = lower($4)",
      [args.brandId, scheme, address, payeeName],
    );
    if (active.n > 0) throw new PaymentError("already_active");
    const [profile] = await tx.query<{ email: string | null }>("select email from public.profiles where id = $1", [args.userId]);
    if (!profile?.email) throw new PaymentError("no_email");
    if (!takeAll([{ key: `payment-confirm:${args.brandId}`, limit: CONFIRM_EMAILS_PER_HOUR, windowMs: 60 * 60 * 1000 }], now.getTime())) {
      throw new PaymentError("rate_limited");
    }
    await tx.query(
      "update public.payment_ids set status = 'retired' where brand_id = $1 and scheme = $2::public.payment_scheme and status = 'pending'",
      [args.brandId, scheme],
    );
    const [row] = await tx.query<Row>(
      `insert into public.payment_ids (brand_id, scheme, address, payee_name, status, confirm_token_hash, confirm_expires_at, created_by, created_at)
       values ($1, $2::public.payment_scheme, $3, $4, 'pending', $5, $6::timestamptz, $7, $8::timestamptz)
       returning ${COLUMNS}`,
      [args.brandId, scheme, address, payeeName, hashToken(token), expires.toISOString(), args.userId, now.toISOString()],
    );
    return { view: toView(row), email: profile.email };
  });

  const base = getEnv().appUrl;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is required to build links in production.");
  const message = paymentConfirmEmail({ link: `${base}/p/${token}`, scheme, address, payeeName });
  try {
    await sendEmail({ to: email, kind: "payment_confirm", userId: args.userId, brandId: args.brandId, ...message });
  } catch (e) {
    // No email, no way to confirm: cancel the pending row rather than leave it dangling.
    await retirePaymentId({ userId: args.userId, brandId: args.brandId, id: view.id }).catch(() => undefined);
    if (e instanceof EmailSendError) throw new PaymentError("email_failed");
    throw e;
  }
  return view;
}

/** Retires a pending or active ID (owner only). Returns false when there was nothing to retire. */
export async function retirePaymentId(args: { userId: string; brandId: string; id: string }): Promise<boolean> {
  if (!UUID_RE.test(args.brandId) || !UUID_RE.test(args.id)) return false;
  return getDb().withUser(args.userId, async (tx) => {
    const [own] = await tx.query<{ ok: boolean }>("select public.is_brand_owner($1::uuid) as ok", [args.brandId]);
    if (!own?.ok) throw new PaymentError("not_owner");
    const rows = await tx.query<{ id: string }>(
      "update public.payment_ids set status = 'retired' where id = $1 and brand_id = $2 and status in ('pending', 'active') returning id::text as id",
      [args.id, args.brandId],
    );
    return rows.length > 0;
  });
}

/** The brand's payment IDs, newest first (members can read; the token hash is never returned). */
export async function listPaymentIds(userId: string, brandId: string): Promise<PaymentIdView[]> {
  if (!UUID_RE.test(brandId)) return [];
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.payment_ids where brand_id = $1 order by created_at desc, id`, [brandId]),
  );
  return rows.map(toView);
}

/** Whether the user is the owner of the brand (for the card: only owners can add or retire). */
export async function isPaymentOwner(userId: string, brandId: string): Promise<boolean> {
  if (!UUID_RE.test(brandId)) return false;
  const [r] = await getDb().withUser(userId, (tx) => tx.query<{ ok: boolean }>("select public.is_brand_owner($1::uuid) as ok", [brandId]));
  return Boolean(r?.ok);
}

// ---------------------------------------------------------------------------
// Server-side reads and the confirmation (service role: callers have checked access)
// ---------------------------------------------------------------------------

/** The brand's confirmed ID for a scheme, or null. Service role: for the renderer and the guardrail. */
export async function getActivePaymentId(brandId: string, scheme: PaymentSchemeId = "upi"): Promise<PaymentIdView | null> {
  if (!UUID_RE.test(brandId)) return null;
  const [r] = await getDb().withService((tx) =>
    tx.query<Row>(
      `select ${COLUMNS} from public.payment_ids where brand_id = $1 and scheme = $2::public.payment_scheme and status = 'active'`,
      [brandId, scheme],
    ),
  );
  return r ? toView(r) : null;
}

/** An active ID by its row id, only if it belongs to the brand. Used when a QR spec points at a payment ID. */
export async function getActivePaymentIdById(brandId: string, id: string, tx?: Tx): Promise<PaymentIdView | null> {
  if (!UUID_RE.test(brandId) || !UUID_RE.test(id)) return null;
  const run = (t: Tx) =>
    t.query<Row>(`select ${COLUMNS} from public.payment_ids where id = $1 and brand_id = $2 and status = 'active'`, [id, brandId]);
  const [r] = tx ? await run(tx) : await getDb().withService(run);
  return r ? toView(r) : null;
}

export type ConfirmLookup =
  | { state: "ready"; payment: PaymentIdView; businessName: string; replaces: { address: string; payeeName: string } | null }
  | { state: "expired" | "used" | "replaced" | "invalid" };

async function lookup(tx: Tx, token: string, now: Date, lock: boolean): Promise<{ lookup: ConfirmLookup; row?: Row }> {
  if (!TOKEN_RE.test(token)) return { lookup: { state: "invalid" } };
  const [row] = await tx.query<Row>(
    `select ${COLUMNS} from public.payment_ids where confirm_token_hash = $1${lock ? " for update" : ""}`,
    [hashToken(token)],
  );
  if (!row) return { lookup: { state: "invalid" } };
  if (row.status !== "pending") return { lookup: { state: row.confirmed_at ? "used" : "replaced" }, row };
  if (!row.confirm_expires_at || new Date(row.confirm_expires_at).getTime() <= now.getTime()) return { lookup: { state: "expired" }, row };
  const [brand] = await tx.query<{ name: string }>(
    "select coalesce(nullif(trim(m.business_name), ''), b.name) as name from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1",
    [row.brand_id],
  );
  const [current] = await tx.query<{ address: string; payee_name: string }>(
    "select address, payee_name from public.payment_ids where brand_id = $1 and scheme = $2::public.payment_scheme and status = 'active'",
    [row.brand_id, row.scheme],
  );
  return {
    lookup: {
      state: "ready",
      payment: toView(row),
      businessName: brand?.name ?? "",
      replaces: current ? { address: current.address, payeeName: current.payee_name } : null,
    },
    row,
  };
}

/** What the emailed link is for. Reads only: this is what GET shows. */
export async function peekConfirmation(token: string, now: Date = new Date()): Promise<ConfirmLookup> {
  return getDb().withService(async (tx) => (await lookup(tx, token, now, false)).lookup);
}

/**
 * Activates the pending ID behind the token (single use) and retires the brand's previous active
 * ID of that scheme in the same transaction. Service role: the token is the proof. Only the
 * confirmation route's POST (after its CSRF check) may call this.
 */
export async function confirmPaymentId(token: string, now: Date = new Date()): Promise<{ state: "confirmed"; payment: PaymentIdView } | { state: "expired" | "used" | "replaced" | "invalid" }> {
  return getDb().withService(async (tx) => {
    const found = await lookup(tx, token, now, true);
    if (found.lookup.state !== "ready" || !found.row) return { state: found.lookup.state === "ready" ? "invalid" : found.lookup.state };
    const row = found.row;
    await tx.query(
      "update public.payment_ids set status = 'retired' where brand_id = $1 and scheme = $2::public.payment_scheme and status = 'active'",
      [row.brand_id, row.scheme],
    );
    const [done] = await tx.query<Row>(
      `update public.payment_ids set status = 'active', confirmed_at = $2::timestamptz
        where id = $1 and status = 'pending' returning ${COLUMNS}`,
      [row.id, now.toISOString()],
    );
    if (!done) return { state: "used" as const };
    return { state: "confirmed" as const, payment: toView(done) };
  });
}

/**
 * Removes payment addresses from owner free text before it goes into a prompt: the pattern for
 * UPI-like addresses plus every address this brand has saved (pending, active or retired, any
 * scheme). Service role. Phase 2 must call this on the brief note (typed or spoken), USP titles
 * and details, custom CTA text, imported captions and fact values, at the point where the prompt
 * is built.
 */
export async function redactForBrand(brandId: string, text: string): Promise<string> {
  const known = UUID_RE.test(brandId)
    ? (await getDb().withService((tx) => tx.query<{ address: string }>("select address from public.payment_ids where brand_id = $1", [brandId]))).map((r) => r.address)
    : [];
  return redactPaymentIds(text, { known });
}
