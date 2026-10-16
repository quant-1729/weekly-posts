import Link from "next/link";
import { listUsers } from "@/lib/queries/users";
import { requireAdmin } from "@/lib/session";
import { fmtTime, fmtUsd, maskEmail } from "@/lib/format";
import { Card, PageTitle, Pager, Table, btnPrimary, btnSecondary, first, inputCls, td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = first(sp.q);
  const cursor = first(sp.cursor);
  const page = await listUsers({ q, cursor });
  return (
    <>
      <PageTitle title="Users" hint="Emails are masked here; open a user to see the full address." />
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-center gap-3">
          <input name="q" defaultValue={q} placeholder="Search email" maxLength={80} className={inputCls} aria-label="Search by email" />
          <button type="submit" className={btnPrimary}>
            Search
          </button>
          <Link href="/users" className={btnSecondary}>
            Clear
          </Link>
        </form>
      </Card>
      <Card>
        <Table
          head={["User", "Brand", "Signed up", "Last seen", "Sessions", "Posts", "AI spend"]}
          empty={page.rows.length === 0 ? "No users match." : undefined}
        >
          {page.rows.map((u) => (
            <tr key={u.id}>
              <td className={td}>
                <Link className="underline" href={`/users/${u.id}`}>
                  {maskEmail(u.email)}
                </Link>
              </td>
              <td className={td}>{u.brand_name ?? ""}</td>
              <td className={td}>{fmtTime(u.signed_up)}</td>
              <td className={td}>{fmtTime(u.last_seen)}</td>
              <td className={td}>{u.sessions}</td>
              <td className={td}>{u.posts}</td>
              <td className={td}>{fmtUsd(u.ai_spend)}</td>
            </tr>
          ))}
        </Table>
        <Pager path="/users" params={{ q, cursor }} next={page.next} />
      </Card>
    </>
  );
}
