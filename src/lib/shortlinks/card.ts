import { getDb } from "@/lib/db";
import { POST_CODE_RE } from "./link";

// The public card shown when a brand has no website or link destination (Req 19).
// Only what the owner already put in their brand memory as contact facts. Nothing private:
// no prices, offers, owner email or user ids.

export interface CardView {
  businessName: string;
  city: string;
  phones: string[];
  emails: string[];
  addresses: string[];
  hours: string[];
}

const MAX_PER_KIND = 3;

export async function loadCard(rawCode: string): Promise<CardView | null> {
  const code = rawCode.trim().toLowerCase();
  if (!POST_CODE_RE.test(code)) return null;
  return getDb().withService(async (tx) => {
    const [row] = await tx.query<{ brand_id: string; business_name: string | null; brand_name: string; city: string | null }>(
      `select p.brand_id::text as brand_id, m.business_name, b.name as brand_name, m.city
         from public.posts p
         join public.brands b on b.id = p.brand_id
         left join public.brand_memory m on m.brand_id = p.brand_id
        where p.post_code = $1`,
      [code],
    );
    if (!row) return null;
    const facts = await tx.query<{ kind: string; value: string }>(
      `select kind::text as kind, value from public.brand_facts
        where brand_id = $1 and active and kind in ('phone', 'email', 'address', 'hours')
        order by created_at, id`,
      [row.brand_id],
    );
    const of = (kind: string) => facts.filter((f) => f.kind === kind).map((f) => f.value.trim()).filter(Boolean).slice(0, MAX_PER_KIND);
    return {
      businessName: (row.business_name ?? "").trim() || row.brand_name,
      city: (row.city ?? "").trim(),
      phones: of("phone"),
      emails: of("email"),
      addresses: of("address"),
      hours: of("hours"),
    };
  });
}

/** `tel:` link for a phone number, or null when it does not look like one. */
export function telHref(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 5 ? `tel:${digits}` : null;
}

export function mailHref(value: string): string | null {
  const v = value.trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) ? `mailto:${v}` : null;
}

export function mapsHref(value: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
}
