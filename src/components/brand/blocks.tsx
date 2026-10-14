import { Suspense } from "react";
import { samePalette } from "@/lib/brand/colors";
import { getDb } from "@/lib/db";
import { availableFontFaces } from "@/lib/kit/fonts";
import { getBrandKit } from "@/lib/kit/service";
import { getLogoInfo, textLogoSvg } from "@/lib/logo";
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
import { KeepMyLookCard } from "./keep-look-card";
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

/** The business name as posts show it, and its text logo drawn from the saved kit (null if it cannot be drawn). */
async function nameAndTextLogo(userId: string, brandId: string, kit: Awaited<ReturnType<typeof getBrandKit>>) {
  const [row] = await getDb().withUser(userId, (tx) => tx.query<{ name: string }>("select name from public.brands where id = $1", [brandId]));
  const name = row?.name ?? "";
  try {
    return { name, svg: await textLogoSvg(name, kit) };
  } catch (e) {
    console.warn("[brand] could not draw the text logo", e instanceof Error ? e.message : e);
    return { name, svg: null };
  }
}

export async function LookBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const look = await getLookBase(userId, brandId);
  const kit = await getBrandKit(userId, brandId);
  const [logo, text] = await Promise.all([getLogoInfo(userId, brandId, look.logoPath), nameAndTextLogo(userId, brandId, kit)]);
  return (
    <div className="space-y-5">
      {/* "Keep my look / Try a fresh look" (C-17): reads only when the owner taps the button. */}
      <KeepMyLookCard brandId={brandId} />
      <Suspense fallback={null}>
        <WebsiteLookExtras userId={userId} brandId={brandId} hasLogo={look.logoPath !== null} colors={look.colors} />
      </Suspense>
      <LookPanel
        brandId={brandId}
        logoPath={look.logoPath}
        logoPalette={look.logoPalette}
        kit={kit}
        logo={logo}
        businessName={text.name}
        fontFaces={availableFontFaces()}
        textLogoSvg={text.svg}
      />
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
  return <MascotCard brandId={brandId} reason={card.eligibility.reason} active={card.active} inPosts={card.inPosts} colors={card.colors} />;
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
