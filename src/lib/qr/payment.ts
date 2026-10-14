// Payment QR strings (PRD v3 B-4.1, change C-10). Pure: no database.
//
// A payment QR encodes the payment address itself, not a short link: payment apps read the QR
// directly and will not follow a web redirect. Only UPI exists now. Each scheme is one entry in
// PAYMENT_SCHEMES (address check, URI builder, parser, countries it serves); PIX, PayNow,
// PromptPay and EPC/SEPA are added as more entries, with a matching value in
// `public.payment_scheme` (migration) and a check on `payment_ids.address`.

export const PAYMENT_SCHEME_IDS = ["upi"] as const;
export type PaymentSchemeId = (typeof PAYMENT_SCHEME_IDS)[number];

/** Same pattern as the check constraint on public.payment_ids (migration 0014). */
export const UPI_ADDRESS_RE = /^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9]{1,63}$/;

export const PAYEE_NAME_MAX = 60;
/** A sanity cap on a fixed amount (7 digits); the owner sets it, the payer's app enforces its own limits. */
export const MAX_PAYMENT_AMOUNT = 9_999_999.99;

export interface PaymentUriInput {
  address: string;
  payeeName: string;
  /** Only when the owner set a fixed amount. */
  amount?: number;
}

export interface ParsedPaymentUri {
  address: string;
  payeeName: string;
  currency: string;
  amount: number | null;
}

export interface PaymentSchemeDef {
  id: PaymentSchemeId;
  /** ISO 3166-1 countries where this scheme is offered. */
  countries: readonly string[];
  currency: string;
  /** Short name for the UI. */
  label: string;
  /** Format hint under the ID field. */
  addressHint: string;
  validateAddress(address: string): boolean;
  buildUri(input: PaymentUriInput): string;
  parseUri(uri: string): ParsedPaymentUri | null;
}

export class PaymentFormatError extends Error {
  constructor(
    public readonly field: "address" | "payeeName" | "amount",
    message: string,
  ) {
    super(message);
    this.name = "PaymentFormatError";
  }
}

/** encodeURIComponent plus the characters it leaves alone but a URI query is safer without. */
function pct(v: string): string {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Control characters, zero-width and bidi marks, line/paragraph separators.
function isStripped(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** Trim, collapse whitespace, drop control characters. Returns "" when nothing is left. */
export function cleanPayeeName(raw: string): string {
  let out = "";
  for (const ch of raw.normalize("NFC")) out += isStripped(ch.codePointAt(0)!) ? " " : ch;
  return out.replace(/\s+/g, " ").trim();
}

export function validPayeeName(name: string): boolean {
  const n = cleanPayeeName(name);
  return n.length >= 1 && [...n].length <= PAYEE_NAME_MAX && n === name.trim().replace(/\s+/g, " ");
}

function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT_AMOUNT) {
    throw new PaymentFormatError("amount", "The amount must be more than zero");
  }
  return (Math.round(amount * 100) / 100).toFixed(2);
}

const UPI: PaymentSchemeDef = {
  id: "upi",
  countries: ["IN"],
  currency: "INR",
  label: "UPI",
  addressHint: "name@bank",
  validateAddress: (address) => UPI_ADDRESS_RE.test(address),
  buildUri({ address, payeeName, amount }) {
    if (!UPI_ADDRESS_RE.test(address)) throw new PaymentFormatError("address", "That is not a UPI ID (name@bank)");
    const name = cleanPayeeName(payeeName);
    if (!name || [...name].length > PAYEE_NAME_MAX) throw new PaymentFormatError("payeeName", "Enter the name of the payee");
    // The address has only characters that need no escaping (letters, digits . _ - and one @),
    // and apps expect pa=name@bank as it is. The name can hold spaces and any script.
    let uri = `upi://pay?pa=${address}&pn=${pct(name)}&cu=INR`;
    if (amount !== undefined) uri += `&am=${formatAmount(amount)}`;
    return uri;
  },
  parseUri(uri) {
    if (!uri.startsWith("upi://pay?")) return null;
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(uri.slice("upi://pay?".length));
    } catch {
      return null;
    }
    const pa = params.get("pa");
    if (!pa) return null;
    const am = params.get("am");
    return { address: pa, payeeName: params.get("pn") ?? "", currency: params.get("cu") ?? "", amount: am === null ? null : Number(am) };
  },
};

export const PAYMENT_SCHEMES: Record<PaymentSchemeId, PaymentSchemeDef> = { upi: UPI };

export function isPaymentScheme(v: unknown): v is PaymentSchemeId {
  return typeof v === "string" && (PAYMENT_SCHEME_IDS as readonly string[]).includes(v);
}

/** The payment schemes offered to a brand in this country (empty: show "coming soon" and a payment link QR). */
export function schemesForCountry(country: string | null | undefined): PaymentSchemeDef[] {
  const c = (country ?? "").toUpperCase();
  return Object.values(PAYMENT_SCHEMES).filter((d) => d.countries.includes(c));
}

/** The exact text a payment QR must hold. Throws PaymentFormatError for a bad address, name or amount. */
export function buildPaymentUri(scheme: PaymentSchemeId, input: PaymentUriInput): string {
  return PAYMENT_SCHEMES[scheme].buildUri(input);
}

export function validatePaymentAddress(scheme: PaymentSchemeId, address: string): boolean {
  return PAYMENT_SCHEMES[scheme].validateAddress(address);
}

export function parsePaymentUri(scheme: PaymentSchemeId, uri: string): ParsedPaymentUri | null {
  return PAYMENT_SCHEMES[scheme].parseUri(uri);
}
