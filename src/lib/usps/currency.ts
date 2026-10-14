// A default currency for a country, only to pre-fill forms and to read prices from facts. The owner
// can always change it. Pure; safe in the browser.

const BY_COUNTRY: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR',
  FI: 'EUR', GR: 'EUR', LU: 'EUR', MT: 'EUR', CY: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', HR: 'EUR',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY', UA: 'UAH',
  RU: 'RUB', IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', ID: 'IDR', MY: 'MYR', SG: 'SGD', TH: 'THB',
  VN: 'VND', PH: 'PHP', JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD', TW: 'TWD', AU: 'AUD', NZ: 'NZD',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', IL: 'ILS', EG: 'EGP', ZA: 'ZAR', NG: 'NGN',
  KE: 'KES', GH: 'GHS', MA: 'MAD',
};

/** ISO 4217 code for an ISO 3166-1 alpha-2 country; USD when unknown. */
export function currencyForCountry(country: string | null | undefined): string {
  return BY_COUNTRY[(country ?? '').toUpperCase()] ?? 'USD';
}

/** Currency symbols and words people type before or after a price, to the code they mean. */
const SYMBOLS: Array<[RegExp, string | ((country: string | null) => string)]> = [
  [/^£/, 'GBP'],
  [/^€/, 'EUR'],
  [/^₹/, 'INR'],
  [/^(?:rs\.?|inr)\s*/i, 'INR'],
  [/^¥/, (c) => (c === 'CN' ? 'CNY' : 'JPY')],
  [/^₩/, 'KRW'],
  [/^R\$/, 'BRL'],
  [/^(?:aed|dhs?\.?)\s*/i, 'AED'],
  [/^(?:usd|us\$)\s*/i, 'USD'],
  [/^(?:gbp)\s*/i, 'GBP'],
  [/^(?:eur)\s*/i, 'EUR'],
  [/^\$/, (c) => ({ CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', MX: 'MXN' } as Record<string, string>)[c ?? ''] ?? 'USD'],
];

export interface ParsedPrice {
  amount: number;
  currency: string;
}

/**
 * Reads a price written as free text: "£4.50", "$12", "Rs 120", "INR 1,200", "9.99 EUR".
 * Returns null unless the whole text is one price (never guesses from longer sentences).
 */
export function parsePrice(text: string, country: string | null = null): ParsedPrice | null {
  const t = text.trim();
  const num = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
  const toNumber = (n: string) => Number(n.replace(/,/g, ''));
  for (const [re, cur] of SYMBOLS) {
    const m = re.exec(t);
    if (!m) continue;
    const rest = t.slice(m[0].length).trim();
    const full = new RegExp(`^${num}$`).exec(rest);
    if (!full) continue;
    const amount = toNumber(full[1]);
    if (!(amount > 0)) return null;
    return { amount, currency: typeof cur === 'function' ? cur(country) : cur };
  }
  const suffix = new RegExp(String.raw`^${num}\s*([A-Za-z]{3})$`).exec(t);
  if (suffix && /^(USD|GBP|EUR|INR|AUD|CAD|NZD|AED|SGD|JPY|BRL|ZAR|CHF)$/i.test(suffix[2])) {
    const amount = toNumber(suffix[1]);
    return amount > 0 ? { amount, currency: suffix[2].toUpperCase() } : null;
  }
  return null;
}
