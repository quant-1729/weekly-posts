import Link from "next/link";
import { Mark } from "@/components/app-shell/nav-icon";
import { alertClass, linkButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";
import { HOLIDAY_DATA_ATTRIBUTION } from "@/lib/occasions";

/** Public terms and privacy page (no sign-in). Draft text: to be reviewed by a lawyer before launch. */
export default function Page() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-page-sm space-y-6 px-4 py-6 md:px-6 md:py-12">
      <Link href="/" className="flex items-center gap-2 text-[15px] font-medium leading-5 text-title">
        <Mark />
        {s.appName}
      </Link>
      <div>
        <h1 className="text-banner text-title">{s.terms.title}</h1>
        <p className={`mt-2 inline-block ${alertClass("warn")} !py-1 text-[13px] leading-[18px]`}>{s.terms.draftNote}</p>
        <p className="mt-3 text-[14px] leading-5 text-desc">{s.terms.intro}</p>
      </div>
      <section>
        <h2 className="text-card-title text-title">{s.terms.mascotHeading}</h2>
        <p className="mt-1 text-[14px] leading-[22px] text-sub">{s.terms.mascotBody}</p>
      </section>
      <section>
        <h2 className="text-card-title text-title">{s.terms.factsHeading}</h2>
        <p className="mt-1 text-[14px] leading-[22px] text-sub">{s.terms.factsBody}</p>
      </section>
      <section>
        <h2 className="text-card-title text-title">{s.terms.deleteHeading}</h2>
        <p className="mt-1 text-[14px] leading-[22px] text-sub">{s.terms.deleteBody}</p>
      </section>
      <section id="privacy" className="space-y-3">
        <h2 className="text-card-title text-title">{s.terms.privacyHeading}</h2>
        {s.terms.privacy.map((p) => (
          <div key={p.heading}>
            <h3 className="text-ui text-title">{p.heading}</h3>
            <p className="mt-0.5 text-[14px] leading-[22px] text-sub">{p.body}</p>
          </div>
        ))}
      </section>
      <section>
        <h2 className="text-card-title text-title">{s.terms.holidayHeading}</h2>
        <p className="mt-1 text-[14px] leading-[22px] text-sub">{HOLIDAY_DATA_ATTRIBUTION}</p>
        <p className="mt-1 text-[14px] leading-[22px] text-sub">
          <a href="https://db-ip.com" rel="noopener noreferrer" className="underline">
            {s.terms.geoAttribution}
          </a>{" "}
          (CC BY 4.0)
        </p>
      </section>
      <Link href="/" className={linkButton}>
        {s.terms.backToApp}
      </Link>
    </main>
  );
}
