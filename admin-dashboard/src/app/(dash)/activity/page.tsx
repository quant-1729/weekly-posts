import Link from "next/link";
import { listActivity, listActivityKinds } from "@/lib/queries/activity";
import { requireAdmin } from "@/lib/session";
import { fmtTime, maskEmail } from "@/lib/format";
import { Badge, Card, PageTitle, Pager, Table, btnPrimary, btnSecondary, first, inputCls, td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const f = {
    kind: first(sp.kind),
    ok: first(sp.ok),
    user: first(sp.user),
    brand: first(sp.brand),
    from: first(sp.from),
    to: first(sp.to),
    cursor: first(sp.cursor),
  };
  const [page, kinds] = await Promise.all([listActivity(f), listActivityKinds()]);
  return (
    <>
      <PageTitle title="Activity log" hint="What happened in the app, newest first. Short codes only; no post text." />
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-center gap-3">
          <select name="kind" defaultValue={f.kind} className={inputCls} aria-label="Event kind">
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select name="ok" defaultValue={f.ok} className={inputCls} aria-label="Result">
            <option value="">OK and failed</option>
            <option value="ok">OK only</option>
            <option value="failed">Failed only</option>
          </select>
          <input name="user" defaultValue={f.user} placeholder="User email" maxLength={80} className={inputCls} aria-label="User email" />
          <input name="brand" defaultValue={f.brand} placeholder="Brand name" maxLength={80} className={inputCls} aria-label="Brand name" />
          <label className="flex items-center gap-2 text-sm">
            From <input type="date" name="from" defaultValue={f.from} className={inputCls} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            To <input type="date" name="to" defaultValue={f.to} className={inputCls} />
          </label>
          <button type="submit" className={btnPrimary}>
            Apply
          </button>
          <Link href="/activity" className={btnSecondary}>
            Clear
          </Link>
        </form>
      </Card>
      <Card>
        <Table head={["Time (UTC)", "Kind", "Result", "User", "Brand", "Details"]} empty={page.rows.length === 0 ? "No events match." : undefined}>
          {page.rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{fmtTime(r.ts)}</td>
              <td className={td}>{r.kind}</td>
              <td className={td}>{r.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="err">failed</Badge>}</td>
              <td className={td}>
                {r.user_id ? (
                  <Link className="underline" href={`/users/${r.user_id}`}>
                    {maskEmail(r.email)}
                  </Link>
                ) : (
                  ""
                )}
              </td>
              <td className={td}>{r.brand_name ?? ""}</td>
              <td className="border-b border-divider px-3 py-2 align-top text-sub">{r.detail}</td>
            </tr>
          ))}
        </Table>
        <Pager path="/activity" params={{ ...f }} next={page.next} />
      </Card>
    </>
  );
}
