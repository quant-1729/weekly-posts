import { getOverview } from "@/lib/queries/overview";
import { fmtUsd } from "@/lib/format";
import { PageTitle, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requireAdmin();
  const o = await getOverview();
  return (
    <>
      <PageTitle title="Overview" hint="Live numbers from the main app database. Today is the UTC day." />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <Stat label="Active sessions now" value={o.active_sessions} sub="seen in the last 15 minutes" />
        <Stat label="Sign-ins today" value={o.sign_ins_today} />
        <Stat label="Users" value={o.users} />
        <Stat label="Brands" value={o.brands} />
        <Stat label="AI spend today" value={fmtUsd(o.spend_today)} />
        <Stat label="AI spend, 7 days" value={fmtUsd(o.spend_7d)} />
        <Stat label="AI spend, 30 days" value={fmtUsd(o.spend_30d)} />
        <Stat label="Errors, 24 hours" value={o.errors_24h} sub="failed activity events and AI calls" />
        <Stat label="Posts made, 7 days" value={o.posts_made_7d} />
        <Stat label="Posts published, 7 days" value={o.posts_published_7d} />
        <Stat label="Posts failed, 7 days" value={o.posts_failed_7d} />
        <Stat label="Research runs, 7 days" value={o.research_runs_7d} />
      </div>
    </>
  );
}
