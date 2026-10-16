import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { primaryButtonFull } from "@/components/ui";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";

export default function InvalidLinkPage() {
  return (
    <AuthCard>
      <h1 className="mt-6 text-dialog text-title">{s.login.invalidLink.title}</h1>
      <p className="mb-6 mt-2 text-[14px] leading-5 text-desc">{s.login.invalidLink.body}</p>
      <Link href="/login" className={primaryButtonFull}>
        {s.login.invalidLink.button}
      </Link>
    </AuthCard>
  );
}
