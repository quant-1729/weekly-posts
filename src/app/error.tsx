"use client";

import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { primaryButtonFull, secondaryButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";

/** The page-level error boundary: a plain message and a way to try again. Nothing about the error is shown. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthCard>
      <h1 className="mt-6 text-dialog text-title">{s.errors.generic}</h1>
      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={reset} className={primaryButtonFull}>
          Try again
        </button>
        <Link href="/" className={`${secondaryButton} w-full`}>
          Go to the start
        </Link>
      </div>
    </AuthCard>
  );
}
