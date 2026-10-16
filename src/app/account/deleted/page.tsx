import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { linkButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";

export const metadata = { robots: { index: false, follow: false } };

/** Shown after the account is deleted. Public: the owner is signed out by then. */
export default function Page() {
  const t = s.account.deletedPage;
  return (
    <AuthCard>
      <h1 className="mt-6 text-dialog text-title">{t.title}</h1>
      <p className="mt-2 text-[14px] leading-5 text-desc">{t.body}</p>
      <Link href="/login" className={`${linkButton} mt-6`}>
        {t.link}
      </Link>
    </AuthCard>
  );
}
