"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { requestAccountDeletionAction } from "@/app/(app)/brand/account-actions";
import { secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";

const errors = s.account.delete.errors as Record<string, string>;

/** "Your data" on the brand page: take a copy, or delete everything (after an email confirmation). */
export function AccountPanel() {
  const t = s.account;
  const [pending, startTransition] = useTransition();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function requestDelete() {
    setError(null);
    startTransition(async () => {
      const res = await requestAccountDeletionAction();
      if (res.ok) setSentTo(res.email);
      else setError(errors[res.error] ?? errors.generic);
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-[14px] leading-5 text-desc">{t.intro}</p>

      <div className="space-y-2">
        <h3 className="font-medium">{t.download.title}</h3>
        <p className="text-sm text-stone-600">{t.download.body}</p>
        {/* A plain link: the browser downloads the ZIP as it streams. */}
        <a href="/api/account/export" download className={`${secondaryButton} inline-block text-center`}>
          {t.download.button}
        </a>
      </div>

      <div className="space-y-2 border-t border-stone-200 pt-5">
        <h3 className="font-medium">{t.delete.title}</h3>
        <p className="text-sm text-stone-600">{t.delete.body}</p>
        {sentTo ? (
          <div role="status" className="rounded-lg bg-stone-100 px-3 py-3">
            <p className="font-medium">{t.delete.sentTitle}</p>
            <p className="text-sm text-stone-700">{fill(t.delete.sentBody, { email: sentTo })}</p>
          </div>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={requestDelete}
              disabled={pending}
              className="w-full rounded-lg border border-red-300 bg-white px-4 py-3 text-base font-medium text-red-800 disabled:opacity-50"
            >
              {pending ? t.delete.sending : t.delete.button}
            </button>
          </>
        )}
      </div>

      <Link href="/terms" className="inline-block py-2 text-sm text-stone-600 underline">
        {t.termsLink}
      </Link>
    </div>
  );
}
