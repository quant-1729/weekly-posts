import Link from "next/link";
import { Mark } from "@/components/app-shell/nav-icon";
import { AdminToolbar } from "@/components/admin/toolbar";
import { ConnectionsPanel, CostPanel, DeletionsPanel, EmailPanel, OverviewPanel, PostsPanel, QueuePanel, ResearchPanel, when } from "@/components/admin/panels";
import { requireAdmin } from "@/lib/admin/access";
import { getAdminMetrics } from "@/lib/admin/metrics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false, follow: false } };

/**
 * Read-only monitoring for the operators (emails in ADMIN_EMAILS). Signed out goes to /login; anyone
 * else gets a 404. Numbers are read only after the check, across all brands, with no payment IDs, tokens
 * or post text.
 */
export default async function AdminPage() {
  const admin = await requireAdmin();
  const now = new Date();
  const m = await getAdminMetrics(admin, now);

  return (
    <main className="mx-auto w-full max-w-page-xl space-y-4 overflow-x-hidden px-4 py-3 md:px-6">
      <div className="flex h-[52px] items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-medium leading-5 text-title">
          <Mark />
          Weekly Posts
        </Link>
        <Link href="/" className="inline-flex min-h-11 items-center text-ui text-sub underline underline-offset-4 hover:text-title">
          Back to the app
        </Link>
      </div>
      <header className="space-y-2">
        <h1 className="text-banner text-title">Admin</h1>
        <p className="text-[14px] leading-5 text-desc">Read-only view of all brands. Times are UTC.</p>
        <AdminToolbar updatedAt={when(m.generatedAt)} />
      </header>
      <OverviewPanel m={m} />
      <CostPanel m={m} />
      <PostsPanel m={m} />
      <QueuePanel m={m} />
      <ResearchPanel m={m} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ConnectionsPanel m={m} />
        <DeletionsPanel m={m} now={now.getTime()} />
      </div>
      <EmailPanel m={m} />
    </main>
  );
}
