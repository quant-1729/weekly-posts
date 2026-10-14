import Link from "next/link";
import { s } from "@/lib/i18n/strings";
import { HOLIDAY_DATA_ATTRIBUTION } from "@/lib/occasions";

/** Public terms and privacy page (no sign-in). Draft text: to be reviewed by a lawyer before launch. */
export default function Page() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] space-y-5 bg-white px-4 py-6 md:max-w-[720px] md:px-10 md:py-12">
      <div>
        <h1 className="text-xl font-bold md:text-3xl">{s.terms.title}</h1>
        <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900">
          {s.terms.draftNote}
        </p>
        <p className="mt-3 text-stone-600">{s.terms.intro}</p>
      </div>
      <section>
        <h2 className="font-semibold">{s.terms.mascotHeading}</h2>
        <p className="text-stone-700">{s.terms.mascotBody}</p>
      </section>
      <section>
        <h2 className="font-semibold">{s.terms.factsHeading}</h2>
        <p className="text-stone-700">{s.terms.factsBody}</p>
      </section>
      <section>
        <h2 className="font-semibold">{s.terms.deleteHeading}</h2>
        <p className="text-stone-700">{s.terms.deleteBody}</p>
      </section>
      <section id="privacy" className="space-y-3">
        <h2 className="text-lg font-bold">{s.terms.privacyHeading}</h2>
        {s.terms.privacy.map((p) => (
          <div key={p.heading}>
            <h3 className="font-semibold">{p.heading}</h3>
            <p className="text-stone-700">{p.body}</p>
          </div>
        ))}
      </section>
      <section>
        <h2 className="font-semibold">{s.terms.holidayHeading}</h2>
        <p className="text-stone-700">{HOLIDAY_DATA_ATTRIBUTION}</p>
      </section>
      <Link href="/" className="inline-block py-2 text-sm text-stone-600 underline">
        {s.terms.backToApp}
      </Link>
    </main>
  );
}
