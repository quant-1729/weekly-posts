import type { ReactNode } from "react";
import type { AdminMetrics, Count } from "@/lib/admin/metrics";

// Server-rendered panels for /admin. Plain tables and CSS bars; no chart library.

export const usd = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`;
/** "2026-10-15T08:30:00Z" -> "2026-10-15 08:30 UTC". */
export const when = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "");

export function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {note && <p className="mt-1 text-sm text-stone-500">{note}</p>}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "bad" }) {
  return (
    <div className="min-w-0 rounded-lg bg-stone-50 px-3 py-2">
      <div className={`text-xl font-bold ${tone === "bad" ? "text-red-700" : ""}`}>{value}</div>
      <div className="text-sm text-stone-600">{label}</div>
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-stone-500">{children}</p>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-stone-300">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, bad, wide }: { children: ReactNode; bad?: boolean; wide?: boolean }) => (
  <td className={`py-2 pr-4 align-top ${bad ? "font-semibold text-red-700" : ""} ${wide ? "min-w-64 max-w-md whitespace-normal break-words" : ""}`}>{children}</td>
);

const Row = ({ children, bad }: { children: ReactNode; bad?: boolean }) => <tr className={`border-b border-stone-200 ${bad ? "bg-red-50" : ""}`}>{children}</tr>;

const countsLine = (rows: Count[]) =>
  rows.map((r) => (
    <li key={r.key} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-sm">
      {r.key.replace(/_/g, " ")}: <b>{r.n}</b>
    </li>
  ));

export function OverviewPanel({ m }: { m: AdminMetrics }) {
  const o = m.overview;
  return (
    <Panel title="Overview">
      <Stats>
        <Stat label="Owners signed up" value={o.owners} />
        <Stat label="Brands" value={o.brands} />
        <Stat label="New owners, last 7 days" value={o.newOwners7d} />
        <Stat label="New owners, last 30 days" value={o.newOwners30d} />
        <Stat label="Active brands, last 7 days" value={o.activeBrands7d} />
      </Stats>
      <p className="text-sm text-stone-500">Active means the brand made a post, took an action on a post, or used AI in the last 7 days.</p>
    </Panel>
  );
}

export function CostPanel({ m }: { m: AdminMetrics }) {
  const c = m.cost;
  return (
    <Panel title="AI cost" note={`Weekly cap per brand: ${usd(c.weeklyCapUsd)}. In fixture mode every cost is $0.`}>
      <Stats>
        <Stat label="Today (UTC)" value={usd(c.todayUsd)} />
        <Stat label="Last 7 days" value={usd(c.last7dUsd)} />
        <Stat label="Last 30 days" value={usd(c.last30dUsd)} />
      </Stats>
      <div>
        <h3 className="mb-1 font-semibold">By kind of AI call</h3>
        {c.byKind.length === 0 ? (
          <Empty>No AI usage in the last 30 days.</Empty>
        ) : (
          <Table head={["Kind", "Calls, 7 days", "Cost, 7 days", "Calls, 30 days", "Cost, 30 days"]}>
            {c.byKind.map((r) => (
              <Row key={r.kind}>
                <Td>{r.kind}</Td>
                <Td>{r.calls7d}</Td>
                <Td>{usd(r.usd7d)}</Td>
                <Td>{r.calls30d}</Td>
                <Td>{usd(r.usd30d)}</Td>
              </Row>
            ))}
          </Table>
        )}
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Top 10 brands this week (against the {usd(c.weeklyCapUsd)} cap)</h3>
        {c.topBrands.length === 0 ? (
          <Empty>No AI usage this week yet.</Empty>
        ) : (
          <Table head={["Brand", "Cost this week", "Calls", "Cap"]}>
            {c.topBrands.map((r) => (
              <Row key={r.brandId} bad={r.overCap}>
                <Td bad={r.overCap}>{r.brandName}</Td>
                <Td bad={r.overCap}>{usd(r.usd)}</Td>
                <Td>{r.calls}</Td>
                <Td bad={r.overCap}>{r.overCap ? "OVER CAP" : "under"}</Td>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </Panel>
  );
}

export function PostsPanel({ m }: { m: AdminMetrics }) {
  const days = m.postsPerDay;
  const max = Math.max(1, ...days.flatMap((d) => [d.created, d.approved, d.published]));
  const total = days.reduce((a, d) => a + d.created + d.approved + d.published + d.delivered, 0);
  const bar = (n: number, colour: string) => <div className={`h-2 rounded ${colour}`} style={{ width: `${Math.round((n / max) * 100)}%`, minWidth: n > 0 ? 4 : 0 }} />;
  return (
    <Panel title="Posts, last 14 days" note="Per day (UTC). Published and delivered are queue items finished that day; delivered means sent to the owner to post.">
      {total === 0 ? (
        <Empty>No posts in the last 14 days.</Empty>
      ) : (
        <Table head={["Day", "Created", "Approved", "Published", "Delivered"]}>
          {[...days].reverse().map((d) => (
            <Row key={d.day}>
              <Td>{d.day}</Td>
              <Td>
                <div className="w-24">
                  {d.created}
                  {bar(d.created, "bg-stone-400")}
                </div>
              </Td>
              <Td>
                <div className="w-24">
                  {d.approved}
                  {bar(d.approved, "bg-[#E4572E]/60")}
                </div>
              </Td>
              <Td>
                <div className="w-24">
                  {d.published}
                  {bar(d.published, "bg-emerald-600")}
                </div>
              </Td>
              <Td>{d.delivered}</Td>
            </Row>
          ))}
        </Table>
      )}
    </Panel>
  );
}

export function QueuePanel({ m }: { m: AdminMetrics }) {
  const q = m.queue;
  return (
    <Panel title="Publishing queue">
      {q.byStatus.length === 0 ? <Empty>Nothing has been queued yet.</Empty> : <ul className="flex flex-wrap gap-2">{countsLine(q.byStatus)}</ul>}
      <div>
        <h3 className="mb-1 font-semibold">Stuck for more than {q.stuckMinutes} minutes</h3>
        <p className="mb-2 text-sm text-stone-500">Being published for too long, or past its time and still waiting.</p>
        {q.stuck.length === 0 ? (
          <Empty>Nothing is stuck.</Empty>
        ) : (
          <Table head={["Brand", "Channel", "State", "Planned for", "Minutes late", "Tries"]}>
            {q.stuck.map((r, i) => (
              <Row key={i} bad>
                <Td>{r.brandName}</Td>
                <Td>{r.channel}</Td>
                <Td>{r.status}</Td>
                <Td>{when(r.slotAt)}</Td>
                <Td>{r.minutesLate}</Td>
                <Td>{r.attempts}</Td>
              </Row>
            ))}
          </Table>
        )}
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Latest failures</h3>
        {q.failures.length === 0 ? (
          <Empty>No failed posts.</Empty>
        ) : (
          <Table head={["When", "Brand", "Channel", "Tries", "Error"]}>
            {q.failures.map((r, i) => (
              <Row key={i}>
                <Td>{when(r.at)}</Td>
                <Td>{r.brandName}</Td>
                <Td>{r.channel}</Td>
                <Td>{r.attempts}</Td>
                <Td wide>{r.error || "(no error text)"}</Td>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </Panel>
  );
}

export function ConnectionsPanel({ m }: { m: AdminMetrics }) {
  const c = m.connections;
  return (
    <Panel title="Connected accounts">
      {c.byProviderStatus.length === 0 ? (
        <Empty>No Instagram or Facebook accounts connected yet.</Empty>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {c.byProviderStatus.map((r) => (
            <li key={`${r.provider}-${r.status}`} className={`rounded-full border px-3 py-1 text-sm ${r.status === "active" ? "border-stone-200 bg-stone-50" : "border-red-200 bg-red-50 text-red-800"}`}>
              {r.provider} {r.status}: <b>{r.n}</b>
            </li>
          ))}
        </ul>
      )}
      <div>
        <h3 className="mb-1 font-semibold">Recent problems</h3>
        {c.problems.length === 0 ? (
          <Empty>No connection problems.</Empty>
        ) : (
          <Table head={["When", "Brand", "Account", "State", "Error"]}>
            {c.problems.map((r, i) => (
              <Row key={i}>
                <Td>{when(r.at)}</Td>
                <Td>{r.brandName}</Td>
                <Td>{r.provider}</Td>
                <Td bad={r.status !== "active"}>{r.status}</Td>
                <Td wide>{r.error || "(no error text)"}</Td>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </Panel>
  );
}

export function EmailPanel({ m }: { m: AdminMetrics }) {
  const e = m.email;
  return (
    <Panel title="Email, last 7 days">
      {e.byKindStatus.length === 0 ? (
        <Empty>No emails in the last 7 days.</Empty>
      ) : (
        <Table head={["Kind", "Sent", "Failed", "Waiting"]}>
          {e.byKindStatus.map((r) => (
            <Row key={r.kind} bad={r.failed > 0}>
              <Td>{r.kind.replace(/_/g, " ")}</Td>
              <Td>{r.sent}</Td>
              <Td bad={r.failed > 0}>{r.failed}</Td>
              <Td>{r.queued}</Td>
            </Row>
          ))}
        </Table>
      )}
      <div>
        <h3 className="mb-1 font-semibold">Recent failures</h3>
        {e.failures.length === 0 ? (
          <Empty>No failed emails.</Empty>
        ) : (
          <Table head={["When", "Kind", "Brand", "To", "Error"]}>
            {e.failures.map((r, i) => (
              <Row key={i}>
                <Td>{when(r.at)}</Td>
                <Td>{r.kind.replace(/_/g, " ")}</Td>
                <Td>{r.brandName}</Td>
                <Td>{r.to}</Td>
                <Td wide>{r.error || "(no error text)"}</Td>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </Panel>
  );
}

export function DeletionsPanel({ m, now }: { m: AdminMetrics; now: number }) {
  const d = m.deletions;
  const oldestDays = d.oldestPendingAt ? Math.max(0, Math.floor((now - Date.parse(d.oldestPendingAt)) / 86_400_000)) : null;
  return (
    <Panel title="Meta data-deletion requests" note="Requests from Instagram or Facebook to delete a person's data. Answer them promptly.">
      {d.byStatus.length === 0 ? <Empty>No deletion requests.</Empty> : <ul className="flex flex-wrap gap-2">{countsLine(d.byStatus.map((r) => ({ ...r, key: r.key === "received" ? "waiting" : r.key })))}</ul>}
      {d.oldestPendingAt && (
        <p className={`text-sm ${oldestDays !== null && oldestDays >= 7 ? "font-semibold text-red-700" : "text-stone-700"}`}>
          Oldest waiting request: {when(d.oldestPendingAt)} ({oldestDays} {oldestDays === 1 ? "day" : "days"} ago).
        </p>
      )}
    </Panel>
  );
}
