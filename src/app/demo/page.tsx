import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { errorClass, inputClass, labelClass, linkButton, primaryButtonFull } from "@/components/ui";
import { demoConfig } from "@/lib/demo";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const errors = s.demo.errors as Record<string, string>;

/**
 * The judges' way in (docs/15-demo-login.md): one access code, no email. Public. A plain form that posts to
 * /api/demo/login, so it works without JavaScript. When the demo is not set up the page says so.
 */
export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = s.demo;
  if (!demoConfig()) {
    return (
      <AuthCard>
        <h1 className="mb-2 mt-6 text-dialog text-title">{t.notAvailableTitle}</h1>
        <p className="text-[14px] leading-5 text-desc">{t.notAvailableBody}</p>
        <Link href="/login" className={`${linkButton} mt-6`}>
          {t.backToSignIn}
        </Link>
      </AuthCard>
    );
  }
  const raw = (await searchParams).error;
  const code = Array.isArray(raw) ? raw[0] : raw;
  const error = code ? (errors[code] ?? errors.invalid) : null;
  return (
    <AuthCard>
      <h1 className="mb-2 mt-6 text-dialog text-title">{t.title}</h1>
      <p className="mb-6 text-[14px] leading-5 text-desc">{t.intro}</p>
      <form method="post" action="/api/demo/login" className="space-y-5">
        <div>
          <label htmlFor="code" className={labelClass}>
            {t.codeLabel}
          </label>
          <input id="code" name="code" type="password" autoComplete="off" maxLength={200} className={inputClass} required autoFocus />
        </div>
        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}
        <button type="submit" className={primaryButtonFull}>
          {t.button}
        </button>
      </form>
    </AuthCard>
  );
}
