// The brand's side of a research run: the profile fields the prompts use, the competitors and the owner's focus.
// Every owner-typed text is redacted for payment IDs here (CLAUDE.md rule), with the brand's own payment
// addresses passed as `known`, so nothing that reaches a prompt can hold one.

import type { IdeasBrandContext } from "@/lib/ai/prompts/ideas";
import { regulatedGroup } from "@/lib/ai/regulated";
import { getDb } from "@/lib/db";
import { redactPaymentIds } from "@/lib/payments/redact";
import { listCompetitorsForRun } from "./competitors";
import type { Competitor } from "./types";

export interface RunContext {
  brandId: string;
  /** Prompt-ready (redacted) profile. */
  brand: IdeasBrandContext;
  /** Competitors as stored (names and handles are redacted in `brand.competitors`; use these for fetching). */
  competitors: Competitor[];
  timezone: string;
  /** ISO 3166 country code, for the YouTube region; null when unknown. */
  countryCode: string | null;
  researchOn: boolean;
  wordsToAvoid: string[];
  /** The brand's own payment addresses, so tests and callers can prove none reached a prompt. */
  paymentAddresses: string[];
}

interface MemoryRow {
  name: string;
  category: string | null;
  audience: string | null;
  country: string | null;
  city: string | null;
  post_language: string;
  timezone: string;
  regulated: string | null;
  research_focus: string | null;
  research_on: boolean;
  words_to_avoid: string[] | null;
}

function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Reads the brand's profile as the service role (the run is started by the server). Null when the brand does not exist. */
export async function loadRunContext(brandId: string): Promise<RunContext | null> {
  const { mem, addresses } = await getDb().withService(async (tx) => {
    const [mem] = await tx.query<MemoryRow>(
      `select b.name, m.category, m.audience, m.country, m.city, m.post_language, m.timezone, m.regulated::text as regulated,
              m.research_focus, m.research_on, m.words_to_avoid
         from public.brands b join public.brand_memory m on m.brand_id = b.id
        where b.id = $1`,
      [brandId],
    );
    const addresses = await tx.query<{ address: string }>("select address from public.payment_ids where brand_id = $1", [brandId]);
    return { mem, addresses: addresses.map((a) => a.address) };
  });
  if (!mem) return null;
  const competitors = await listCompetitorsForRun(brandId);
  const red = (t: string | null | undefined): string => redactPaymentIds(t ?? "", { known: addresses });
  const redOrNull = (t: string | null | undefined): string | null => {
    const r = red(t).trim();
    return r === "" ? null : r;
  };
  const regulated = (mem.regulated ?? regulatedGroup(mem.category ?? "")) as IdeasBrandContext["regulated"];
  const brand: IdeasBrandContext = {
    name: red(mem.name),
    category: red(mem.category),
    sells: red(mem.category),
    city: redOrNull(mem.city),
    country: countryName(mem.country),
    language: mem.post_language,
    audience: redOrNull(mem.audience),
    regulated,
    competitors: competitors.map((c) => ({ name: red(c.name), website: c.website, instagram: c.instagramHandle })),
    focus: redOrNull(mem.research_focus),
  };
  return {
    brandId,
    brand,
    competitors,
    timezone: mem.timezone || "UTC",
    countryCode: mem.country,
    researchOn: mem.research_on,
    wordsToAvoid: mem.words_to_avoid ?? [],
    paymentAddresses: addresses,
  };
}
