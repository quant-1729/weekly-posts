"use client";

import { useState, useTransition } from "react";
import { addOwnerDateAction, removeOwnerDateAction } from "@/app/(app)/brand/actions";
import { errorClass, inputClass, labelClass, secondaryButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";
import { formatDate } from "@/lib/memory/messages";
import type { OwnerDate } from "@/lib/occasions/owner-dates";

const t = s.brandV2.dates;

/** The owner's own dates: list, add (date, name, every year) and remove. */
export function DatesPanel({ brandId, dates }: { brandId: string; dates: OwnerDate[] }) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [yearly, setYearly] = useState(true);
  const [errors, setErrors] = useState<{ date?: string; name?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const next: { date?: string; name?: string } = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) next.date = t.errors.date;
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < 1 || clean.length > 120) next.name = t.errors.name;
    setErrors(next);
    setError(null);
    if (next.date || next.name) return;
    startTransition(async () => {
      const r = await addOwnerDateAction(brandId, { date, name: clean, yearly });
      if (!r.ok) {
        if (r.fieldErrors?.date) setErrors({ date: t.errors.date });
        else if (r.fieldErrors?.name) setErrors({ name: t.errors.name });
        else setError(r.message);
        return;
      }
      setDate("");
      setName("");
      setYearly(true);
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await removeOwnerDateAction(brandId, id);
      if (!r.ok) setError(r.message);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-5 text-desc">{t.intro}</p>

      {dates.length === 0 ? (
        <p className="text-[14px] leading-5 text-desc">{t.empty}</p>
      ) : (
        <ul className="space-y-2">
          {dates.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 p-3">
              <span>
                <span className="block font-medium">{d.name}</span>
                <span className="block text-sm text-stone-600">
                  {formatDate(d.date, !d.yearly)}
                  {d.yearly ? ` (${t.everyYear})` : ""}
                </span>
              </span>
              <button type="button" className="min-h-10 shrink-0 text-sm text-red-700 underline" disabled={pending} onClick={() => remove(d.id)}>
                {t.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-3">
        <div>
          <label htmlFor="owner-date" className={labelClass}>
            {t.dateLabel}
          </label>
          <input id="owner-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          {errors.date && (
            <p role="alert" className={errorClass}>
              {errors.date}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="owner-date-name" className={labelClass}>
            {t.nameLabel}
          </label>
          <input
            id="owner-date-name"
            className={inputClass}
            value={name}
            maxLength={120}
            placeholder={t.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && (
            <p role="alert" className={errorClass}>
              {errors.name}
            </p>
          )}
        </div>
        <label className="flex min-h-10 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />
          {t.yearly}
        </label>
        <button type="button" className={secondaryButton} disabled={pending} onClick={add}>
          {t.add}
        </button>
        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
