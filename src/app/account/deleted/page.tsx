import Link from "next/link";
import { s } from "@/lib/i18n/strings";

export const metadata = { robots: { index: false, follow: false } };

/** Shown after the account is deleted. Public: the owner is signed out by then. */
export default function Page() {
  const t = s.account.deletedPage;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold text-[#E4572E]">{s.appName}</h1>
      <h2 className="mb-2 mt-4 text-xl font-semibold">{t.title}</h2>
      <p className="text-stone-700">{t.body}</p>
      <Link href="/login" className="mt-6 inline-block py-2 text-sm text-stone-600 underline">
        {t.link}
      </Link>
    </main>
  );
}
