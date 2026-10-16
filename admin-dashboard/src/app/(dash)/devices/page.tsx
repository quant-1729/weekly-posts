import Link from "next/link";
import { DEVICE_TYPES, listSessions } from "@/lib/queries/devices";
import { requireAdmin } from "@/lib/session";
import { SessionsTable } from "@/components/sessions-table";
import { Card, PageTitle, Pager, btnPrimary, btnSecondary, first, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const f = {
    active: first(sp.active) === "1",
    device: first(sp.device),
    country: first(sp.country),
    q: first(sp.q),
    cursor: first(sp.cursor),
  };
  const page = await listSessions(f);
  const params = { active: f.active && "1", device: f.device, country: f.country, q: f.q, cursor: f.cursor };
  return (
    <>
      <PageTitle title="Devices" hint="Every sign-in, newest activity first. Signing a device out takes effect on its next request." />
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="1" defaultChecked={f.active} /> Active only
          </label>
          <select name="device" defaultValue={f.device} className={inputCls} aria-label="Device type">
            <option value="">All devices</option>
            {DEVICE_TYPES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <input name="country" defaultValue={f.country} placeholder="Country (IN)" maxLength={2} className={`${inputCls} w-32 uppercase`} aria-label="Country code" />
          <input name="q" defaultValue={f.q} placeholder="Search email" maxLength={80} className={inputCls} aria-label="Search by email" />
          <button type="submit" className={btnPrimary}>
            Apply
          </button>
          <Link href="/devices" className={btnSecondary}>
            Clear
          </Link>
        </form>
      </Card>
      <Card>
        <SessionsTable rows={page.rows} />
        <Pager path="/devices" params={params} next={page.next} />
      </Card>
    </>
  );
}
