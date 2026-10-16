import { getResearchSettings, listCompetitors } from "@/lib/ideas";
import { CompetitorsCard } from "./competitors-card";

/** Server component: loads the brand's competitors and research settings for the "Competitors" card. */
export async function CompetitorsBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const [items, settings] = await Promise.all([listCompetitors(userId, brandId), getResearchSettings(userId, brandId)]);
  return <CompetitorsCard brandId={brandId} items={items} focus={settings.focus ?? ""} researchOn={settings.on} />;
}
