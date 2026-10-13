import { s } from "@/lib/i18n/strings";

export default function Page() {
  return (
    <section>
      <h1 className="mb-2 text-xl font-bold">{s.plan.title}</h1>
      <p className="text-stone-600">{s.plan.comingSoon}</p>
    </section>
  );
}
