import { AuthCard } from "@/components/auth/auth-card";
import { getDeletionStatus } from "@/lib/connections/deletion";
import { fill, s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/**
 * The status page Meta's data-deletion callback points to (C-25). Public: the confirmation code is the key. It says
 * only whether the request is done and when it came in, never anything about the account.
 */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = s.connections.deletion;
  const status = await getDeletionStatus(code);
  return (
    <AuthCard>
        <h1 className="mt-6 text-dialog text-title">{t.title}</h1>
        {status ? (
          <>
            <p className="mt-2 text-[14px] leading-5" data-deletion-status={status.status}>
              {status.status === "done" ? t.done : t.received}
            </p>
            <p className="mt-2 text-[13px] leading-[18px] text-desc">{fill(t.requested, { date: new Date(status.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) })}</p>
          </>
        ) : (
          <p className="mt-2 text-[14px] leading-5" data-deletion-status="unknown">
            {t.notFound}
          </p>
        )}
    </AuthCard>
  );
}
