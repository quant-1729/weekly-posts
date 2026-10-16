import { s } from "@/lib/i18n/strings";

export default function Page() {
  return (
    <section className="mx-auto w-full max-w-page-sm">
      <h1 className="text-section text-title">{s.plan.title}</h1>
      <p className="mt-1 text-[14px] leading-5 text-desc">{s.plan.comingSoon}</p>
    </section>
  );
}
