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
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center px-5 py-8 md:max-w-[560px]">
      <div className="md:rounded-2xl md:border md:border-stone-200 md:bg-white md:p-10 md:shadow-sm">
        <h1 className="mb-1 text-2xl font-bold text-[#E4572E]">{s.appName}</h1>
        <h2 className="mb-2 mt-4 text-xl font-semibold">{t.title}</h2>
        {status ? (
          <>
            <p className="text-stone-700" data-deletion-status={status.status}>
              {status.status === "done" ? t.done : t.received}
            </p>
            <p className="mt-2 text-sm text-stone-600">{fill(t.requested, { date: new Date(status.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) })}</p>
          </>
        ) : (
          <p className="text-stone-700" data-deletion-status="unknown">
            {t.notFound}
          </p>
        )}
      </div>
    </main>
  );
}
