import Link from "next/link";
import { revokeSessionAction } from "@/app/actions";
import { ago, countryName, fmtTime, maskEmail } from "@/lib/format";
import type { SessionRow } from "@/lib/queries/devices";
import { Badge, Table, btnSecondary, td } from "./ui";

export function SessionsTable({ rows, showUser = true, fullEmail = false }: { rows: SessionRow[]; showUser?: boolean; fullEmail?: boolean }) {
  const head = [...(showUser ? ["User"] : []), "Brand", "Device", "Browser", "OS", "Location", "First seen", "Last seen", "Status", ""];
  return (
    <Table head={head} empty={rows.length === 0 ? "No sessions match." : undefined}>
      {rows.map((r) => {
        const loc = [r.city, countryName(r.country)].filter(Boolean).join(", ");
        const revoked = Boolean(r.revoked_at);
        return (
          <tr key={r.id}>
            {showUser ? (
              <td className={td}>
                <Link className="underline" href={`/users/${r.user_id}`}>
                  {fullEmail ? (r.email ?? "(no email)") : maskEmail(r.email)}
                </Link>
              </td>
            ) : null}
            <td className={td}>{r.brand_name ?? ""}</td>
            <td className={td}>{r.device_type}</td>
            <td className={td}>{r.browser ?? ""}</td>
            <td className={td}>{r.os ?? ""}</td>
            <td className={td}>{loc}</td>
            <td className={td}>{fmtTime(r.first_seen)}</td>
            <td className={td} title={fmtTime(r.last_seen)}>
              {fmtTime(r.last_seen)} <span className="text-desc">({ago(r.last_seen)})</span>
            </td>
            <td className={td}>
              {revoked ? (
                <Badge tone="err">revoked{r.revoked_by ? ` by ${r.revoked_by}` : ""}</Badge>
              ) : r.online ? (
                <Badge tone="ok">online</Badge>
              ) : (
                <Badge>active</Badge>
              )}
            </td>
            <td className={td}>
              {revoked ? null : (
                // A <details> confirm step works without any script: open it, then press the second button.
                <details className="relative">
                  <summary className={`${btnSecondary} list-none`}>Sign out</summary>
                  <form action={revokeSessionAction} className="absolute right-0 z-10 mt-1 w-56 whitespace-normal rounded-card border border-line bg-white p-3 shadow-card">
                    <p className="mb-2 text-xs text-sub">Sign this device out? The user will need to sign in again.</p>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="inline-flex h-9 cursor-pointer items-center rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-ink-2">
                      Yes, sign out
                    </button>
                  </form>
                </details>
              )}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}
