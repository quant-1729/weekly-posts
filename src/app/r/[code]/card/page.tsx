import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { loadCard, mailHref, mapsHref, telHref } from "@/lib/shortlinks/card";

/** Public card (no sign-in): where a short link lands when the business has no website or link set. */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer-when-downgrade" };

const linkClass = "inline-block py-2 text-base font-medium text-stone-900 underline";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-stone-500">{label}</h2>
      <ul className="mt-1 space-y-1">{children}</ul>
    </section>
  );
}

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const card = await loadCard(code);
  if (!card) notFound();
  const empty = !card.phones.length && !card.emails.length && !card.addresses.length && !card.hours.length;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] space-y-5 bg-white px-4 py-8 md:max-w-[640px] md:px-10 md:py-12">
      <div>
        <h1 className="text-2xl font-bold">{card.businessName}</h1>
        {card.city ? <p className="mt-1 text-stone-600">{card.city}</p> : null}
      </div>
      {card.phones.length > 0 && (
        <Row label="Phone">
          {card.phones.map((v) => {
            const href = telHref(v);
            return <li key={v}>{href ? <a className={linkClass} href={href}>{v}</a> : <span>{v}</span>}</li>;
          })}
        </Row>
      )}
      {card.emails.length > 0 && (
        <Row label="Email">
          {card.emails.map((v) => {
            const href = mailHref(v);
            return <li key={v}>{href ? <a className={linkClass} href={href}>{v}</a> : <span>{v}</span>}</li>;
          })}
        </Row>
      )}
      {card.addresses.length > 0 && (
        <Row label="Address">
          {card.addresses.map((v) => (
            <li key={v}>
              <a className={linkClass} href={mapsHref(v)} target="_blank" rel="noopener noreferrer">{v}</a>
            </li>
          ))}
        </Row>
      )}
      {card.hours.length > 0 && (
        <Row label="Opening hours">
          {card.hours.map((v) => (
            <li key={v} className="text-stone-800">{v}</li>
          ))}
        </Row>
      )}
      {empty ? <p className="text-stone-600">Contact details are not available yet.</p> : null}
    </main>
  );
}
