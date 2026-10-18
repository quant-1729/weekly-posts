import Link from "next/link";
import { redirect } from "next/navigation";
import { QueueSettingsScreen } from "@/components/queue/queue-settings";
import { linkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { loadQueueView } from "@/lib/queue/view";

export const dynamic = "force-dynamic";

/** Queue settings: a child page of the Queue (reached by the settings icon next to "Coming up"). */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const queue = await loadQueueView(user.id, brand.id);

  return (
    <section className="mx-auto w-full max-w-page-xl space-y-6">
      {/* The top bar names the page; the heading stays for screen readers. */}
      <div>
        <Link href="/week" className={linkButton} data-back-to-queue>
          {s.queue.settingsPage.back}
        </Link>
        <h1 className="sr-only">{s.queue.sections.settings}</h1>
      </div>
      <QueueSettingsScreen initial={queue} />
    </section>
  );
}
