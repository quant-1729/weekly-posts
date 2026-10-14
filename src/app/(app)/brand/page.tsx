import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/account/account-panel";
import { BrandSection } from "@/components/brand/section";
import { DatesBlock, FactsBlock, LookBlock, MascotBlock, SettingsBlock } from "@/components/brand/blocks";
import { ContactsBlock, UspsBlock } from "@/components/brand/details-blocks";
import { PaymentBlock } from "@/components/brand/payment-block";
import { UploadsSection, VoiceSection } from "@/components/uploads/uploads-section";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { paymentCopy } from "@/lib/payments/copy";

export const dynamic = "force-dynamic";
// "Read my website again" runs as a server action of this page and can take up to a minute.
export const maxDuration = 60;

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const t = s.brandV2;
  const ids = { userId: user.id, brandId: brand.id };
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{t.title}</h1>
        <p className="text-stone-600">{t.intro}</p>
        {/* Phones have four tabs; Connections and the mascot are reached from here. The wider layouts list them in the navigation. */}
        <p className="mt-2 flex gap-4 md:hidden" data-brand-more>
          <span className="sr-only">{s.connections.brandLinks.label}:</span>
          <Link href="/connections" className="min-h-11 py-2 font-medium underline">
            {s.connections.brandLinks.connections}
          </Link>
          <Link href="/mascot" className="min-h-11 py-2 font-medium underline">
            {s.connections.brandLinks.mascot}
          </Link>
        </p>
      </div>
      <BrandSection id="facts" title={t.sections.facts} defaultOpen>
        <FactsBlock {...ids} />
      </BrandSection>
      <BrandSection id="usps" title={s.usps.title}>
        <UspsBlock {...ids} />
      </BrandSection>
      <BrandSection id="contacts" title={s.contacts.title}>
        <ContactsBlock {...ids} />
      </BrandSection>
      {/* The facts stay full width; the other sections sit two to a row on desktop. */}
      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <BrandSection id="voice" title={t.sections.voice}>
        <VoiceSection {...ids} />
      </BrandSection>
      <BrandSection id="look" title={t.sections.look}>
        <LookBlock {...ids} />
      </BrandSection>
      <BrandSection id="mascot" title={s.mascot.brandLinkTitle}>
        <MascotBlock {...ids} />
      </BrandSection>
      <BrandSection id="uploads" title={t.sections.uploads}>
        <UploadsSection {...ids} voice={false} heading={false} />
      </BrandSection>
      <BrandSection id="dates" title={t.sections.dates}>
        <DatesBlock {...ids} />
      </BrandSection>
      <BrandSection id="payment" title={paymentCopy.card.title}>
        <PaymentBlock {...ids} />
      </BrandSection>
      <BrandSection id="settings" title={t.sections.settings}>
        <SettingsBlock {...ids} />
      </BrandSection>
      <BrandSection id="data" title={s.account.sectionTitle}>
        <AccountPanel />
      </BrandSection>
      </div>
    </section>
  );
}
