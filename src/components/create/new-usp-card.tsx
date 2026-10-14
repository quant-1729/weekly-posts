"use client";

import { useState, useTransition } from "react";
import { addUspAction } from "@/app/(app)/create/actions";
import { errorClass, primaryButton, secondaryButton } from "@/components/ui";
import type { NewUspSuggestion } from "@/lib/briefs/from-text";
import { fill, s } from "@/lib/i18n/strings";
import type { Usp } from "@/lib/usps/types";

const t = s.create.newUsp;

/**
 * A selling point the model found in the owner's words that is not in their list. It is only a
 * suggestion: nothing is saved until the owner presses "Add and use it".
 */
export function NewUspCard({
  brandId,
  suggestion,
  onAccepted,
  onDeclined,
}: {
  brandId: string;
  suggestion: NewUspSuggestion;
  onAccepted: (usp: Usp) => void;
  onDeclined: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accept() {
    setProblem(null);
    startTransition(async () => {
      const r = await addUspAction(brandId, { kind: suggestion.kind, title: suggestion.title, details: suggestion.details });
      if (!r.ok) {
        setProblem(r.message);
        return;
      }
      onAccepted(r.usp);
    });
  }

  return (
    <section data-new-usp className="min-w-0 space-y-2 rounded-2xl border border-sky-300 bg-sky-50 p-4">
      <h2 className="text-lg font-bold">{t.title}</h2>
      <p className="break-words font-medium">{suggestion.title}</p>
      <p className="text-sm text-stone-700">{s.usps.kinds[suggestion.kind]}</p>
      <p className="break-words text-sm text-stone-700">{fill(t.body, { quote: suggestion.quote })}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className={primaryButton} disabled={pending} onClick={accept}>
          {t.accept}
        </button>
        <button type="button" className={secondaryButton} disabled={pending} onClick={onDeclined}>
          {t.decline}
        </button>
      </div>
      {problem && (
        <p role="alert" className={errorClass}>
          {problem}
        </p>
      )}
    </section>
  );
}
