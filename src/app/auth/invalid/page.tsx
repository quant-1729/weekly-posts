import Link from "next/link";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";

export default function InvalidLinkPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold text-[#E4572E]">{s.appName}</h1>
      <h2 className="mb-2 mt-4 text-xl font-semibold">{s.login.invalidLink.title}</h2>
      <p className="mb-6 text-stone-600">{s.login.invalidLink.body}</p>
      <Link
        href="/login"
        className="block w-full rounded-lg bg-[#E4572E] px-4 py-3 text-center text-lg font-semibold text-white"
      >
        {s.login.invalidLink.button}
      </Link>
    </main>
  );
}
