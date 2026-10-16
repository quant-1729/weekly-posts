import Link from "next/link";
import { redirect } from "next/navigation";
import { HomeComposer } from "@/components/home/home-composer";
import { RecentPosts } from "@/components/home/recent-posts";
import { primaryButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { listPosts } from "@/lib/posts/history";
import { loadQueueView } from "@/lib/queue/view";
import { brandTimezone } from "@/lib/weekly/schedule";

export const dynamic = "force-dynamic";

const RECENT_COUNT = 3;

/** Part of the day in the brand's time zone, for the greeting. */
function greetingFor(name: string, timezone: string, now: Date): string {
  const t = s.home.greeting;
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  } catch {
    return t.plain;
  }
  if (!Number.isFinite(hour)) return t.plain;
  const line = hour < 12 ? t.morning : hour < 18 ? t.afternoon : t.evening;
  return line.replace("{name}", name);
}

/**
 * Home: where the owner lands after signing in. A greeting, one box to describe the post they want (it opens
 * "Create a post" with the words filled in), the next scheduled post, and the last few posts. Nothing else.
 */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const now = new Date();
  const timezone = (await brandTimezone(brand.id)) ?? "UTC";
  const [queue, recent] = await Promise.all([loadQueueView(user.id, brand.id, now), listPosts(user.id, brand.id, { limit: RECENT_COUNT })]);
  const next = queue.upcoming[0]?.items[0] ?? null;
  const t = s.home;

  return (
    <section className="mx-auto w-full max-w-page-md pb-6" aria-labelledby="home-title">
      <h1 id="home-title" className="sr-only">
        {t.title}
      </h1>
      <div className="mt-[clamp(8px,5vh,48px)]">
        <p className="text-ui text-desc">{greetingFor(brand.name, timezone, now)}</p>
        <HomeComposer brandId={brand.id} />
      </div>

      {next && (
        <div data-next-post className="mt-8 flex items-center justify-between gap-4 overflow-hidden rounded-card bg-linear-to-r from-hero-from via-hero-via to-well px-5 py-4 max-md:px-4">
          <div className="min-w-0">
            <h2 className="break-words text-[17px] font-medium leading-6 text-title md:text-banner">{t.nextTitle.replace("{when}", next.when)}</h2>
            <p className="mt-0.5 break-words text-ui text-sub">
              {(next.headline ? t.nextLine.replace("{headline}", next.headline) : t.nextLineNoHeadline).replace("{channel}", next.channelLabel)}
            </p>
          </div>
          <Link href="/week" className={`${primaryButton} shrink-0`}>
            {t.openQueue}
          </Link>
        </div>
      )}

      <RecentPosts posts={recent.posts} />
    </section>
  );
}
