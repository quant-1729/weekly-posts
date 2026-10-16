import { confirmSignInAction } from "../../actions";
import { linkAlreadyUsed, readLinkToken } from "@/lib/auth";
import { maskEmail } from "@/lib/format";
import { Card, btnPrimary, first } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** Shows a button instead of signing in on open, so an email scanner that fetches the link cannot use it up. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = first((await searchParams).t);
  const link = readLinkToken(token);
  const valid = link ? !(await linkAlreadyUsed(link.n)) : false;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-xl font-medium text-title">Weekly Posts admin</h1>
      <Card>
        {link && valid ? (
          <form action={confirmSignInAction} className="flex flex-col gap-3">
            <p className="text-sm text-sub">Sign in as {maskEmail(link.e)}?</p>
            <input type="hidden" name="t" value={token} />
            <button type="submit" className={btnPrimary}>
              Sign in
            </button>
          </form>
        ) : (
          <p className="text-sm text-sub">
            That link is invalid, expired or already used.{" "}
            <Link className="underline" href="/login">
              Ask for a new one
            </Link>
            .
          </p>
        )}
      </Card>
    </main>
  );
}
