import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserDetail, getUserTimeline } from "@/lib/queries/users";
import { requireAdmin } from "@/lib/session";
import { fmtTime, fmtUsd, safeHttpUrl } from "@/lib/format";
import { SessionsTable } from "@/components/sessions-table";
import { Badge, Card, PageTitle, Pager, Stat, Table, first, td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const cursor = first((await searchParams).cursor);
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const timeline = await getUserTimeline(id, cursor);
  const { profile, brands, sessions, aiByKind, counts } = detail;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/users" className="underline">
          All users
        </Link>
      </p>
      <PageTitle title={profile.email ?? "(no email)"} hint={`${profile.display_name ? `${profile.display_name} | ` : ""}Signed up ${fmtTime(profile.signed_up)} UTC`} />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Briefs" value={counts.briefs} />
        <Stat label="Posts" value={counts.posts} />
        <Stat label="Approved" value={counts.approved} />
        <Stat label="Scheduled" value={counts.scheduled} />
        <Stat label="Published" value={counts.published} />
        <Stat label="Failed" value={counts.failed} />
        <Stat label="Research runs" value={counts.research_runs} />
        <Stat label="Faces" value={counts.faces} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-base font-medium text-title">Brands</h2>
          <Table head={["Brand", "Role"]} empty={brands.length === 0 ? "No brands." : undefined}>
            {brands.map((b) => (
              <tr key={`${b.name}-${b.role}`}>
                <td className={td}>{b.name}</td>
                <td className={td}>{b.role}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <h2 className="mb-2 text-base font-medium text-title">AI calls by kind</h2>
          <Table head={["Kind", "Calls", "Spend"]} empty={aiByKind.length === 0 ? "No AI calls." : undefined}>
            {aiByKind.map((k) => (
              <tr key={k.kind}>
                <td className={td}>{k.kind}</td>
                <td className={td}>{k.n}</td>
                <td className={td}>{fmtUsd(k.usd)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card className="mb-4">
        <h2 className="mb-2 text-base font-medium text-title">Sessions (latest 25)</h2>
        <SessionsTable rows={sessions} showUser={false} />
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-medium text-title">History, newest first</h2>
        <Table head={["Time (UTC)", "What", "Result", "Brand", "Details"]} empty={timeline.rows.length === 0 ? "Nothing yet." : undefined}>
          {timeline.rows.map((r) => {
            const link = safeHttpUrl(r.link);
            return (
              <tr key={r.id}>
                <td className={td}>{fmtTime(r.ts)}</td>
                <td className={td}>{r.kind}</td>
                <td className={td}>{r.status === "failed" ? <Badge tone="err">failed</Badge> : <Badge tone={r.status === "ok" ? "ok" : "neutral"}>{r.status}</Badge>}</td>
                <td className={td}>{r.brand_name ?? ""}</td>
                <td className="border-b border-divider px-3 py-2 align-top text-sub">
                  {r.info}
                  {link ? (
                    <>
                      {" "}
                      <a className="underline" href={link} rel="noopener noreferrer" target="_blank">
                        open post
                      </a>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Table>
        <Pager path={`/users/${id}`} params={{ cursor }} next={timeline.next} />
      </Card>
    </>
  );
}
