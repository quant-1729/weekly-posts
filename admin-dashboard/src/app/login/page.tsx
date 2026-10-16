import { requestLinkAction } from "../actions";
import { Card, btnPrimary, inputCls, first } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sent = first(sp.sent) === "1";
  const failed = first(sp.error) === "1";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-xl font-medium text-title">Weekly Posts admin</h1>
      <Card>
        {sent ? (
          <p className="text-sm text-sub">
            If that address is allowed, a sign-in link is on its way. Check your inbox. The link works once and expires in 15 minutes.
          </p>
        ) : (
          <form action={requestLinkAction} className="flex flex-col gap-3">
            {failed ? <p role="alert" className="text-sm text-err-tx">That link is invalid, expired or already used. Ask for a new one.</p> : null}
            <label htmlFor="email" className="text-sm font-medium text-title">
              Email
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" maxLength={254} className={inputCls} />
            <button type="submit" className={btnPrimary}>
              Email me a sign-in link
            </button>
          </form>
        )}
      </Card>
    </main>
  );
}
