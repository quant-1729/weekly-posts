import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanForm } from "@/components/plan/plan-form";
import { StageBar } from "@/components/plan/stage-bar";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { listPlans } from "@/lib/plans/service";
import { loadBrandTimezone, localDateOf } from "@/lib/queue";
import { currencyForCountry } from "@/lib/usps/currency";

export const dynamic = "force-dynamic";

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Plan a week (stage 1 of 3): the owner's offers for each day, then the design studio, then automation. */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");
  const tz = await loadBrandTimezone(user.id, brand.id);
  const today = localDateOf(new Date(), tz);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const nextMonday = addDays(today, 7 - dow);
  const starts = [
    { value: addDays(today, 1), label: `Next 7 days (from ${label(addDays(today, 1))})` },
    { value: nextMonday, label: `Week of ${label(nextMonday)}` },
    { value: addDays(nextMonday, 7), label: `Week of ${label(addDays(nextMonday, 7))}` },
  ];
  const [photos, plans, mem] = await Promise.all([
    getDb().withUser(user.id, (tx) =>
      tx.query<{ id: string; storage_path: string; description: string | null; usable: boolean | null; has_people: boolean | null }>(
        "select id::text as id, storage_path, description, usable, has_people from public.photos where brand_id = $1 and kind = 'photo' and storage_path is not null order by created_at desc, id desc limit 30",
        [brand.id],
      ),
    ),
    listPlans(user.id, brand.id),
    getDb().withUser(user.id, (tx) => tx.query<{ country: string | null }>("select country from public.brand_memory where brand_id = $1", [brand.id])),
  ]);
  return (
    <section className="mx-auto w-full max-w-page-xl">
      <div className="mb-4">
        <h1 className="text-section text-title">Plan a week of offers</h1>
        <p className="mt-1 text-[14px] leading-5 text-desc">Set an offer for each day once. We design every post, you polish the look in the studio, and they go out on their own.</p>
      </div>
      <StageBar current="requirements" />
      <PlanForm brandId={brand.id} photos={photos.map((p) => ({ id: p.id, src: `/api/files/${p.storage_path}`, description: p.description ?? "", usable: p.usable, hasPeople: p.has_people }))} starts={starts} currency={currencyForCountry(mem[0]?.country ?? null)} />
      {plans.length ? (
        <div className="mt-8">
          <h2 className="mb-2 text-[15px] font-semibold text-title">Your plans</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => (
              <li key={p.id}>
                <Link href={p.status === "draft" ? `/plan/${p.id}/design` : `/plan/${p.id}`} className="block rounded-2xl border border-line-light bg-white p-3 hover:shadow-sm">
                  <span className="block text-[14px] font-medium text-ink">{p.days[0] ? `${p.days[0].label} – ${p.days[p.days.length - 1].label}` : p.title}</span>
                  <span className="block text-[12.5px] text-desc">
                    {p.days.length} posts · {p.status === "scheduled" ? "Scheduled" : p.status === "designed" ? "Designed, not scheduled" : "Design not finished"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
