import Link from "next/link";
import { getGenerationTotals, listGenerations } from "@/lib/queries/generations";
import { requireAdmin } from "@/lib/session";
import { fmtTime, fmtUsd } from "@/lib/format";
import { Badge, Bar, Card, PageTitle, Pager, Table, btnPrimary, btnSecondary, first, inputCls, td } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Every day of the last 30 (UTC), with zero for days that have no calls. */
function fillDays(rows: { day: string; n: number; usd: number }[]) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: { day: string; n: number; usd: number }[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, n: 0, usd: 0 });
  }
  return out;
}

export default async function GenerationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const f = { kind: first(sp.kind), brand: first(sp.brand), ok: first(sp.ok), cursor: first(sp.cursor) };
  const [totals, page] = await Promise.all([getGenerationTotals(), listGenerations(f)]);
  const days = fillDays(totals.byDay);
  const maxDay = Math.max(0.000001, ...days.map((d) => d.usd));
  const maxKind = Math.max(0.000001, ...totals.byKind.map((k) => k.usd));
  return (
    <>
      <PageTitle title="Generations" hint="Every AI call the app made, from the usage log. Totals cover the last 30 days (UTC)." />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-base font-medium text-title">Spend per kind</h2>
          <Table head={["Kind", "Calls", "Failed", "Spend", ""]} empty={totals.byKind.length === 0 ? "No AI calls in the last 30 days." : undefined}>
            {totals.byKind.map((k) => (
              <tr key={k.kind}>
                <td className={td}>{k.kind}</td>
                <td className={td}>{k.n}</td>
                <td className={td}>{k.failed > 0 ? <Badge tone="err">{k.failed}</Badge> : 0}</td>
                <td className={td}>{fmtUsd(k.usd)}</td>
                <td className="w-40 border-b border-divider px-3 py-2 align-middle">
                  <Bar pct={(k.usd / maxKind) * 100} label={`${k.kind}: ${fmtUsd(k.usd)}`} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <h2 className="mb-2 text-base font-medium text-title">Spend per model</h2>
          <Table head={["Model", "Calls", "Failed", "Spend"]} empty={totals.byModel.length === 0 ? "No AI calls in the last 30 days." : undefined}>
            {totals.byModel.map((m) => (
              <tr key={m.model ?? "none"}>
                <td className={td}>{m.model ?? "—"}</td>
                <td className={td}>{m.n}</td>
                <td className={td}>{m.failed > 0 ? <Badge tone="err">{m.failed}</Badge> : 0}</td>
                <td className={td}>{fmtUsd(m.usd)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <h2 className="mb-2 text-base font-medium text-title">Spend per day</h2>
          <Table head={["Day (UTC)", "Calls", "Spend", ""]}>
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <td className={td}>{d.day}</td>
                <td className={td}>{d.n}</td>
                <td className={td}>{fmtUsd(d.usd)}</td>
                <td className="w-40 border-b border-divider px-3 py-2 align-middle">
                  <Bar pct={(d.usd / maxDay) * 100} label={`${d.day}: ${fmtUsd(d.usd)}`} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-center gap-3">
          <select name="kind" defaultValue={f.kind} className={inputCls} aria-label="Kind">
            <option value="">All kinds</option>
            {totals.byKind.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.kind}
              </option>
            ))}
          </select>
          <select name="ok" defaultValue={f.ok} className={inputCls} aria-label="Result">
            <option value="">All calls</option>
            <option value="failed">Failed only</option>
          </select>
          <input name="brand" defaultValue={f.brand} placeholder="Brand name" maxLength={80} className={inputCls} aria-label="Brand name" />
          <button type="submit" className={btnPrimary}>
            Apply
          </button>
          <Link href="/generations" className={btnSecondary}>
            Clear
          </Link>
        </form>
      </Card>
      <Card>
        <Table head={["Time (UTC)", "Brand", "Kind", "Model", "Result", "Cost"]} empty={page.rows.length === 0 ? "No calls match." : undefined}>
          {page.rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{fmtTime(r.ts)}</td>
              <td className={td}>{r.brand_name ?? ""}</td>
              <td className={td}>{r.kind}</td>
              <td className={td}>{r.model ?? "—"}</td>
              <td className={td}>{r.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="err">failed</Badge>}</td>
              <td className={td}>{fmtUsd(r.usd)}</td>
            </tr>
          ))}
        </Table>
        <Pager path="/generations" params={{ ...f }} next={page.next} />
      </Card>
    </>
  );
}
