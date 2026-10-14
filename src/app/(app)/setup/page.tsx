import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { countryOptions } from "@/lib/setup/countries";
import { loadSetupResume } from "@/lib/setup/details";
import { languageOptions } from "@/lib/setup/languages";
import { regionsByCountry, timezonesByCountry } from "@/lib/setup/regions";
import { emptyAnswers } from "@/lib/setup/draft";
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

  // A reload mid-setup resumes where the owner left off (the draft is saved after every screen).
  const resume = await loadSetupResume(user.id);
  const initial = resume
    ? {
        brandId: resume.brandId,
        step: resume.draft?.step ?? ("business" as const),
        answers: resume.draft?.answers ?? emptyAnswers(),
        logoPath: resume.logoPath,
      }
    : undefined;

  // Names and lists are made here, on the server, so the browser needs no big datasets.
  return (
    <SetupWizard
      countries={countryOptions()}
      regions={regionsByCountry()}
      zonesByCountry={timezonesByCountry()}
      languages={languageOptions()}
      initial={initial}
    />
  );
}
