import { notFound } from "next/navigation";
import { isDevToolsEnabled } from "@/lib/env";
import { WEEKLY_USD_CAP } from "@/lib/usage/caps";
import { costReport } from "@/lib/usage/report";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev costs", robots: { index: false, follow: false } };

/** Developer-only: AI cost per brand per week (Req 23). A 404 in production and on Vercel, like /dev/outbox. */
export default async function CostsPage() {
  if (!isDevToolsEnabled()) notFound();
  const rows = await costReport();

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Dev costs</h1>
      <p className="text-sm text-stone-600">
        AI cost per brand per local week (Monday to Monday). Cap: ${WEEKLY_USD_CAP.toFixed(2)} a week. In fixture mode every cost is $0.
      </p>
      {rows.length === 0 && <p className="text-stone-600">No AI usage recorded yet.</p>}
      {rows.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-300">
              <th className="py-2 pr-3">Week</th>
              <th className="py-2 pr-3">Brand</th>
              <th className="py-2 pr-3">Cost</th>
              <th className="py-2 pr-3">Cap</th>
              <th className="py-2">Calls</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.brandId}-${r.weekStart}`} className="border-b border-stone-200">
                <td className="py-2 pr-3">{r.weekStart}</td>
                <td className="py-2 pr-3">{r.brandName}</td>
                <td className="py-2 pr-3">${r.usd.toFixed(4)}</td>
                <td className="py-2 pr-3">{r.underCap ? "under" : "OVER"}</td>
                <td className="py-2">
                  {Object.entries(r.calls)
                    .map(([k, n]) => `${k} ${n}`)
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
