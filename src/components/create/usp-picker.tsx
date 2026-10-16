"use client";

import { useState, useTransition } from "react";
import { addUspAction, confirmUspHereAction } from "@/app/(app)/create/actions";
import { emptyDraft, UspForm, type Draft } from "@/components/brand/usps-section";
import { errorClass, hintClass, secondaryButton } from "@/components/ui";
import { formatsForChannels } from "@/lib/briefs/editor-state";
import { uspLimitWarnings } from "@/lib/briefs/completeness";
import { s } from "@/lib/i18n/strings";
import { detailsFromForm, fieldOfError, suggestTitle } from "@/lib/usps/form";
import { parseUsp } from "@/lib/usps/schema";
import { NEEDS_CONFIRMATION, type Usp } from "@/lib/usps/types";
import { EditorCard, pickClass } from "./card";

const t = s.create.usps;

/**
 * Selling points (B-2): choose one main point (radio) and up to 2 extra points (checkboxes) from
 * the library, confirm claims that need it, add a new point inline (saved to the library), and see
 * the warning when the chosen channels' formats cannot hold that many points.
 */
export function UspPicker({
  brandId,
  usps,
  primaryUspId,
  secondaryUspIds,
  channels,
  currency,
  fromDescription,
  error,
  onChange,
  onUspsChange,
  onUspAdded,
}: {
  brandId: string;
  usps: Usp[];
  primaryUspId: string | null;
  secondaryUspIds: string[];
  channels: string[];
  currency: string;
  fromDescription: boolean;
  error?: string;
  onChange: (next: { primaryUspId: string | null; secondaryUspIds: string[] }) => void;
  /** Called when the library changes (a confirmation, a new point). */
  onUspsChange: (next: Usp[]) => void;
  /** A new point was saved to the library. */
  onUspAdded: (usp: Usp) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(currency));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const warnings = uspLimitWarnings({ primaryUspId, secondaryUspIds }, formatsForChannels(channels));

  function pickPrimary(id: string | null) {
    onChange({ primaryUspId: id, secondaryUspIds: id ? secondaryUspIds.filter((x) => x !== id) : [] });
  }
  function toggleSecondary(id: string, on: boolean) {
    if (!primaryUspId) return;
    onChange({ primaryUspId, secondaryUspIds: on ? [...secondaryUspIds, id].slice(0, 2) : secondaryUspIds.filter((x) => x !== id) });
  }

  function confirm(id: string) {
    setProblem(null);
    setBusyId(id);
    startTransition(async () => {
      const r = await confirmUspHereAction(brandId, id);
      setBusyId(null);
      if (!r.ok) {
        setProblem(r.message);
        return;
      }
      onUspsChange(usps.map((u) => (u.id === id ? r.usp : u)));
    });
  }

  function saveNew() {
    const details = detailsFromForm(draft.kind, draft.values);
    const input = { kind: draft.kind, title: draft.title.trim() || suggestTitle(draft.kind, details), details };
    const parsed = parseUsp(input);
    if (!parsed.ok) {
      const next: Record<string, string> = {};
      for (const [path, code] of Object.entries(parsed.fieldErrors)) {
        const key = fieldOfError(path);
        if (!(key in next)) next[key] = code;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setProblem(null);
    startTransition(async () => {
      const r = await addUspAction(brandId, input);
      if (!r.ok) {
        const next: Record<string, string> = {};
        for (const [path, text] of Object.entries(r.fieldErrors ?? {})) {
          const key = fieldOfError(path);
          if (!(key in next)) next[key] = text;
        }
        setErrors(next);
        setProblem(r.message);
        return;
      }
      // The editor adds it to the library and uses it straight away (main point, else an extra one if there is room).
      onUspAdded(r.usp);
      setAdding(false);
      setDraft(emptyDraft(currency));
    });
  }

  return (
    <EditorCard id="usps" title={t.title} hint={t.hint} fromDescription={fromDescription}>
      {usps.length === 0 && <p className="text-[14px] leading-5 text-desc">{t.empty}</p>}
      {usps.length > 0 && (
        <div className="space-y-2">
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-1 font-medium">{t.primary}</legend>
            <label className={pickClass(primaryUspId === null)}>
              <input type="radio" name="primary-usp" className="mt-1 h-5 w-5 shrink-0" checked={primaryUspId === null} onChange={() => pickPrimary(null)} />
              <span>{t.none}</span>
            </label>
            <ul className="space-y-2">
              {usps.map((u) => {
                const needs = NEEDS_CONFIRMATION.has(u.kind) && !u.confirmed;
                const isPrimary = primaryUspId === u.id;
                const isSecondary = secondaryUspIds.includes(u.id);
                const secondaryDisabled = !primaryUspId || isPrimary || (!isSecondary && secondaryUspIds.length >= 2);
                return (
                  <li key={u.id} data-usp-id={u.id} className="min-w-0 space-y-2 rounded-xl border border-stone-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 break-words font-medium">{u.title}</p>
                      <span data-kind={u.kind} className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">
                        {s.usps.kinds[u.kind]}
                      </span>
                      {NEEDS_CONFIRMATION.has(u.kind) && (
                        <span data-needs-confirmation={needs ? "true" : "false"} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${needs ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-900"}`}>
                          {needs ? t.needsConfirmation : t.confirmed}
                        </span>
                      )}
                    </div>
                    {needs && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <p className="text-sm text-amber-900">{t.confirmHint}</p>
                        <button type="button" className={`${secondaryButton} md:min-w-0`} disabled={pending} onClick={() => confirm(u.id)}>
                          {busyId === u.id ? t.confirming : t.confirm}
                        </button>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <label className={pickClass(isPrimary)}>
                        <input type="radio" name="primary-usp" className="mt-1 h-5 w-5 shrink-0" checked={isPrimary} onChange={() => pickPrimary(u.id)} />
                        <span>{t.mainShort}</span>
                      </label>
                      <label className={pickClass(isSecondary, secondaryDisabled)}>
                        <input
                          type="checkbox"
                          className="mt-1 h-5 w-5 shrink-0"
                          checked={isSecondary}
                          disabled={secondaryDisabled}
                          onChange={(e) => toggleSecondary(u.id, e.target.checked)}
                        />
                        <span>{t.extraShort}</span>
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          {!primaryUspId && secondaryUspIds.length === 0 && <p className={hintClass}>{t.pickMainFirst}</p>}
        </div>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <div role="status" data-usp-warning className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
          <p className="font-medium">{t.limitTitle}</p>
          {warnings.map((w) => (
            <p key={w.format} className="break-words text-sm">
              {w.message}
            </p>
          ))}
        </div>
      )}
      {adding ? (
        <UspForm draft={draft} setDraft={setDraft} errors={errors} pending={pending} onSave={saveNew} onCancel={() => setAdding(false)} idPrefix="create-usp" editing={false} />
      ) : (
        <button type="button" className={secondaryButton} onClick={() => setAdding(true)}>
          {t.addNew}
        </button>
      )}
      {problem && (
        <p role="alert" className={errorClass}>
          {problem}
        </p>
      )}
    </EditorCard>
  );
}
