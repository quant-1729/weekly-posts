import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/account/account-panel";
import { BrandNav } from "@/components/brand/brand-nav";
import { BrandSection } from "@/components/brand/section";
import { DatesBlock, FactsBlock, LookBlock, SettingsBlock } from "@/components/brand/blocks";
import { ContactsBlock, UspsBlock } from "@/components/brand/details-blocks";
import { CompetitorsBlock } from "@/components/brand/competitors-block";
import { FaceBlock } from "@/components/brand/face-block";
import { PaymentBlock } from "@/components/brand/payment-block";
import { linkButton } from "@/components/ui";
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
    <section className="mx-auto w-full max-w-page-lg">
      <div className="mb-1">
        <h1 className="sr-only">{t.title}</h1>
        <p className="text-[14px] leading-5 text-desc">{t.intro}</p>
        {/* Phones have four tabs; the mascot is reached from here (Connections is in the menu). */}
        <p className="mt-2 flex gap-4 md:hidden" data-brand-more>
          <span className="sr-only">{s.connections.brandLinks.label}:</span>
          <Link href="/connections" className={linkButton}>
            {s.connections.brandLinks.connections}
          </Link>
          <Link href="/mascot" className={linkButton}>
            {s.connections.brandLinks.mascot}
          </Link>
        </p>
      </div>
      <BrandNav
        pills={[
          { id: "facts", label: t.pills.facts },
          { id: "usps", label: t.pills.usps },
          { id: "contacts", label: t.pills.contacts },
          { id: "voice", label: t.pills.voice },
          { id: "look", label: t.pills.look },
          { id: "mascot", label: t.pills.mascot },
          { id: "uploads", label: t.pills.uploads },
          { id: "dates", label: t.pills.dates },
          { id: "payment", label: t.pills.payment },
          { id: "competitors", label: t.pills.competitors },
          { id: "settings", label: t.pills.settings },
          { id: "data", label: t.pills.data },
        ]}
      />
      <div className="space-y-4">
      <BrandSection id="facts" title={t.sections.facts} defaultOpen>
        <FactsBlock {...ids} />
      </BrandSection>
      <BrandSection id="usps" title={s.usps.title}>
        <UspsBlock {...ids} />
      </BrandSection>
      <BrandSection id="contacts" title={s.contacts.title}>
        <ContactsBlock {...ids} />
      </BrandSection>
      <BrandSection id="voice" title={t.sections.voice}>
        <VoiceSection {...ids} />
      </BrandSection>
      <BrandSection id="look" title={t.sections.look}>
        <LookBlock {...ids} />
      </BrandSection>
      <BrandSection id="mascot" title={s.faces.title}>
        <FaceBlock {...ids} />
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
      <BrandSection id="competitors" title={s.ideas.competitors.title}>
        <CompetitorsBlock {...ids} />
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
