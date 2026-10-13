import { Suspense } from "react";
import { samePalette } from "@/lib/brand/colors";
import { listFacts } from "@/lib/memory/facts";
import { listOwnerDates } from "@/lib/occasions/owner-dates";
import { getMascotCard } from "@/lib/mascot/service";
import { getLookBase, getWebsiteAssets, themePalette } from "@/lib/memory/look";
import { isRegulatedBrand, type RegulatedChoice } from "@/lib/memory/schema";
import { getSettings } from "@/lib/memory/settings";
import { getUpcoming } from "@/lib/memory/upcoming";
import { getWebsiteInfo } from "@/lib/memory/website";
import { countryOptions } from "@/lib/setup/countries";
import { languageOptions } from "@/lib/setup/languages";
import { regionsByCountry, timezonesByCountry } from "@/lib/setup/regions";
import { DatesPanel } from "./dates-section";
import { FactsSection } from "./facts-section";
import { LookPanel, ThemeColorOffer, WebsiteLogoOffer } from "./look-section";
import { MascotCard } from "./mascot-card";
import { SettingsPanel } from "./settings-section";
import { UpcomingList } from "./upcoming-list";

/** Server components that load one section's data and hand it to the client panels. */

export async function FactsBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const [facts, settings, website] = await Promise.all([listFacts(userId, brandId), getSettings(userId, brandId), getWebsiteInfo(userId, brandId)]);
  const regulated = isRegulatedBrand((settings.form.regulated || null) as RegulatedChoice | null, settings.detected);
  return <FactsSection brandId={brandId} facts={facts} regulated={regulated} website={website} />;
}

/** Reads the website again for its logo and theme colour (kept in memory), without holding up the page. */
export async function WebsiteLookExtras({ userId, brandId, hasLogo, colors }: { userId: string; brandId: string; hasLogo: boolean; colors: Parameters<typeof samePalette>[0] }) {
  const assets = await getWebsiteAssets({ userId, brandId });
  if (!assets) return null;
  const theme = themePalette(assets.themeColor);
  const offerLogo = !hasLogo && assets.logoCandidates.length > 0;
  const offerTheme = theme !== null && !samePalette(theme, colors);
  if (!offerLogo && !offerTheme) return null;
  return (
    <div className="space-y-3">
      {offerLogo && <WebsiteLogoOffer brandId={brandId} />}
      {offerTheme && theme && <ThemeColorOffer brandId={brandId} palette={theme} />}
    </div>
  );
}

export async function LookBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const look = await getLookBase(userId, brandId);
  return (
    <div className="space-y-5">
      <Suspense fallback={null}>
        <WebsiteLookExtras userId={userId} brandId={brandId} hasLogo={look.logoPath !== null} colors={look.colors} />
      </Suspense>
      <LookPanel brandId={brandId} logoPath={look.logoPath} colors={look.colors} logoPalette={look.logoPalette} />
    </div>
  );
}

export async function DatesBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const [dates, weeks] = await Promise.all([listOwnerDates(userId, brandId), getUpcoming(userId, brandId)]);
  return (
    <div className="space-y-6">
      <DatesPanel brandId={brandId} dates={dates} />
      <UpcomingList weeks={weeks} />
    </div>
  );
}

/** The "Your mascot" card (V-25): status, link to /mascot, and the "use in posts" switch. */
export async function MascotBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const card = await getMascotCard(userId, brandId);
  return <MascotCard brandId={brandId} reason={card.eligibility.reason} active={card.active} inPosts={card.inPosts} />;
}

export async function SettingsBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const view = await getSettings(userId, brandId);
  return (
    <SettingsPanel
      brandId={brandId}
      initial={view.form}
      detected={view.detected}
      email={view.email}
      websiteUrl={view.websiteUrl}
      countries={countryOptions()}
      regions={regionsByCountry()}
      zonesByCountry={timezonesByCountry()}
      languages={languageOptions()}
    />
  );
}
