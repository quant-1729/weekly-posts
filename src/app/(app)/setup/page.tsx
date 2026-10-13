import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { countryOptions } from "@/lib/setup/countries";
import { languageOptions } from "@/lib/setup/languages";
import { regionsByCountry, timezonesByCountry } from "@/lib/setup/regions";
import { SetupWizard } from "./setup-wizard";

export const dynamic = "force-dynamic";
// The website read keeps running after the answer is sent (see actions.ts).
export const maxDuration = 60;

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // One business per account: a finished brand goes to the brand page.
  const brand = await getCurrentBrand(user.id);
  if (brand?.setupCompleted) redirect("/brand");

  // Names and lists are made here, on the server, so the browser needs no big datasets.
  return (
    <SetupWizard
      countries={countryOptions()}
      regions={regionsByCountry()}
      zonesByCountry={timezonesByCountry()}
      languages={languageOptions()}
    />
  );
}
