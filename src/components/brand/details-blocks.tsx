import { ensureContactsImported, listContacts } from "@/lib/contacts/service";
import { getSettings } from "@/lib/memory/settings";
import { currencyForCountry } from "@/lib/usps/currency";
import { ensureUspsSeeded, listUsps } from "@/lib/usps/service";
import { ContactsSection } from "./contacts-section";
import { UspsSection } from "./usps-section";

/**
 * Server components for "Your selling points" and "How customers reach you". A brand with none
 * yet is filled once from its facts and profile (cheap, idempotent, no network); a failure there
 * only leaves the list empty.
 */

export async function UspsBlock({ userId, brandId }: { userId: string; brandId: string }) {
  try {
    await ensureUspsSeeded(userId, brandId);
  } catch (e) {
    console.error("[brand] could not suggest selling points", e);
  }
  const [usps, settings] = await Promise.all([listUsps(userId, brandId), getSettings(userId, brandId)]);
  return <UspsSection brandId={brandId} usps={usps} defaultCurrency={currencyForCountry(settings.form.country)} />;
}

export async function ContactsBlock({ userId, brandId }: { userId: string; brandId: string }) {
  try {
    await ensureContactsImported(userId, brandId);
  } catch (e) {
    console.error("[brand] could not fill contact details", e);
  }
  const [contacts, settings] = await Promise.all([listContacts(userId, brandId), getSettings(userId, brandId)]);
  return <ContactsSection brandId={brandId} contacts={contacts} country={settings.form.country || null} />;
}
